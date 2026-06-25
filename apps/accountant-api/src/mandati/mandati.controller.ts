// =============================================================================
// mandati.controller.ts — REST mandati/incarichi (ADR-0051)
// =============================================================================
// Creazione come AZIONE dal preventivo: POST /preventivi/:id/mandato (l'operatore
// è sul preventivo accettato). CRUD sotto /mandati. Permessi mandati.{visualizza,
// gestisci}. tenantId dal JWT (@CurrentUser). Risposta { data }. Prefisso /api/v1.
//
// @Controller() senza base → ogni route dichiara il path completo (convive con
// PreventiviController su /preventivi/* senza collisioni di route esatte).
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
import { StatoMandato } from '@gestionale/db';

import { MandatiService, type MandatiListFilter } from './mandati.service';
import { UpdateMandatoDto } from './dto/update-mandato.dto';

@Controller()
export class MandatiController {
  constructor(@Inject(MandatiService) private readonly mandati: MandatiService) {}

  // Azione: crea mandato dal preventivo accettato.
  @Post('preventivi/:id/mandato')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('mandati.gestisci')
  async createFromPreventivo(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') preventivoId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.mandati.createFromPreventivo(user.tenantId, preventivoId);
    return { data };
  }

  @Get('mandati')
  @RequirePermissions('mandati.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('stato') stato?: string,
    @Query('aziendaId') aziendaId?: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const filter: MandatiListFilter = {
      stato: stato && stato in StatoMandato ? (stato as StatoMandato) : undefined,
      aziendaId: aziendaId || undefined,
    };
    const data = await this.mandati.list(user.tenantId, filter);
    return { data };
  }

  @Get('mandati/:id')
  @RequirePermissions('mandati.visualizza')
  async findOne(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') mandatoId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.mandati.findOne(user.tenantId, mandatoId);
    return { data };
  }

  @Patch('mandati/:id')
  @RequirePermissions('mandati.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') mandatoId: string,
    @Body() dto: UpdateMandatoDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.mandati.update(user.tenantId, mandatoId, dto);
    return { data };
  }

  @Delete('mandati/:id')
  @RequirePermissions('mandati.gestisci')
  async softDelete(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') mandatoId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.mandati.softDelete(user.tenantId, mandatoId);
    return { data };
  }
}
