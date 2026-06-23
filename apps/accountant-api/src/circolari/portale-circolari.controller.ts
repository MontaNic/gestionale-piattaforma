// =============================================================================
// portale-circolari.controller.ts — REST /portale/circolari (lettore cliente, ADR-0048)
// =============================================================================
// Superficie SOLO cliente: lista/dettaglio read-only delle circolari pubblicate
// indirizzate alla propria azienda + presa-visione (markLetta on-open implicito
// nel dettaglio) + conferma esplicita. Namespace permessi separato `portale.*`
// (ADR-0046 §6): un operatore non ha `portale.circolari.visualizza`, quindi la
// PermissionsGuard lo blocca a monte. Defense-in-depth: lo scoping per-azienda usa
// `aziendaId`+`id` dal principal; qui asseriamo che il principal sia un cliente
// agganciato a un'azienda (assertCliente, gemello di documenti/comunicazioni).
//
// ORDINE ROTTE: la statica sotto `:id` (`conferma`) è distinta per segmento;
// nessun conflitto con la GET `:id`.
// =============================================================================

import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { UserTipo } from '@gestionale/db';
import { AuthErrorCode } from '@gestionale/shared';

import { CircolariService } from './circolari.service';

@Controller('portale/circolari')
export class PortaleCircolariController {
  constructor(@Inject(CircolariService) private readonly circolari: CircolariService) {}

  // ── Lista circolari della propria azienda (read-only) ─────────────────────────
  @Get()
  @RequirePermissions('portale.circolari.visualizza')
  async list(@CurrentUser() user: AuthenticatedUser | undefined) {
    const cliente = assertCliente(user);
    const data = await this.circolari.listForCliente(
      cliente.tenantId,
      cliente.aziendaId,
      cliente.id,
    );
    return { data };
  }

  // ── Dettaglio (segna come letta al load) ──────────────────────────────────────
  @Get(':id')
  @RequirePermissions('portale.circolari.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    const cliente = assertCliente(user);
    const data = await this.circolari.getForCliente(
      cliente.tenantId,
      cliente.aziendaId,
      cliente.id,
      id,
    );
    return { data };
  }

  // ── Conferma di presa-visione (422 se la circolare non la richiede) ───────────
  @Post(':id/conferma')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('portale.circolari.visualizza')
  async conferma(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    const cliente = assertCliente(user);
    const data = await this.circolari.confermaCliente(
      cliente.tenantId,
      cliente.aziendaId,
      cliente.id,
      id,
    );
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
      errorCode: 'E_PORTALE_CIRCOLARI_FORBIDDEN',
      message: 'Portale circolari is reserved to cliente principals',
    });
  }
  return user as AuthenticatedUser & { aziendaId: string };
}
