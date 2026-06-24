// =============================================================================
// platform.controller.ts — superadmin tenant management (Task 3)
// =============================================================================
// Tutte le rotte sotto /api/v1/platform/tenants, gated da PlatformGuard
// (tenant === oneplatform) a livello classe + @RequirePermissions(
// 'sistema.tenant.gestisci') per-rotta (defense-in-depth). JwtAuthGuard +
// PermissionsGuard globali (app.module). Prefisso /api/v1 da main.ts.
// =============================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import {
  CreateTenantDto,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { PlatformGuard } from './guards/platform.guard';
import { PlatformService } from './platform.service';

@Controller('platform/tenants')
@UseGuards(PlatformGuard)
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get()
  @RequirePermissions('sistema.tenant.gestisci')
  async list() {
    const data = await this.platform.listTenants();
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('sistema.tenant.gestisci')
  async create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateTenantDto) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.platform.createTenant(dto, user.id);
    return { data };
  }

  @Patch(':id/suspend')
  @RequirePermissions('sistema.tenant.gestisci')
  async suspend(@Param('id') id: string) {
    const data = await this.platform.suspend(id);
    return { data };
  }

  @Patch(':id/restore')
  @RequirePermissions('sistema.tenant.gestisci')
  async restore(@Param('id') id: string) {
    const data = await this.platform.restore(id);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('sistema.tenant.gestisci')
  async softDelete(@Param('id') id: string) {
    const data = await this.platform.softDelete(id);
    return { data };
  }
}
