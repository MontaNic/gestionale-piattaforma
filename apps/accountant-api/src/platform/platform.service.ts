// =============================================================================
// platform.service.ts — gestione tenant lato superadmin (Task 3)
// =============================================================================
// Operazioni CROSS-TENANT: girano in withSystemContext (is_super_admin=true →
// bypass RLS), perché il superadmin (utente di `oneplatform`) deve vedere e
// modificare righe di ALTRI tenant. La create riusa TenantsService.createTenant
// (già atomico in withSystemContextAtomicTx).
//
// Self-protection: non si può sospendere/eliminare il tenant di piattaforma.
// Lifecycle minimale: suspend (isActive=false) / restore (isActive=true) /
// softDelete (deletedAt). Niente purge/impersonation/audit platform (fuori scope).
// =============================================================================

import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma, withSystemContext } from '@gestionale/db';
import { type CreateTenantDto, TenantsService, type CreateTenantResult } from '@gestionale/auth';

export interface PlatformTenantView {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: Date;
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    @Inject(TenantsService) private readonly tenants: TenantsService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private platformTenantId(): string {
    return this.config.get<string>('PLATFORM_TENANT_ID') ?? '';
  }

  // ---------------------------------------------------------------------------
  // LIST — tutti i tenant non eliminati (cross-tenant via system context)
  // ---------------------------------------------------------------------------
  async listTenants(): Promise<PlatformTenantView[]> {
    const rows = await withSystemContext(() =>
      prisma.tenant.findMany({
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true, name: true, slug: true, isActive: true, createdAt: true },
      }),
    );
    return rows;
  }

  // ---------------------------------------------------------------------------
  // CREATE — riusa il bootstrap atomico esistente
  // ---------------------------------------------------------------------------
  async createTenant(dto: CreateTenantDto, createdBy: string): Promise<CreateTenantResult> {
    return this.tenants.createTenant(dto, createdBy);
  }

  // ---------------------------------------------------------------------------
  // SUSPEND / RESTORE / SOFT-DELETE
  // ---------------------------------------------------------------------------
  async suspend(tenantId: string): Promise<PlatformTenantView> {
    this.assertNotPlatform(tenantId);
    return this.setActive(tenantId, false);
  }

  async restore(tenantId: string): Promise<PlatformTenantView> {
    this.assertNotPlatform(tenantId);
    return this.setActive(tenantId, true);
  }

  async softDelete(tenantId: string): Promise<{ id: string; deleted: true }> {
    this.assertNotPlatform(tenantId);
    await this.getOrThrow(tenantId);
    await withSystemContext(() =>
      prisma.tenant.update({ where: { id: tenantId }, data: { deletedAt: new Date() } }),
    );
    this.logger.log(`Platform: tenant soft-deleted ${tenantId}`);
    return { id: tenantId, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private assertNotPlatform(tenantId: string): void {
    if (tenantId === this.platformTenantId()) {
      throw new ForbiddenException({
        errorCode: 'E_PLATFORM_CANNOT_MODIFY_SELF',
        message: 'Cannot modify the platform tenant itself',
      });
    }
  }

  private async getOrThrow(tenantId: string): Promise<PlatformTenantView> {
    const tenant = await withSystemContext(() =>
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, isActive: true, createdAt: true },
      }),
    );
    if (!tenant) {
      throw new NotFoundException({ errorCode: 'E_TENANT_NOT_FOUND', message: 'Tenant not found' });
    }
    return tenant;
  }

  private async setActive(tenantId: string, isActive: boolean): Promise<PlatformTenantView> {
    await this.getOrThrow(tenantId);
    const updated = await withSystemContext(() =>
      prisma.tenant.update({
        where: { id: tenantId },
        data: { isActive },
        select: { id: true, name: true, slug: true, isActive: true, createdAt: true },
      }),
    );
    this.logger.log(`Platform: tenant ${tenantId} isActive=${isActive}`);
    return updated;
  }
}
