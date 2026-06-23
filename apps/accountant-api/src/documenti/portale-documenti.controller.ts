// =============================================================================
// portale-documenti.controller.ts — REST /portale/documenti (lettore cliente, ADR-0046)
// =============================================================================
// Superficie SOLO cliente: list + download read-only dei propri documenti.
// Namespace permessi separato `portale.*` (ADR-0046 §6) — un operatore non ha
// `portale.documenti.visualizza`, quindi la PermissionsGuard lo blocca a monte.
// Defense-in-depth applicativo (l'RLS resta tenant-flat, ADR-0046 §3): lo scoping
// per-azienda usa `aziendaId` + `clienteRuolo` portati dal principal; qui sopra
// asseriamo che il principal sia un cliente agganciato a un'azienda (CHECK DB
// chk_cliente_azienda_id garantisce l'invariante, questo è il cinturino).
//
// ORDINE ROTTE: nessuna collisione con `:id` (l'unica :id è sotto /download).
// =============================================================================

import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { UserTipo } from '@gestionale/db';
import { AuthErrorCode } from '@gestionale/shared';

import { DocumentiService } from './documenti.service';

@Controller('portale/documenti')
export class PortaleDocumentiController {
  constructor(@Inject(DocumentiService) private readonly documenti: DocumentiService) {}

  // ── Lista (read-only) ──────────────────────────────────────────────────────
  @Get()
  @RequirePermissions('portale.documenti.visualizza')
  async list(@CurrentUser() user: AuthenticatedUser | undefined) {
    const cliente = assertCliente(user);
    const data = await this.documenti.listForCliente(
      cliente.tenantId,
      cliente.aziendaId,
      cliente.clienteRuolo,
    );
    return { data };
  }

  // ── Download (blob, stesso ACL della lista) ───────────────────────────────────
  @Get(':id/download')
  @RequirePermissions('portale.documenti.visualizza')
  async download(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const cliente = assertCliente(user);
    const { documento, object } = await this.documenti.getForDownloadCliente(
      cliente.tenantId,
      cliente.aziendaId,
      cliente.clienteRuolo,
      id,
    );
    return new StreamableFile(object.stream, {
      type: object.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(documento.nomeOriginale)}"`,
      length: object.size,
    });
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
      errorCode: 'E_PORTALE_DOCUMENTI_FORBIDDEN',
      message: 'Portale documenti is reserved to cliente principals',
    });
  }
  return user as AuthenticatedUser & { aziendaId: string };
}
