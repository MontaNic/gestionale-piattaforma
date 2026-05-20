// =============================================================================
// articles.controller.ts — REST /articles (S17 F1 ADR-0019)
// =============================================================================
// Articles e' top-level: filtri via query ?categoryId= ?menuId=.
// Prezzi override per listino: vedi ArticlePricesController (/articles/:id/prices).
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
  Query,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-request.interface';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { ArticlesService } from './articles.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

@Controller('articles')
export class ArticlesController {
  constructor(@Inject(ArticlesService) private readonly articles: ArticlesService) {}

  @Get()
  @RequirePermissions('menu.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('categoryId') categoryId?: string,
    @Query('menuId') menuId?: string,
  ) {
    if (!user) throw new UnauthorizedException('E_AUTH_SESSION_INVALID');
    const data = await this.articles.list(user.tenantId, { categoryId, menuId });
    return { data };
  }

  @Get(':id')
  @RequirePermissions('menu.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException('E_AUTH_SESSION_INVALID');
    const data = await this.articles.getById(user.tenantId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('menu.piatto.crea')
  async create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateArticleDto) {
    if (!user) throw new UnauthorizedException('E_AUTH_SESSION_INVALID');
    const data = await this.articles.create(user.tenantId, user.id, dto);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('menu.piatto.modifica')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    if (!user) throw new UnauthorizedException('E_AUTH_SESSION_INVALID');
    const data = await this.articles.update(user.tenantId, user.id, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('menu.piatto.modifica')
  async softDelete(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException('E_AUTH_SESSION_INVALID');
    const data = await this.articles.softDelete(user.tenantId, user.id, id);
    return { data };
  }
}
