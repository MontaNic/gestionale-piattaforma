// =============================================================================
// menu-categories.controller.ts — REST /menus/:menuId/categories (S17 ADR-0019)
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
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { MenuCategoriesService } from './menu-categories.service';
import { AuthErrorCode } from '@gestionale/shared';

@Controller('menus/:menuId/categories')
export class MenuCategoriesController {
  constructor(@Inject(MenuCategoriesService) private readonly cats: MenuCategoriesService) {}

  @Get()
  @RequirePermissions('menu.visualizza')
  async list(@CurrentUser() user: AuthenticatedUser | undefined, @Param('menuId') menuId: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.cats.listByMenu(user.tenantId, menuId);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('menu.visualizza')
  async getById(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuId') menuId: string,
    @Param('id') id: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.cats.getById(user.tenantId, menuId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('menu.categoria.gestisci')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuId') menuId: string,
    @Body() dto: CreateMenuCategoryDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.cats.create(user.tenantId, user.id, menuId, dto);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('menu.categoria.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuId') menuId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMenuCategoryDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.cats.update(user.tenantId, user.id, menuId, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('menu.categoria.gestisci')
  async softDelete(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuId') menuId: string,
    @Param('id') id: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.cats.softDelete(user.tenantId, user.id, menuId, id);
    return { data };
  }
}
