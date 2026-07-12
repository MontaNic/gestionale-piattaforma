// =============================================================================
// comande.service.ts — Feed KDS + transizioni stato Comanda (ADR-0069)
// =============================================================================
// Consumer del layer Comanda (creato da ContiService.invia). Due operazioni:
//   - list  (feed KDS): query singola con include righe+tavolo, NIENTE N+1,
//     niente prezzi (la cucina non li usa). Default = comande NON-pronte di conti
//     non-annullati (semantica feed (i): aperto ∪ chiuso, esclude annullato).
//   - cambiaStato: transizione FORWARD-ONLY (inviata→in_preparazione→pronta,
//     skip inviata→pronta ammesso). Timestamp per transizione. Audit-in-tx.
// Read → this.db.prisma (context ALS attivo). Mutazione → withTenantContextAtomicTx.
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  id,
  Prisma,
  type PrintDepartment,
  type StatoComanda,
  withTenantContextAtomicTx,
} from '@gestionale/db';

import { DbService } from '@gestionale/db/nest';

// Riga come mostrata sul ticket cucina: solo snapshot utile, MAI il prezzo.
export interface ComandaFeedRiga {
  id: string;
  nomeArticolo: string;
  quantita: number;
  note: string | null;
  reparto: PrintDepartment;
}

export interface ComandaFeedItem {
  id: string;
  contoId: string;
  reparto: PrintDepartment;
  stato: StatoComanda;
  inviataIl: Date;
  inPreparazioneIl: Date | null;
  prontaIl: Date | null;
  tavoloId: string | null;
  tavoloNumero: string | null;
  righe: ComandaFeedRiga[];
}

// Ordine forward-only: una transizione è valida sse il target viene DOPO lo stato
// attuale (mai indietro, mai sullo stesso). Ammette lo skip inviata→pronta (cucina
// veloce). Nessuno stato `servita` (fuori scope). `indexOf` → number (evita
// l'undefined del Record index sotto noUncheckedIndexedAccess).
const STATO_ORDER: readonly StatoComanda[] = ['inviata', 'in_preparazione', 'pronta'];
const rank = (s: StatoComanda): number => STATO_ORDER.indexOf(s);

@Injectable()
export class ComandeService {
  private readonly logger = new Logger(ComandeService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async list(
    tenantId: string,
    filters?: { stato?: StatoComanda; reparto?: PrintDepartment; contoId?: string },
  ): Promise<ComandaFeedItem[]> {
    const where: Prisma.ComandaWhereInput = { tenantId };
    // Default feed = non-pronte; con stato esplicito filtra quello.
    where.stato = filters?.stato ?? { in: ['inviata', 'in_preparazione'] };
    if (filters?.reparto) where.reparto = filters.reparto;
    if (filters?.contoId) where.contoId = filters.contoId;
    // Semantica feed (i): la cucina non prepara piatti di conti ANNULLATI; i conti
    // chiusi (pagati) restano visibili finché non-pronti (chiudere non ostaggia).
    where.conto = { stato: { not: 'annullato' } };

    const comande = await this.db.prisma.comanda.findMany({
      where,
      orderBy: { inviataIl: 'asc' }, // FIFO cucina
      include: {
        conto: { select: { tavoloId: true, tavolo: { select: { numero: true } } } },
        righe: {
          // `stornata` NON esclusa (ADR-storno): la riga revocata resta visibile
          // marcata finché la comanda è nel feed → sana la sparizione silenziosa.
          // Solo le soft-deleted (pending rimosse) restano fuori.
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            nomeArticolo: true,
            quantita: true,
            note: true,
            reparto: true,
            stornata: true,
          },
        },
      },
    });

    return comande.map((c) => ({
      id: c.id,
      contoId: c.contoId,
      reparto: c.reparto,
      stato: c.stato,
      inviataIl: c.inviataIl,
      inPreparazioneIl: c.inPreparazioneIl,
      prontaIl: c.prontaIl,
      tavoloId: c.conto.tavoloId,
      tavoloNumero: c.conto.tavolo?.numero ?? null,
      righe: c.righe,
    }));
  }

  async cambiaStato(
    tenantId: string,
    userId: string,
    comandaId: string,
    target: StatoComanda,
  ): Promise<{ id: string; stato: StatoComanda }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const comanda = await tx.comanda.findFirst({ where: { id: comandaId, tenantId } });
      if (!comanda) {
        throw new NotFoundException({
          errorCode: 'E_COMANDA_NOT_FOUND',
          message: 'Comanda not found',
        });
      }

      // Forward-only: mai indietro, mai stesso stato; skip inviata→pronta ammesso.
      if (rank(target) <= rank(comanda.stato)) {
        throw new ConflictException({
          errorCode: 'E_COMANDA_INVALID_TRANSITION',
          message: `Invalid transition ${comanda.stato} → ${target}`,
        });
      }

      const data: Prisma.ComandaUpdateInput = { stato: target };
      if (target === 'in_preparazione') data.inPreparazioneIl = new Date();
      if (target === 'pronta') data.prontaIl = new Date();

      const updated = await tx.comanda.update({ where: { id: comandaId }, data });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'comanda.stato_cambiato',
          entityType: 'Comanda',
          entityId: comandaId,
          beforeValue: { stato: comanda.stato },
          afterValue: { stato: updated.stato },
        },
      });

      this.logger.log(`Comanda ${comanda.stato}→${updated.stato}: ${comandaId} tenant=${tenantId}`);
      return { id: updated.id, stato: updated.stato };
    });
  }
}
