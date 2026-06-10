// =============================================================================
// scadenze.controller.ts — REST /scadenze + /scadenze/categorie (STOP-scad1)
// =============================================================================
// Pattern replicato da aziende.controller (CRUD tenant-level). Permessi dedicati
// scadenze.{visualizza,gestisci} (catalogo 35→37). Prefisso /api/v1 da main.ts.
//
// ORDINE ROTTE CRITICO: le rotte statiche `categorie` sono dichiarate PRIMA
// delle rotte param `:id` — Express registra in ordine di dichiarazione, quindi
// GET/POST `/scadenze/categorie` matchano prima di GET `/scadenze/:id` (altrimenti
// 'categorie' verrebbe catturato come :id).
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
import { CreateScadenzaDto } from './dto/create-scadenza.dto';
import { CreateScadenzaCategoriaDto } from './dto/create-scadenza-categoria.dto';
import { ScadenzeService, type ScadenzeListFilter } from './scadenze.service';
import { UpdateScadenzaDto } from './dto/update-scadenza.dto';

@Controller('scadenze')
export class ScadenzeController {
  constructor(@Inject(ScadenzeService) private readonly scadenze: ScadenzeService) {}

  // ── Scadenze list ────────────────────────────────────────────────────────────
  @Get()
  @RequirePermissions('scadenze.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('aziendaId') aziendaId?: string,
    @Query('categoriaId') categoriaId?: string,
    @Query('attivo') attivo?: string,
    @Query('da') da?: string,
    @Query('a') a?: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const filter: ScadenzeListFilter = {
      aziendaId: aziendaId || undefined,
      categoriaId: categoriaId || undefined,
      attivo: attivo === undefined ? undefined : attivo === 'true',
      da: da || undefined,
      a: a || undefined,
    };
    const data = await this.scadenze.list(user.tenantId, filter);
    return { data };
  }

  // ── Categorie (PRIMA di :id) ──────────────────────────────────────────────────
  @Get('categorie')
  @RequirePermissions('scadenze.visualizza')
  async listCategorie(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.scadenze.listCategorie(user.tenantId);
    return { data };
  }

  @Post('categorie')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('scadenze.gestisci')
  async createCategoria(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateScadenzaCategoriaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.scadenze.createCategoria(user.tenantId, dto);
    return { data };
  }

  // ── Scadenze create ────────────────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('scadenze.gestisci')
  async create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateScadenzaDto) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.scadenze.create(user.tenantId, dto);
    return { data };
  }

  // ── Scadenze :id ────────────────────────────────────────────────────────────────
  @Get(':id')
  @RequirePermissions('scadenze.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.scadenze.getById(user.tenantId, id);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('scadenze.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateScadenzaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.scadenze.update(user.tenantId, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('scadenze.gestisci')
  async softDelete(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.scadenze.softDelete(user.tenantId, id);
    return { data };
  }
}
