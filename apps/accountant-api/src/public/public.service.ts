// =============================================================================
// public.service.ts — Lettura pubblica dell'identità tenant (ADR-0049)
// =============================================================================
// Richiesta NON autenticata: nessun JWT → nessun req.tenantId → nessun RLS
// context applicativo. Come PlatformService, la lettura cross-tenant gira in
// `withSystemContext` (is_super_admin=true → bypass RLS). Essendo un bypass su
// endpoint pubblico, mitighiamo l'esposizione a livello di query:
//   - `select` esplicito dei SOLI campi safe (mai id/isActive/deletedAt)
//   - filtro `isActive: true, deletedAt: null` → 404 su tenant sospeso/cancellato
//     (no information leak sull'esistenza di tenant inattivi)
// =============================================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma, withSystemContext } from '@gestionale/db';

import type { PublicTenantView } from './public-tenant.dto';

@Injectable()
export class PublicService {
  async getTenantBySlug(slug: string): Promise<PublicTenantView> {
    const tenant = await withSystemContext(() =>
      prisma.tenant.findFirst({
        where: { slug, isActive: true, deletedAt: null },
        select: {
          slug: true,
          name: true,
          descrizione: true,
          indirizzo: true,
          telefono: true,
          emailContatto: true,
          sitoWeb: true,
          logoUrl: true,
        },
      }),
    );

    if (!tenant) {
      throw new NotFoundException({
        errorCode: 'E_TENANT_NOT_FOUND',
        message: 'Tenant not found',
      });
    }

    return tenant;
  }
}
