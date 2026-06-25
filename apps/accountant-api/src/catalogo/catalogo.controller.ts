// =============================================================================
// catalogo.controller.ts — REST /catalogo/categorie + /catalogo/servizi (ADR-0050)
// =============================================================================
// Pattern scadenze.controller. Permessi servizi.{visualizza,gestisci}. tenantId
// dal JWT via @CurrentUser. Risposta { data }. Prefisso /api/v1 da main.ts.
//
// Le route param `:id` sono per-risorsa (servizi/:id, categorie/:id): nessuna
// collisione con le statiche (non esiste /catalogo/:id).
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

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { CatalogoService, type ServiziListFilter } from './catalogo.service';
import { CreateServizioCategoriaDto } from './dto/create-servizio-categoria.dto';
import { UpdateServizioCategoriaDto } from './dto/update-servizio-categoria.dto';
import { CreateServizioCatalogoDto } from './dto/create-servizio-catalogo.dto';
import { UpdateServizioCatalogoDto } from './dto/update-servizio-catalogo.dto';

@Controller('catalogo')
export class CatalogoController {
  constructor(@Inject(CatalogoService) private readonly catalogo: CatalogoService) {}

  // ── Categorie ────────────────────────────────────────────────────────────────

  @Get('categorie')
  @RequirePermissions('servizi.visualizza')
  async listCategorie(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.catalogo.listCategorie(user.tenantId);
    return { data };
  }

  @Post('categorie')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('servizi.gestisci')
  async createCategoria(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateServizioCategoriaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.catalogo.createCategoria(user.tenantId, dto);
    return { data };
  }

  @Patch('categorie/:id')
  @RequirePermissions('servizi.gestisci')
  async updateCategoria(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') categoriaId: string,
    @Body() dto: UpdateServizioCategoriaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.catalogo.updateCategoria(user.tenantId, categoriaId, dto);
    return { data };
  }

  @Delete('categorie/:id')
  @RequirePermissions('servizi.gestisci')
  async deleteCategoria(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') categoriaId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.catalogo.deleteCategoria(user.tenantId, categoriaId);
    return { data };
  }

  // ── Servizi ──────────────────────────────────────────────────────────────────

  @Get('servizi')
  @RequirePermissions('servizi.visualizza')
  async listServizi(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('categoriaId') categoriaId?: string,
    @Query('attivo') attivo?: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const filter: ServiziListFilter = {
      categoriaId: categoriaId || undefined,
      attivo: attivo === undefined ? undefined : attivo === 'true',
    };
    const data = await this.catalogo.listServizi(user.tenantId, filter);
    return { data };
  }

  @Get('servizi/:id')
  @RequirePermissions('servizi.visualizza')
  async getServizio(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') servizioId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.catalogo.findOneServizio(user.tenantId, servizioId);
    return { data };
  }

  @Post('servizi')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('servizi.gestisci')
  async createServizio(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateServizioCatalogoDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.catalogo.createServizio(user.tenantId, dto);
    return { data };
  }

  @Patch('servizi/:id')
  @RequirePermissions('servizi.gestisci')
  async updateServizio(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') servizioId: string,
    @Body() dto: UpdateServizioCatalogoDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.catalogo.updateServizio(user.tenantId, servizioId, dto);
    return { data };
  }

  @Delete('servizi/:id')
  @RequirePermissions('servizi.gestisci')
  async deleteServizio(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') servizioId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.catalogo.deleteServizio(user.tenantId, servizioId);
    return { data };
  }
}
