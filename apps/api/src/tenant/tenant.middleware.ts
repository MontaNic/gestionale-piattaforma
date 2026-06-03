// =============================================================================
// tenant.middleware.ts — Estrae X-Tenant-Slug e lo risolve in tenantId
// =============================================================================
// Attivo SOLO su endpoint PRE-auth (login, login-pin). Sugli endpoint
// protetti il tenantId arriva dal JWT payload (anti-spoofing, decisione B
// ADR-0008): il middleware skippa se request.user e' gia' attached.
//
// Comportamento:
// - Header X-Tenant-Slug mancante -> 401 generic (no info leak)
// - Slug non corrispondente a tenant esistente -> 401 generic (no info leak)
// - Slug valido -> req.tenantId = uuid del tenant + wrappa il resto della
//   chain (handler + audit log) in runInTenantContext(...) per popolare
//   l'AsyncLocalStorage RLS context (ADR-0009).
//
// RLS pre-auth (D3a):
// - Slug lookup gira in `withSystemContext`: pre-tenant-resolution, non
//   abbiamo ancora tenantId. is_super_admin=true bypassa RLS policy
//   (placeholder USING(true) in D3a, reale super_admin OR match in D3b).
// - Dopo resolve, `runInTenantContext({tenantId, isSuperAdmin: false}, next)`
//   garantisce che AuthService.login + audit log girino nel context del
//   tenant risolto.
//
// Cache: nessuna in F1 (lookup DB per ogni richiesta pre-auth). Tech debt
// in ADR-0008 per Redis cache TTL=60s.
// =============================================================================

import { Inject, Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { runInTenantContext, withSystemContext } from '@gestionale/db';
import type { NextFunction, Response } from 'express';

import { DbService } from '../db/db.service';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { AuthErrorCode } from '@gestionale/shared';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  // @Inject esplicito — Discovery #29 B2b.
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async use(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    // Skip se request gia' autenticato: JwtStrategy.validate() ha gia' messo
    // req.tenantId con la fonte autorevole (JWT payload). Header trusted-only
    // pre-auth.
    if (req.user) {
      return next();
    }

    const slug = req.header('x-tenant-slug');
    if (!slug || typeof slug !== 'string') {
      throw new UnauthorizedException(AuthErrorCode.TENANT_REQUIRED);
    }

    // Slug lookup pre-tenant: usa system context (bypass RLS placeholder/real).
    // Necessario perche' non abbiamo ancora il tenantId da settare.
    const tenant = await withSystemContext(() =>
      this.db.prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, isActive: true },
      }),
    );

    if (!tenant || !tenant.isActive) {
      // Stesso errore per "non esiste" e "inattivo": no info leak su esistenza
      // del tenant. Side-channel timing residuo accettato per F1.
      throw new UnauthorizedException(AuthErrorCode.TENANT_REQUIRED);
    }

    req.tenantId = tenant.id;

    // Wrap il resto della chain in ALS context del tenant risolto.
    // Pattern: chiama next() DENTRO runInTenantContext -> il chain downstream
    // (guard -> interceptor -> handler -> service) eredita ALS via
    // async_hooks. next() e' sync, ritorna void; il framework Express/NestJS
    // gestisce il resto. Niente await su completion downstream.
    await runInTenantContext({ tenantId: tenant.id, isSuperAdmin: false }, () => {
      next();
    });
  }
}
