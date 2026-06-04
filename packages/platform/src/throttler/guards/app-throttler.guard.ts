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
    // ─── TD-AD fix (B2b, ADR-0015) — outer try/catch fail-open ──────────────
    // Discovery #26 B2a: ThrottlerStorage Redis DOWN → MaxRetriesPerRequestError
    // 500 totale (anche login valido bloccato). Pattern coerente fail-open
    // layered: LockoutService (B1 internal try/catch) + MailService (B2a
    // sendSafe wrapper) + ThrottlerGuard (qui).
    //
    // Trade-off accettato (TD-AD resolved B2b): durante Redis DOWN rate-limit
    // + lockout disattivati simultaneamente (fail-open) MA auth flow funziona.
    // Audit log Postgres continua a tracciare attempts. Production deploy
    // escalation: Redis monitoring + alerting (TD futuro).
    //
    // Regex `isRedisError` cattura le forme note di errore ioredis/nest-lab:
    // - MaxRetriesPerRequestError (esaurimento retry policy)
    // - ECONNREFUSED (connection refused, Redis down brusco)
    // - "Redis" / "ioredis" generic patterns
    // Non-Redis errors → re-throw (preserva semantica originaria del package).
    try {
      if (requestProps.throttler.name === 'tenant-create') {
        const customGetTracker: ThrottlerGetTrackerFunction = async (req) => {
          const { tracker, source } = this.resolveTenantCreateTracker(
            req as Record<string, unknown>,
          );
          if (process.env.NODE_ENV !== 'production') {
            // Logger.log (info) intenzionale: `debug` e' off-by-default in NestJS,
            // mentre `log` e' visibile nello smoke STOP 2 e disattivato in prod
            // dal check NODE_ENV. Future: sostituire con structured tracing.
            this.log.log(`tenant-create tracker=${tracker} (source=${source})`);
          }
          return tracker;
        };
        return await super.handleRequest({ ...requestProps, getTracker: customGetTracker });
      }
      if (requestProps.throttler.name === 'auth-pin') {
        // B2a: tracker per-tenant per /auth/login-pin. tenantId arriva da
        // TenantMiddleware (req.tenantId) — verifica empirica STEP 4.1.
        // Fallback IP-only se tenant resolution e' fallita (defense-in-depth:
        // niente crash auth flow). NO deviceId — TD-Y ADR-0014.
        const customGetTracker: ThrottlerGetTrackerFunction = async (req) => {
          const { tracker, source } = this.resolveAuthPinTracker(req as Record<string, unknown>);
          if (process.env.NODE_ENV !== 'production') {
            this.log.log(`auth-pin tracker=${tracker} (source=${source})`);
          }
          return tracker;
        };
        return await super.handleRequest({ ...requestProps, getTracker: customGetTracker });
      }
      return await super.handleRequest(requestProps);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : '';
      const isRedisError = /MaxRetriesPerRequestError|ECONNREFUSED|Redis|ioredis/i.test(
        `${errName} ${errMsg}`,
      );
      if (isRedisError) {
        this.log.warn(
          `[FAIL-OPEN] ThrottlerGuard Redis unavailable, allowing request ` +
            `(throttler=${requestProps.throttler.name}): ${errMsg}`,
        );
        return true;
      }
      // Non-Redis error → preserva semantica originaria (re-throw con stack
      // intatto, no wrap-rethrow che bruciato lo stack trace).
      throw err;
    }
  }

  private resolveAuthPinTracker(req: Record<string, unknown>): {
    tracker: string;
    source: 'tenant-ip' | 'ip-fallback';
  } {
    const tenantId = (req as { tenantId?: string }).tenantId;
    const ip = (req as { ip?: string }).ip ?? 'unknown';
    if (!tenantId) {
      // Defense-in-depth: tenant resolution fallita (es. header missing o
      // slug invalido — TenantMiddleware solitamente fa fail-fast prima di
      // arrivare al guard, ma fallback graceful per coerenza).
      this.log.warn(`auth-pin tracker: tenantId missing on req, fallback to IP-only (ip=${ip})`);
      return { tracker: `pin:unknown:${ip}`, source: 'ip-fallback' };
    }
    return { tracker: `pin:${tenantId}:${ip}`, source: 'tenant-ip' };
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
