// =============================================================================
// price-lists.controller.ts — REST /price-lists (S17 F1 ADR-0019)
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
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { PriceListsService } from './price-lists.service';
import { AuthErrorCode } from '@gestionale/shared';

@Controller('price-lists')
export class PriceListsController {
  constructor(@Inject(PriceListsService) private readonly priceLists: PriceListsService) {}

  @Get()
  @RequirePermissions('menu.visualizza')
  async list(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.priceLists.list(user.tenantId);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('menu.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.priceLists.getById(user.tenantId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('menu.prezzo.modifica')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreatePriceListDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.priceLists.create(user.tenantId, user.id, dto);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('menu.prezzo.modifica')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdatePriceListDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.priceLists.update(user.tenantId, user.id, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('menu.prezzo.modifica')
  async softDelete(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.priceLists.softDelete(user.tenantId, user.id, id);
    return { data };
  }
}
