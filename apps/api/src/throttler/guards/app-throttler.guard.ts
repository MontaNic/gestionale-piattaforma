import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import type { ThrottlerGetTrackerFunction } from '@nestjs/throttler/dist/throttler-module-options.interface';

import { extractSubFromAuthHeader } from '../utils/jwt-decode.util';

// =============================================================================
// AppThrottlerGuard — extends ThrottlerGuard con custom tracker (B1 fase 2)
// =============================================================================
// Rationale (decisione Claude strategico, lockata STOP 2):
//
// Il throttler `tenant-create` deve usare userId quando la request e'
// autenticata (un attacker con permission `sistema.tenant.gestisci` puo' fare
// IP rotation per bypassare un IP-bucket). Il tracker default di
// @nestjs/throttler usa SOLO IP — insufficiente per questo endpoint.
//
// Constraint architetturale: APP_GUARD globale (questo) gira PRIMA dei guard
// per-controller (JwtAuthGuard) → req.user puo' essere undefined al momento
// di valutazione del tracker. Strategia 3-livelli:
//
//   1. req.user.sub presente (es. middleware/interceptor a monte) → user:<sub>
//   2. Decode minimale del JWT dall'Authorization header (NO verify, NO DB):
//      stiamo solo identificando il caller per il bucket di rate-limit, non
//      autorizzando. La verifica firma JWT avviene poi nel JwtAuthGuard.
//      Token forgiato/scaduto → fallback IP, ma JwtAuthGuard rifiutera' lui
//      la request con 401. Worst case: attacker con JWT forgiato consuma il
//      bucket userId di un sub a sua scelta — accettabile (limit 3/h e
//      lockout/email-notify in B2 mitigano).
//   3. Fallback ip:<req.ip>
//
// Trade-off documentato in ADR-0013 → TD-E (custom tracker non distingue
// session-stolen JWT; mitigato da auth-strict + lockout B1 Fase 3).
//
// Implementazione: override handleRequest (non getTracker, che in v6 ha
// signature single-arg senza context). Si intercetta requestProps.getTracker
// solo quando throttler.name === 'tenant-create'; gli altri throttler
// (default, auth-strict) passano attraverso → IP-only default behaviour.
// =============================================================================
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly log = new Logger(AppThrottlerGuard.name);

  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    if (requestProps.throttler.name === 'tenant-create') {
      const customGetTracker: ThrottlerGetTrackerFunction = async (req) => {
        const { tracker, source } = this.resolveTenantCreateTracker(req as Record<string, unknown>);
        if (process.env.NODE_ENV !== 'production') {
          // Logger.log (info) intenzionale: `debug` e' off-by-default in NestJS,
          // mentre `log` e' visibile nello smoke STOP 2 e disattivato in prod
          // dal check NODE_ENV. Future: sostituire con structured tracing.
          this.log.log(`tenant-create tracker=${tracker} (source=${source})`);
        }
        return tracker;
      };
      return super.handleRequest({ ...requestProps, getTracker: customGetTracker });
    }
    return super.handleRequest(requestProps);
  }

  private resolveTenantCreateTracker(req: Record<string, unknown>): {
    tracker: string;
    source: 'req.user' | 'jwt' | 'ip-fallback';
  } {
    // Path 1: req.user gia' popolato (improbabile pre-JwtAuthGuard, ma defensive).
    const user = (req as { user?: { sub?: unknown; id?: unknown } }).user;
    const userIdFromReq = user?.sub ?? user?.id;
    if (userIdFromReq) {
      return { tracker: `user:${String(userIdFromReq)}`, source: 'req.user' };
    }

    // Path 2: decode JWT minimale dall'Authorization header (no verify).
    // Estratto in utils/jwt-decode.util.ts per testability (vedi STOP 4).
    const headers = (req as { headers?: Record<string, unknown> }).headers ?? {};
    const userIdFromJwt = extractSubFromAuthHeader(headers.authorization);
    if (userIdFromJwt) {
      return { tracker: `user:${userIdFromJwt}`, source: 'jwt' };
    }

    // Path 3: fallback IP.
    const ip = (req as { ip?: string }).ip ?? 'unknown';
    return { tracker: `ip:${ip}`, source: 'ip-fallback' };
  }
}
