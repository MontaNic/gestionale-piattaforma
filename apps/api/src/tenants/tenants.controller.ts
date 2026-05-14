// =============================================================================
// tenants.controller.ts — POST /api/v1/tenants (D4)
// =============================================================================
// Bootstrap nuovo tenant. Protected by default (JwtAuthGuard globale, no
// @Public). Permission check `sistema.tenant.gestisci` fatto da TenantsService
// inline (no Guard generico — rimandato a macro-task RBAC futuro).
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
import { TenantCreate } from '../throttler/decorators/tenant-create.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import type { CreateTenantResult } from './tenants.service';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(@Inject(TenantsService) private readonly tenants: TenantsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @TenantCreate()
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateTenantDto,
  ): Promise<{ data: CreateTenantResult }> {
    if (!user) {
      // JwtAuthGuard globale rifiuta gia' senza token, ma defense in depth:
      // se per qualche bug arriva qui senza user, non procedere.
      throw new UnauthorizedException('E_AUTH_SESSION_INVALID');
    }
    const result = await this.tenants.createTenant(dto, user.id);
    return { data: result };
  }
}
