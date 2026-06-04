// =============================================================================
// tenant-context.interceptor.ts — Wrap handler in AsyncLocalStorage RLS frame
// =============================================================================
// Globale via APP_INTERCEPTOR. Fires DOPO JwtAuthGuard (order NestJS:
// middleware -> guard -> interceptor -> handler), quindi `req.user` e
// `req.tenantId` sono gia' popolati dal JwtStrategy.validate() su endpoint
// protetti.
//
// Comportamento per route:
// - Route protected post-auth: req.tenantId presente -> wrap in
//   runInTenantContext({ tenantId, isSuperAdmin: false }).
// - Route pre-auth (login, login-pin): TenantMiddleware ha gia' wrappato la
//   request in ALS. Re-wrap qui e' idempotente (ALS shadowing same values).
// - Route Public senza tenant (root, health): req.tenantId undefined -> skip.
//   Handler responsabile del proprio context (es. health usa withSystemContext).
// - Route /auth/refresh: req.tenantId undefined -> skip. AuthService.refresh
//   wrappa internamente con tenantId derivato dal payload JWT.
//
// ⚠️ DECISIONE D3 #4 + S5: isSuperAdmin = false SEMPRE da JWT flow in F1.
// Bypass RLS server-side only via withSystemContext / withSuperAdminContext.
// Vedi ADR-0009.
//
// Pattern Observable<->Promise: usiamo firstValueFrom per convertire l'inner
// Observable in Promise (REST single-response). La subscribe happens DENTRO
// il runInTenantContext frame -> ALS propaga al controller handler e
// downstream service via async_hooks. Per stream (SSE/WebSocket) servirebbe
// pattern dedicato — fuori scope F1.
// =============================================================================

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { runInTenantContext } from '@gestionale/db';
import { type Observable, firstValueFrom, from } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = req.tenantId;

    if (!tenantId) {
      return next.handle();
    }

    return from(
      runInTenantContext({ tenantId, isSuperAdmin: false }, () => firstValueFrom(next.handle())),
    );
  }
}
