// =============================================================================
// conti.service.ts — Operatività COMANDE (PR-2, ADR-0068)
// =============================================================================
// Segue il template tables.service 1:1:
// - read single-op → this.db.prisma (context ALS attivo)
// - mutazioni → withTenantContextAtomicTx (multi-statement + audit atomici)
// - audit inline dentro il tx (action namespaced conto.*/conto_riga.*)
// - soft-delete via tx.update({ deletedAt }) — MAI tx.delete() (caveat ADR-0021)
//
// Regole di dominio (scope-lock PR-2):
// - Coerenza canale↔tavolo (D3): cassa ⇒ tavoloId obbligatorio; asporto/delivery/
//   menu_online ⇒ tavoloId assente. Violazione → E_CONTO_CHANNEL_TAVOLO_MISMATCH.
// - State machine (D5): StatoConto aperto → {chiuso, annullato} (terminali).
//   Ogni mutazione (righe, chiudi, annulla) esige stato `aperto` → E_CONTO_NOT_OPEN.
// - Snapshot pricing (D2): prezzo/nome/reparto congelati via PricingService.
// - Totale conto: derivato in read (mai persistito — YAGNI).
// =============================================================================

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  type Conto,
  type ContoRiga,
  id,
  Prisma,
  type StatoConto,
  withTenantContextAtomicTx,
} from '@gestionale/db';

import { DbService } from '@gestionale/db/nest';
import type { TenantTx } from '../common/tenant-tx.type';
import { PricingService } from '../pricing/pricing.service';
import type { CreateContoDto } from './dto/create-conto.dto';
import type { AddRigaDto } from './dto/add-riga.dto';
import type { UpdateRigaDto } from './dto/update-riga.dto';

export type ContoWithRighe = Conto & { righe: ContoRiga[]; totale: string };

