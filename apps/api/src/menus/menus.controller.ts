// =============================================================================
// menus.controller.ts — REST /menus (sessione 17 F1 ADR-0019)
// =============================================================================
// Pattern replicato da tenants.controller.ts.
// Protection: JwtAuthGuard globale + @RequirePermissions.
// TenantConsistencyGuard (sessione 16) cattura cross-tenant by default.
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
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-request.interface';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { MenusService } from './menus.service';
import { AuthErrorCode } from '@gestionale/shared';

@Controller('menus')
export class MenusController {
  constructor(@Inject(MenusService) private readonly menus: MenusService) {}

  @Get()
  @RequirePermissions('menu.visualizza')
  async list(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.menus.list(user.tenantId);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('menu.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.menus.getById(user.tenantId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('menu.categoria.gestisci')
  async create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateMenuDto) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.menus.create(user.tenantId, user.id, dto);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('menu.categoria.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateMenuDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.menus.update(user.tenantId, user.id, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('menu.categoria.gestisci')
  async softDelete(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.menus.softDelete(user.tenantId, user.id, id);
    return { data };
  }
}
