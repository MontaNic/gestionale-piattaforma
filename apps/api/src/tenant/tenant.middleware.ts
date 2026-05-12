// =============================================================================
// tenant.middleware.ts — Estrae X-Tenant-Slug e lo risolve in tenantId
// =============================================================================
// Attivo SOLO su endpoint PRE-auth (login, refresh, login-pin). Sugli endpoint
// protetti il tenantId arriva dal JWT payload (anti-spoofing, decisione B
// ADR-0008): il middleware skippa se request.user e' gia' attached.
//
// Comportamento:
// - Header X-Tenant-Slug mancante -> 401 generic (no info leak)
// - Slug non corrispondente a tenant esistente -> 401 generic (no info leak)
// - Slug valido -> req.tenantId = uuid del tenant
//
// Cache: nessuna in F1 (lookup DB per ogni richiesta pre-auth). Tech debt
// in ADR-0008 per Redis cache TTL=60s.
// =============================================================================

import { Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Response } from 'express';

import { DbService } from '../db/db.service';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly db: DbService) {}

  async use(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    // Skip se request gia' autenticato: JwtStrategy.validate() ha gia' messo
    // req.tenantId con la fonte autorevole (JWT payload). Header trusted-only
    // pre-auth.
    if (req.user) {
      return next();
    }

    const slug = req.header('x-tenant-slug');
    if (!slug || typeof slug !== 'string') {
      throw new UnauthorizedException('E_AUTH_TENANT_REQUIRED');
    }

    const tenant = await this.db.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, isActive: true },
    });

    if (!tenant || !tenant.isActive) {
      // Stesso errore per "non esiste" e "inattivo": no info leak su esistenza
      // del tenant. Side-channel timing residuo accettato per F1.
      throw new UnauthorizedException('E_AUTH_TENANT_REQUIRED');
    }

    req.tenantId = tenant.id;
    next();
  }
}
