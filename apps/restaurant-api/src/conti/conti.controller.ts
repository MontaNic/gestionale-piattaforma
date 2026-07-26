// =============================================================================
// conti.controller.ts — REST /conti (operatività COMANDE, PR-2 ADR-0068)
// =============================================================================
// Template tables.controller: JwtAuthGuard + TenantConsistencyGuard globali
// (app.module APP_GUARD), @RequirePermissions per rotta, envelope { data }.
//
// RBAC mapping (scope-lock D4):
//   - GET (list/getById)            → comande.visualizza
//   - POST /conti                   → comande.crea      (apri conto)
//   - POST /conti/:id/righe         → comande.modifica  (aggiungi riga)
//   - PATCH /conti/:id/righe/:rId   → comande.modifica  (modifica riga)
//   - DELETE /conti/:id/righe/:rId  → comande.elimina   (storno riga)
//   - POST /conti/:id/chiudi        → comande.modifica  (chiudi conto)
//   - POST /conti/:id/annulla       → comande.modifica  (annulla conto)
// `comande.stato.cambia` = orfano intenzionale (trigger = blocco KDS, ADR-0068).
//
// Cassa pre-fiscale (ADR-0081 D5) — 3 permessi `cassa.*` ora enforced:
//   - GET  /conti/:id/pagamenti            → cassa.visualizza
//   - POST /conti/:id/pagamenti            → cassa.pagamento.registra
//   - POST /conti/:id/pagamenti/:pId/storna → cassa.storno.esegui
// `chiudi`/`annulla` restano su `comande.modifica`: NON si sposta la permission
// (limita il contratto rotto alla sola guardia di saldo D3). `cassa.scontrino.emetti`
// e `cassa.chiusura.giornaliera` restano orfani di proposito (RT differito / D6).
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

import { ContiService } from './conti.service';
import { CreateContoDto } from './dto/create-conto.dto';
import { AddRigaDto } from './dto/add-riga.dto';
import { UpdateRigaDto } from './dto/update-riga.dto';
import { ListContiQueryDto } from './dto/list-conti.query.dto';
import { RegistraPagamentoDto } from './dto/registra-pagamento.dto';

@Controller('conti')
export class ContiController {
  constructor(@Inject(ContiService) private readonly conti: ContiService) {}

  @Get()
  @RequirePermissions('comande.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query() query: ListContiQueryDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.list(user.tenantId, {
      stato: query.stato,
      tavoloId: query.tavoloId,
    });
    return { data };
  }

  @Get(':id')
  @RequirePermissions('comande.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.getById(user.tenantId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('comande.crea')
  async create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateContoDto) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.create(user.tenantId, user.id, dto);
    return { data };
  }

  @Post(':id/righe')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('comande.modifica')
  async addRiga(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
    @Body() dto: AddRigaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.addRiga(user.tenantId, user.id, contoId, dto);
    return { data };
  }

  @Patch(':id/righe/:rigaId')
  @RequirePermissions('comande.modifica')
  async updateRiga(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
    @Param('rigaId') rigaId: string,
    @Body() dto: UpdateRigaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.updateRiga(user.tenantId, user.id, contoId, rigaId, dto);
    return { data };
  }

  @Delete(':id/righe/:rigaId')
  @RequirePermissions('comande.elimina')
  async stornaRiga(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
    @Param('rigaId') rigaId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.stornaRiga(user.tenantId, user.id, contoId, rigaId);
    return { data };
  }

  // Storno di una riga INVIATA (ADR-storno). Distinto dal DELETE (pending): la
  // riga è già in cucina → marcata `stornata`, non cancellata. Stesso permesso
  // `comande.elimina` (rimuove un piatto).
  @Post(':id/righe/:rigaId/storna')
  @RequirePermissions('comande.elimina')
  async stornaRigaInviata(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
    @Param('rigaId') rigaId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.stornaRigaInviata(user.tenantId, user.id, contoId, rigaId);
    return { data };
  }

  @Post(':id/invia')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('comande.modifica')
  async invia(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') contoId: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.invia(user.tenantId, user.id, contoId);
    return { data };
  }

  // ── Pagamenti (Cassa pre-fiscale, ADR-0081) ────────────────────────────────
  // Rotta dedicata sotto `cassa.visualizza`: il pannello cassa (PR2) può leggere
  // e ripollare i soli pagamenti senza il payload completo del conto — e dà al
  // permesso un consumer reale (era orfano). Il conto completo resta su
  // `comande.visualizza`: un cassiere può vedere i movimenti senza dover avere il
  // permesso comande, e viceversa.
  @Get(':id/pagamenti')
  @RequirePermissions('cassa.visualizza')
  async listPagamenti(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.listPagamenti(user.tenantId, contoId);
    return { data };
  }

  @Post(':id/pagamenti')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('cassa.pagamento.registra')
  async registraPagamento(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
    @Body() dto: RegistraPagamentoDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.registraPagamento(user.tenantId, user.id, contoId, dto);
    return { data };
  }

  @Post(':id/pagamenti/:pagamentoId/storna')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('cassa.storno.esegui')
  async stornaPagamento(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
    @Param('pagamentoId') pagamentoId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.stornaPagamento(user.tenantId, user.id, contoId, pagamentoId);
    return { data };
  }

  @Post(':id/chiudi')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('comande.modifica')
  async chiudi(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') contoId: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.chiudi(user.tenantId, user.id, contoId);
    return { data };
  }

  @Post(':id/annulla')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('comande.modifica')
  async annulla(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') contoId: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.annulla(user.tenantId, user.id, contoId);
    return { data };
  }
}
