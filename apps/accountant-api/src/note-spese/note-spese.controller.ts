// =============================================================================
// note-spese.controller.ts — REST /note-spese (accountant, PR-2)
// =============================================================================
// Solo operatore studio. Prefisso /api/v1 da main.ts. CRUD della nota; gli
// allegati hanno il loro controller (note-spese-allegati.controller). Permessi
// §6: gestisci per CRUD proprie; leggi_tutte estende list/get a tutte (scoping
// nel service, NON bypassabile). Le transizioni (invia/approva/respingi) sono PR-3.
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
import { StatoNotaSpesa } from '@gestionale/db';
import { AuthErrorCode } from '@gestionale/shared';

import { NoteSpeseService, type NoteSpeseListFilter } from './note-spese.service';
import { CreateNotaSpesaDto } from './dto/create-nota-spesa.dto';
import { UpdateNotaSpesaDto } from './dto/update-nota-spesa.dto';
import { RespingiNotaSpesaDto } from './dto/respingi-nota-spesa.dto';

@Controller('note-spese')
export class NoteSpeseController {
  constructor(@Inject(NoteSpeseService) private readonly noteSpese: NoteSpeseService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('notespese.gestisci')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateNotaSpesaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.noteSpese.create(user.tenantId, user.id, dto);
    return { data };
  }

  @Get()
  @RequirePermissions('notespese.gestisci')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('mese') mese?: string,
    @Query('stato') stato?: string,
    @Query('userId') userId?: string,
    @Query('aziendaId') aziendaId?: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const filter: NoteSpeseListFilter = {
      mese: mese || undefined,
      stato: isStato(stato) ? stato : undefined,
      userId: userId || undefined,
      aziendaId: aziendaId || undefined,
    };
    const data = await this.noteSpese.list(user.tenantId, user.id, filter);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('notespese.gestisci')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.noteSpese.getById(user.tenantId, user.id, id);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('notespese.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateNotaSpesaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.noteSpese.update(user.tenantId, user.id, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('notespese.gestisci')
  async remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.noteSpese.remove(user.tenantId, user.id, id);
    return { data };
  }

  // ── Transizioni (PR-3) ───────────────────────────────────────────────────────
  // `invia` = gestisci + autore (l'ownership è nel service). approva/respingi =
  // `notespese.approva`. HTTP 200 (ritornano la risorsa aggiornata, non creano).

  @Post(':id/invia')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notespese.gestisci')
  async invia(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.noteSpese.invia(user.tenantId, user.id, id);
    return { data };
  }

  @Post(':id/approva')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notespese.approva')
  async approva(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.noteSpese.approva(user.tenantId, user.id, id);
    return { data };
  }

  @Post(':id/respingi')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notespese.approva')
  async respingi(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: RespingiNotaSpesaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.noteSpese.respingi(user.tenantId, user.id, id, dto.motivo);
    return { data };
  }
}

function isStato(v: string | undefined): v is StatoNotaSpesa {
  return (
    v === StatoNotaSpesa.bozza ||
    v === StatoNotaSpesa.inviata ||
    v === StatoNotaSpesa.approvata ||
    v === StatoNotaSpesa.respinta
  );
}
