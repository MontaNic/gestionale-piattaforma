// =============================================================================
// article-prices.controller.ts — REST /articles/:articleId/prices (S17)
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

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { ArticlePricesService } from './article-prices.service';
import { SetArticlePriceDto, UpdateArticlePriceDto } from './dto/set-article-price.dto';
import { AuthErrorCode } from '@gestionale/shared';

@Controller('articles/:articleId/prices')
export class ArticlePricesController {
  constructor(@Inject(ArticlePricesService) private readonly prices: ArticlePricesService) {}

  @Get()
  @RequirePermissions('menu.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('articleId') articleId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.prices.listByArticle(user.tenantId, articleId);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('menu.prezzo.modifica')
  async setPrice(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('articleId') articleId: string,
    @Body() dto: SetArticlePriceDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.prices.setPrice(user.tenantId, user.id, articleId, dto);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('menu.prezzo.modifica')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('articleId') articleId: string,
    @Param('id') id: string,
    @Body() dto: UpdateArticlePriceDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.prices.updatePrice(user.tenantId, user.id, articleId, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('menu.prezzo.modifica')
  async remove(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('articleId') articleId: string,
    @Param('id') id: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.prices.removePrice(user.tenantId, user.id, articleId, id);
    return { data };
  }
}
