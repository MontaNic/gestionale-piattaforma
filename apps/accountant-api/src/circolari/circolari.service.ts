// =============================================================================
// circolari.service.ts — broadcast unidirezionale studio→clienti (verticale accountant, ADR-0045)
// =============================================================================
// Pattern replicato da preventivi (testata + figli in transazione atomica via
// withTenantContextAtomicTx) + documenti (soft-delete via update({deletedAt}),
// MAI .delete(); read senza filtro deletedAt → la softDeleteExtension lo applica).
//
// Macchina di stato MVP (livello 1, operatore):
//   bozza ──publish──▶ pubblicata ──archive──▶ archiviata
// Modifica/elimina ammesse SOLO su 'bozza'. `circolari_letture` e
// `richiede_conferma` sono DEFER al livello 2 (portale cliente) → nessun
// riferimento qui. Email alla pubblicazione: DEFER (solo in-app). `destinatari`
// tipo='utente' è enum-value forward (livello 2): rifiutato in validazione.
// =============================================================================

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CircolareStato,
  DestinatarioTipo,
  Prisma,
  type Circolare,
  id,
  withTenantContextAtomicTx,
} from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';

import type { CreateCircolareDto, CreateDestinatarioDto } from './dto/create-circolare.dto';
import type { UpdateCircolareDto } from './dto/update-circolare.dto';

// Tipo di lettura standard per il detail: testata + destinatari.
export type CircolareWithDestinatari = Prisma.CircolareGetPayload<{
  include: { destinatari: true };
}>;

export interface CircolariListFilter {
  stato?: CircolareStato;
}

// ── Viste lato cliente (portale, ADR-0048) ───────────────────────────────────
// Shape ridotto e cliente-safe: niente tenantId/deletedAt/destinatari; aggiunge
// lo stato lettura/conferma del cliente corrente. `letta`=true se esiste una riga
// circolari_letture per (circolare, utente); `confermata`=true se confermataAt set.
export interface ClienteCircolareListView {
  id: string;
  titolo: string;
  oggettoEmail: string;
  priorita: number;
  richiedeConferma: boolean;
  pubblicataIl: Date | null;
  scadeIl: Date | null;
  letta: boolean;
  confermata: boolean;
}

export interface ClienteCircolareDetailView extends ClienteCircolareListView {
  bodyHtml: string;
}

// Circolare con la (sola) lettura del cliente corrente — include filtrato per userId.
type CircolareConLetturaCliente = Prisma.CircolareGetPayload<{
  include: { letture: true };
}>;

