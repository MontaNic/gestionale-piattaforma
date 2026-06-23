// =============================================================================
// portale-comunicazioni.controller.ts — REST /portale/comunicazioni (cliente, ADR-0047)
// =============================================================================
// Superficie SOLO cliente: lista/dettaglio + reply lato cliente + read-tracking
// della propria azienda. Namespace permessi separato `portale.*` (ADR-0046 §6):
// un operatore non ha `portale.comunicazioni.*`, quindi la PermissionsGuard lo
// blocca a monte. Reply-only: nessun POST per aprire thread (ADR-0047 §1).
// Defense-in-depth: lo scoping per-azienda usa `aziendaId` dal principal; qui
// asseriamo che il principal sia un cliente agganciato a un'azienda
// (assertCliente, gemello di PortaleDocumentiController).
//
// ORDINE ROTTE: le statiche sotto `:id` (`messaggi`, `letto-cliente`) sono
// distinte per segmento; nessun conflitto con la GET `:id`.
// =============================================================================

import {
  Body,
  Controller,
  ForbiddenException,
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
import { UserTipo } from '@gestionale/db';
import { AuthErrorCode } from '@gestionale/shared';

import { ComunicazioniService } from './comunicazioni.service';
import { ReplyClienteDto } from './dto/reply-cliente.dto';

@Controller('portale/comunicazioni')
export class PortaleComunicazioniController {
  constructor(@Inject(ComunicazioniService) private readonly comunicazioni: ComunicazioniService) {}

  // ── Lista thread della propria azienda ───────────────────────────────────────
  @Get()
  @RequirePermissions('portale.comunicazioni.visualizza')
  async list(@CurrentUser() user: AuthenticatedUser | undefined) {
    const cliente = assertCliente(user);
    const data = await this.comunicazioni.listForCliente(cliente.tenantId, cliente.aziendaId);
    return { data };
  }

  // ── Dettaglio thread (note interne escluse) ───────────────────────────────────
  @Get(':id')
  @RequirePermissions('portale.comunicazioni.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    const cliente = assertCliente(user);
    const data = await this.comunicazioni.getForCliente(cliente.tenantId, cliente.aziendaId, id);
    return { data };
  }

  // ── Reply lato cliente ────────────────────────────────────────────────────────
  @Post(':id/messaggi')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('portale.comunicazioni.rispondi')
  async reply(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: ReplyClienteDto,
  ) {
    const cliente = assertCliente(user);
    const data = await this.comunicazioni.replyCliente(
      cliente.tenantId,
      cliente.aziendaId,
      id,
      cliente.id,
      dto,
    );
    return { data };
  }

  // ── Marca i messaggi studio come letti dal cliente ───────────────────────────
  @Patch(':id/letto-cliente')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('portale.comunicazioni.visualizza')
  async marcaLetto(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    const cliente = assertCliente(user);
    const data = await this.comunicazioni.markLettoCliente(cliente.tenantId, cliente.aziendaId, id);
    return { data };
  }
}

/**
 * Restringe il principal a un cliente con azienda. Ridondante con RBAC (solo il
 * template "Cliente" ha `portale.*`) + CHECK DB, ma rende lo scoping per-azienda
 * type-safe (`aziendaId: string`) e fallisce chiuso se l'invariante è violata.
 */
function assertCliente(
  user: AuthenticatedUser | undefined,
): AuthenticatedUser & { aziendaId: string } {
  if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
  if (user.tipo !== UserTipo.cliente || !user.aziendaId) {
    throw new ForbiddenException({
      errorCode: 'E_PORTALE_COMUNICAZIONI_FORBIDDEN',
      message: 'Portale comunicazioni is reserved to cliente principals',
    });
  }
  return user as AuthenticatedUser & { aziendaId: string };
}