@Injectable()
export class ContiService {
  private readonly logger = new Logger(ContiService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  // --- reads -----------------------------------------------------------------

  async list(
    tenantId: string,
    filters?: { stato?: StatoConto; tavoloId?: string },
  ): Promise<Conto[]> {
    // Filtri opzionali (PR-1 FE): applicati solo se presenti → nessun param =
    // comportamento identico al precedente (backward-compat).
    const where: Prisma.ContoWhereInput = { tenantId };
    if (filters?.stato) where.stato = filters.stato;
    if (filters?.tavoloId) where.tavoloId = filters.tavoloId;

    return this.db.prisma.conto.findMany({
      where,
      orderBy: [{ apertoIl: 'desc' }],
    });
  }

  async getById(tenantId: string, contoId: string): Promise<ContoWithRighe> {
    const conto = await this.db.prisma.conto.findFirst({
      where: { id: contoId, tenantId },
      include: {
        // filtro esplicito deletedAt: le righe stornate non entrano nel totale
        righe: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conto) {
      throw new NotFoundException({ errorCode: 'E_CONTO_NOT_FOUND', message: 'Conto not found' });
    }
    return { ...conto, totale: this.computeTotale(conto.righe) };
  }

  private computeTotale(righe: ContoRiga[]): string {
    const totale = righe.reduce(
      (acc, r) => acc.plus(r.prezzoUnitario.times(r.quantita)),
      new Prisma.Decimal(0),
    );
    return totale.toFixed(2);
  }

  // --- lifecycle conto -------------------------------------------------------

  async create(tenantId: string, userId: string, dto: CreateContoDto): Promise<Conto> {
    this.assertChannelTavoloCoherent(dto.channel, dto.tavoloId);

    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      if (dto.tavoloId) {
        const tavolo = await tx.tavolo.findFirst({ where: { id: dto.tavoloId, tenantId } });
        if (!tavolo) {
          throw new NotFoundException({
            errorCode: 'E_TAVOLO_NOT_FOUND',
            message: 'Tavolo not found',
          });
        }
      }

      const conto = await tx.conto.create({
        data: {
          id: id(),
          tenantId,
          channel: dto.channel,
          coperti: dto.coperti ?? null,
          tavoloId: dto.tavoloId ?? null,
          stato: 'aperto',
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto.aperto',
          entityType: 'Conto',
          entityId: conto.id,
          afterValue: {
            channel: conto.channel,
            coperti: conto.coperti,
            tavoloId: conto.tavoloId,
            stato: conto.stato,
          },
        },
      });

      this.logger.log(`Conto aperto: ${conto.id} channel=${conto.channel} tenant=${tenantId}`);
      return conto;
    });
  }

  async chiudi(tenantId: string, userId: string, contoId: string): Promise<Conto> {
    return this.transitionStato(tenantId, userId, contoId, 'chiuso', 'conto.chiuso');
  }

  async annulla(tenantId: string, userId: string, contoId: string): Promise<Conto> {
    return this.transitionStato(tenantId, userId, contoId, 'annullato', 'conto.annullato');
  }

  private async transitionStato(
    tenantId: string,
    userId: string,
    contoId: string,
    target: 'chiuso' | 'annullato',
    action: 'conto.chiuso' | 'conto.annullato',
  ): Promise<Conto> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const conto = await this.loadOpenConto(tx, tenantId, contoId);

      const updated = await tx.conto.update({
        where: { id: contoId },
        data: {
          stato: target,
          // chiusoIl valorizzato solo alla chiusura; annullato non è "chiuso".
          chiusoIl: target === 'chiuso' ? new Date() : conto.chiusoIl,
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action,
          entityType: 'Conto',
          entityId: contoId,
          beforeValue: { stato: conto.stato },
          afterValue: { stato: updated.stato, chiusoIl: updated.chiusoIl },
        },
      });

      this.logger.log(`Conto ${target}: ${contoId} tenant=${tenantId}`);
      return updated;
    });
  }

  // --- righe -----------------------------------------------------------------

  async addRiga(
    tenantId: string,
    userId: string,
    contoId: string,
    dto: AddRigaDto,
  ): Promise<ContoRiga> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const conto = await this.loadOpenConto(tx, tenantId, contoId);

      const snapshot = await this.pricing.resolveLineSnapshot(
        tx,
        tenantId,
        dto.articleId,
        conto.channel,
      );

      const riga = await tx.contoRiga.create({
        data: {
          id: id(),
          tenantId,
          contoId,
          articleId: dto.articleId,
          nomeArticolo: snapshot.nomeArticolo,
          prezzoUnitario: snapshot.prezzoUnitario,
          quantita: dto.quantita,
          reparto: snapshot.reparto,
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto_riga.aggiunta',
          entityType: 'ContoRiga',
          entityId: riga.id,
          afterValue: {
            contoId,
            articleId: riga.articleId,
            nomeArticolo: riga.nomeArticolo,
            prezzoUnitario: riga.prezzoUnitario.toString(),
            quantita: riga.quantita,
            reparto: riga.reparto,
          },
        },
      });

      this.logger.log(`ContoRiga aggiunta: ${riga.id} conto=${contoId} tenant=${tenantId}`);
      return riga;
    });
  }

  async updateRiga(
    tenantId: string,
    userId: string,
    contoId: string,
    rigaId: string,
    dto: UpdateRigaDto,
  ): Promise<ContoRiga> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await this.loadOpenConto(tx, tenantId, contoId);
      const before = await this.loadRiga(tx, tenantId, contoId, rigaId);

      const updated = await tx.contoRiga.update({
        where: { id: rigaId },
        data: { quantita: dto.quantita },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto_riga.modificata',
          entityType: 'ContoRiga',
          entityId: rigaId,
          beforeValue: { quantita: before.quantita },
          afterValue: { quantita: updated.quantita },
        },
      });

      return updated;
    });
  }

  async stornaRiga(
    tenantId: string,
    userId: string,
    contoId: string,
    rigaId: string,
  ): Promise<{ id: string; deleted: true }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await this.loadOpenConto(tx, tenantId, contoId);
      const before = await this.loadRiga(tx, tenantId, contoId, rigaId);

      // Soft-delete via update deletedAt (ADR-0021): mai tx.delete().
      await tx.contoRiga.update({ where: { id: rigaId }, data: { deletedAt: new Date() } });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto_riga.stornata',
          entityType: 'ContoRiga',
          entityId: rigaId,
          beforeValue: {
            articleId: before.articleId,
            nomeArticolo: before.nomeArticolo,
            prezzoUnitario: before.prezzoUnitario.toString(),
            quantita: before.quantita,
          },
        },
      });

      this.logger.log(`ContoRiga stornata: ${rigaId} conto=${contoId} tenant=${tenantId}`);
      return { id: rigaId, deleted: true };
    });
  }

  // --- helpers ---------------------------------------------------------------

  /** Coerenza canale↔tavolo (D3). Pura sul DTO, prima del tx. */
  private assertChannelTavoloCoherent(channel: Channel, tavoloId: string | undefined): void {
    const requiresTavolo = channel === Channel.cassa;
    if (requiresTavolo && !tavoloId) {
      throw new BadRequestException({
        errorCode: 'E_CONTO_CHANNEL_TAVOLO_MISMATCH',
        message: `Channel '${channel}' requires a tavoloId`,
      });
    }
    if (!requiresTavolo && tavoloId) {
      throw new BadRequestException({
        errorCode: 'E_CONTO_CHANNEL_TAVOLO_MISMATCH',
        message: `Channel '${channel}' must not have a tavoloId`,
      });
    }
  }

  /** Carica un conto e ne esige lo stato `aperto` (state machine D5). */
  private async loadOpenConto(tx: TenantTx, tenantId: string, contoId: string): Promise<Conto> {
    const conto = await tx.conto.findFirst({ where: { id: contoId, tenantId } });
    if (!conto) {
      throw new NotFoundException({ errorCode: 'E_CONTO_NOT_FOUND', message: 'Conto not found' });
    }
    if (conto.stato !== 'aperto') {
      throw new ConflictException({
        errorCode: 'E_CONTO_NOT_OPEN',
        message: `Conto is '${conto.stato}', not 'aperto'`,
      });
    }
    return conto;
  }

  /** Carica una riga live del conto (soft-deleted escluse dall'extension). */
  private async loadRiga(
    tx: TenantTx,
    tenantId: string,
    contoId: string,
    rigaId: string,
  ): Promise<ContoRiga> {
    const riga = await tx.contoRiga.findFirst({ where: { id: rigaId, contoId, tenantId } });
    if (!riga) {
      throw new NotFoundException({
        errorCode: 'E_CONTO_RIGA_NOT_FOUND',
        message: 'Conto riga not found',
      });
    }
    return riga;
  }
}
