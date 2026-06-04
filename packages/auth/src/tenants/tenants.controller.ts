// =============================================================================
// tenants.controller.ts — POST /api/v1/tenants (D4 + RBAC sessione 11)
// =============================================================================
// Bootstrap nuovo tenant. Protected by default (JwtAuthGuard globale, no
// @Public). Authorization via @RequirePermissions('sistema.tenant.gestisci')
// decorator (PermissionsGuard APP_GUARD globale, ADR-0017 sessione 11).
// Lazy lookup con cache Redis TTL 60s + audit 'auth.permission_denied'
// automatico su deny. Inline check service rimosso in PR #27 (single source
// of truth nel Guard).
//
// Response shape coerente con altri endpoint: `{data: {tenant, sede, admin,
// superAdminRole}}` (subset, non tutte le 8 entita' create).
// =============================================================================

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-request.interface';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { TenantCreate } from '@gestionale/platform';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { CreateTenantResult } from './tenants.service';
import { TenantsService } from './tenants.service';
import { AuthErrorCode } from '@gestionale/shared';

@Controller('tenants')
export class TenantsController {
  constructor(@Inject(TenantsService) private readonly tenants: TenantsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @TenantCreate()
  @RequirePermissions('sistema.tenant.gestisci')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateTenantDto,
  ): Promise<{ data: CreateTenantResult }> {
    if (!user) {
      // JwtAuthGuard globale rifiuta gia' senza token, ma defense in depth:
      // se per qualche bug arriva qui senza user, non procedere.
      throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    }
    const result = await this.tenants.createTenant(dto, user.id);
    return { data: result };
  }
}
