// =============================================================================
// comande.controller.ts — REST /comande (feed KDS + transizioni, ADR-0069)
// =============================================================================
// Template conti.controller: JwtAuthGuard + TenantConsistencyGuard globali,
// @RequirePermissions per rotta, envelope { data }.
//
// RBAC mapping (scope-lock: nessun verbo nuovo):
//   - GET /comande              → comande.visualizza  (feed cucina)
//   - PATCH /comande/:id/stato  → comande.stato.cambia (il consumer dell'orfano)
// L'invio (POST /conti/:id/invia) vive in ContiController (opera sul conto).
// =============================================================================

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { ComandeService } from './comande.service';
import { ListComandeQueryDto } from './dto/list-comande.query.dto';
import { CambiaStatoComandaDto } from './dto/cambia-stato-comanda.dto';

@Controller('comande')
export class ComandeController {
  constructor(@Inject(ComandeService) private readonly comande: ComandeService) {}

  @Get()
  @RequirePermissions('comande.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query() query: ListComandeQueryDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.comande.list(user.tenantId, {
      stato: query.stato,
      reparto: query.reparto,
      contoId: query.contoId,
    });
    return { data };
  }

  @Patch(':id/stato')
  @RequirePermissions('comande.stato.cambia')
  async cambiaStato(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') comandaId: string,
    @Body() dto: CambiaStatoComandaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.comande.cambiaStato(user.tenantId, user.id, comandaId, dto.stato);
    return { data };
  }
}