@Injectable()
export class CircolariService {
  private readonly logger = new Logger(CircolariService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async list(tenantId: string, filter: CircolariListFilter = {}): Promise<Circolare[]> {
    return this.db.prisma.circolare.findMany({
      where: {
        tenantId,
        ...(filter.stato ? { stato: filter.stato } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(tenantId: string, circolareId: string): Promise<CircolareWithDestinatari> {
    const circolare = await this.db.prisma.circolare.findFirst({
      where: { id: circolareId, tenantId },
      include: { destinatari: true },
    });
    if (!circolare) {
      throw new NotFoundException({
        errorCode: 'E_CIRCOLARE_NOT_FOUND',
        message: 'Circolare not found',
      });
    }
    return circolare;
  }

  async create(tenantId: string, dto: CreateCircolareDto): Promise<CircolareWithDestinatari> {
    await this.validateDestinatari(tenantId, dto.destinatari);

    const circolareId = id();
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await tx.circolare.create({
        data: {
          id: circolareId,
          tenantId,
          titolo: dto.titolo,
          oggettoEmail: dto.oggettoEmail,
          bodyHtml: dto.bodyHtml,
          priorita: dto.priorita ?? 0,
          richiedeConferma: dto.richiedeConferma ?? false,
          scadeIl: dto.scadeIl ? new Date(dto.scadeIl) : null,
          // stato → default 'bozza'; pubblicataIl resta null fino a publish().
        },
      });
      await tx.circolareDestinatario.createMany({
        data: dto.destinatari.map((d) => ({
          id: id(),
          tenantId,
          circolareId,
          tipo: d.tipo,
          aziendaId: d.tipo === DestinatarioTipo.azienda ? (d.aziendaId ?? null) : null,
        })),
      });
      const created = await tx.circolare.findFirstOrThrow({
        where: { id: circolareId },
        include: { destinatari: true },
      });
      this.logger.log(`Circolare created: ${circolareId} (bozza) tenant=${tenantId}`);
      return created;
    });
  }

  async update(
    tenantId: string,
    circolareId: string,
    dto: UpdateCircolareDto,
  ): Promise<CircolareWithDestinatari> {
    const before = await this.db.prisma.circolare.findFirst({
      where: { id: circolareId, tenantId },
    });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_CIRCOLARE_NOT_FOUND',
        message: 'Circolare not found',
      });
    }
    if (before.stato !== CircolareStato.bozza) {
      throw new UnprocessableEntityException({
        errorCode: 'E_CIRCOLARE_NOT_EDITABLE',
        message: 'Only circolari in stato=bozza can be edited',
      });
    }
    if (dto.destinatari) {
      await this.validateDestinatari(tenantId, dto.destinatari);
    }

    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await tx.circolare.update({
        where: { id: circolareId },
        data: {
          titolo: dto.titolo,
          oggettoEmail: dto.oggettoEmail,
          bodyHtml: dto.bodyHtml,
          priorita: dto.priorita,
          richiedeConferma: dto.richiedeConferma,
          scadeIl: dto.scadeIl !== undefined ? new Date(dto.scadeIl) : undefined,
        },
      });

      // Replace integrale destinatari (solo se presente nel body).
      if (dto.destinatari) {
        await tx.circolareDestinatario.deleteMany({ where: { circolareId } });
        await tx.circolareDestinatario.createMany({
          data: dto.destinatari.map((d) => ({
            id: id(),
            tenantId,
            circolareId,
            tipo: d.tipo,
            aziendaId: d.tipo === DestinatarioTipo.azienda ? (d.aziendaId ?? null) : null,
          })),
        });
      }

      return tx.circolare.findFirstOrThrow({
        where: { id: circolareId },
        include: { destinatari: true },
      });
    });
  }

  // bozza → pubblicata: setta pubblicataIl. Email DEFER (solo in-app).
  async publish(tenantId: string, circolareId: string): Promise<Circolare> {
    const before = await this.requireForTransition(tenantId, circolareId);
    if (before.stato !== CircolareStato.bozza) {
      throw new UnprocessableEntityException({
        errorCode: 'E_CIRCOLARE_NOT_BOZZA',
        message: 'Only circolari in stato=bozza can be published',
      });
    }
    const updated = await this.db.prisma.circolare.update({
      where: { id: circolareId },
      data: { stato: CircolareStato.pubblicata, pubblicataIl: new Date() },
    });
    this.logger.log(`Circolare published: ${circolareId} tenant=${tenantId}`);
    return updated;
  }

  // pubblicata → archiviata.
  async archive(tenantId: string, circolareId: string): Promise<Circolare> {
    const before = await this.requireForTransition(tenantId, circolareId);
    if (before.stato !== CircolareStato.pubblicata) {
      throw new UnprocessableEntityException({
        errorCode: 'E_CIRCOLARE_NOT_PUBBLICATA',
        message: 'Only circolari in stato=pubblicata can be archived',
      });
    }
    const updated = await this.db.prisma.circolare.update({
      where: { id: circolareId },
      data: { stato: CircolareStato.archiviata },
    });
    this.logger.log(`Circolare archived: ${circolareId} tenant=${tenantId}`);
    return updated;
  }

  // Soft-delete: ammesso solo su 'bozza' (una circolare pubblicata si archivia).
  async softDelete(tenantId: string, circolareId: string): Promise<{ id: string; deleted: true }> {
    const before = await this.requireForTransition(tenantId, circolareId);
    if (before.stato !== CircolareStato.bozza) {
      throw new UnprocessableEntityException({
        errorCode: 'E_CIRCOLARE_NOT_BOZZA',
        message: 'Only circolari in stato=bozza can be deleted (use archive for pubblicata)',
      });
    }
    await this.db.prisma.circolare.update({
      where: { id: circolareId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Circolare soft-deleted: ${circolareId} tenant=${tenantId}`);
    return { id: circolareId, deleted: true };
  }

  // ── Lato cliente (portale, ADR-0048) ─────────────────────────────────────────
  // Superficie read + presa-visione: il cliente vede solo le circolari PUBBLICATE
  // indirizzate alla propria azienda (destinatario 'tutti' o 'azienda'+aziendaId).
  // Lo scoping è SEMPRE dentro la query (clienteWhere): una circolare non visibile
  // è indistinguibile da una inesistente (404), niente leak per id indovinato.

  async listForCliente(
    tenantId: string,
    aziendaId: string,
    userId: string,
  ): Promise<ClienteCircolareListView[]> {
    const circolari = await this.db.prisma.circolare.findMany({
      where: this.clienteWhere(tenantId, aziendaId),
      orderBy: { pubblicataIl: 'desc' },
      include: { letture: { where: { userId } } },
    });
    return circolari.map((c) => this.toClienteListView(c));
  }

  // Dettaglio + markLetta on-open (upsert idempotente: non re-tocca lettaAt né
  // confermataAt). Il body è restituito grezzo come testo (TD-circolari-render:
  // niente HTML finché non c'è sanitizzazione server-side).
  async getForCliente(
    tenantId: string,
    aziendaId: string,
    userId: string,
    circolareId: string,
  ): Promise<ClienteCircolareDetailView> {
    const circolare = await this.db.prisma.circolare.findFirst({
      where: { ...this.clienteWhere(tenantId, aziendaId), id: circolareId },
      include: { letture: { where: { userId } } },
    });
    if (!circolare) {
      throw new NotFoundException({
        errorCode: 'E_CIRCOLARE_NOT_FOUND',
        message: 'Circolare not found',
      });
    }
    await this.markLetta(tenantId, circolareId, userId);
    return {
      ...this.toClienteListView(circolare),
      letta: true, // appena segnata
      bodyHtml: circolare.bodyHtml,
    };
  }

  // Conferma di presa-visione. 422 se la circolare non la richiede. Idempotente:
  // una conferma già registrata non viene sovrascritta (timestamp originale).
  async confermaCliente(
    tenantId: string,
    aziendaId: string,
    userId: string,
    circolareId: string,
  ): Promise<{ confermataAt: Date }> {
    const circolare = await this.db.prisma.circolare.findFirst({
      where: { ...this.clienteWhere(tenantId, aziendaId), id: circolareId },
      select: { id: true, richiedeConferma: true },
    });
    if (!circolare) {
      throw new NotFoundException({
        errorCode: 'E_CIRCOLARE_NOT_FOUND',
        message: 'Circolare not found',
      });
    }
    if (!circolare.richiedeConferma) {
      throw new UnprocessableEntityException({
        errorCode: 'E_CIRCOLARE_NO_CONFERMA',
        message: 'Questa circolare non richiede conferma di lettura',
      });
    }

    const existing = await this.db.prisma.circolareLettura.findUnique({
      where: { circolareId_userId: { circolareId, userId } },
      select: { confermataAt: true },
    });
    if (existing?.confermataAt) {
      return { confermataAt: existing.confermataAt };
    }

    const now = new Date();
    await this.db.prisma.circolareLettura.upsert({
      where: { circolareId_userId: { circolareId, userId } },
      create: { id: id(), tenantId, circolareId, userId, lettaAt: now, confermataAt: now },
      update: { confermataAt: now },
    });
    this.logger.log(`Circolare confermata: ${circolareId} user=${userId} tenant=${tenantId}`);
    return { confermataAt: now };
  }

  // Segna la circolare come letta (upsert idempotente). `update: {}` → riapertura
  // del dettaglio non sposta lettaAt e non azzera una eventuale conferma.
  private async markLetta(tenantId: string, circolareId: string, userId: string): Promise<void> {
    await this.db.prisma.circolareLettura.upsert({
      where: { circolareId_userId: { circolareId, userId } },
      create: { id: id(), tenantId, circolareId, userId },
      update: {},
    });
  }

  // Predicato di visibilità cliente (single source of truth dell'ACL portale):
  // pubblicata + destinatario 'tutti' o 'azienda'+aziendaId. La softDeleteExtension
  // applica deletedAt IS NULL; le bozze/archiviate sono fuori. clienteRuolo non
  // incide (una circolare è un broadcast, non ha visibilità per-ruolo).
  private clienteWhere(tenantId: string, aziendaId: string): Prisma.CircolareWhereInput {
    return {
      tenantId,
      stato: CircolareStato.pubblicata,
      destinatari: {
        some: {
          OR: [{ tipo: DestinatarioTipo.tutti }, { tipo: DestinatarioTipo.azienda, aziendaId }],
        },
      },
    };
  }

  private toClienteListView(c: CircolareConLetturaCliente): ClienteCircolareListView {
    const lettura = c.letture[0];
    return {
      id: c.id,
      titolo: c.titolo,
      oggettoEmail: c.oggettoEmail,
      priorita: c.priorita,
      richiedeConferma: c.richiedeConferma,
      pubblicataIl: c.pubblicataIl,
      scadeIl: c.scadeIl,
      letta: lettura != null,
      confermata: lettura?.confermataAt != null,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async requireForTransition(tenantId: string, circolareId: string): Promise<Circolare> {
    const circolare = await this.db.prisma.circolare.findFirst({
      where: { id: circolareId, tenantId },
    });
    if (!circolare) {
      throw new NotFoundException({
        errorCode: 'E_CIRCOLARE_NOT_FOUND',
        message: 'Circolare not found',
      });
    }
    return circolare;
  }

  // Regole cross-field destinatari (MVP: solo tutti|azienda):
  //   tipo='tutti'   → aziendaId assente
  //   tipo='azienda' → aziendaId obbligatorio + azienda esistente nel tenant
  //   tipo='utente'  → DEFER livello 2 (rifiutato)
  private async validateDestinatari(
    tenantId: string,
    destinatari: CreateDestinatarioDto[],
  ): Promise<void> {
    const aziendaIds = new Set<string>();
    for (const d of destinatari) {
      if (d.tipo === DestinatarioTipo.utente) {
        throw new BadRequestException({
          errorCode: 'E_CIRCOLARE_DESTINATARIO_UTENTE_UNSUPPORTED',
          message: "Destinatario tipo='utente' non supportato nell'MVP (livello 2)",
        });
      }
      if (d.tipo === DestinatarioTipo.azienda) {
        if (!d.aziendaId) {
          throw new BadRequestException({
            errorCode: 'E_CIRCOLARE_DESTINATARIO_AZIENDA_REQUIRED',
            message: "aziendaId is required when tipo='azienda'",
          });
        }
        aziendaIds.add(d.aziendaId);
      }
      if (d.tipo === DestinatarioTipo.tutti && d.aziendaId) {
        throw new BadRequestException({
          errorCode: 'E_CIRCOLARE_DESTINATARIO_TUTTI_NO_AZIENDA',
          message: "aziendaId must be empty when tipo='tutti'",
        });
      }
    }

    if (aziendaIds.size > 0) {
      const found = await this.db.prisma.azienda.findMany({
        where: { tenantId, id: { in: [...aziendaIds] } },
        select: { id: true },
      });
      const foundSet = new Set(found.map((a) => a.id));
      for (const aziendaId of aziendaIds) {
        if (!foundSet.has(aziendaId)) {
          throw new BadRequestException({
            errorCode: 'E_CIRCOLARE_AZIENDA_NOT_FOUND',
            message: `Azienda ${aziendaId} not found for tenant`,
          });
        }
      }
    }
  }
}
