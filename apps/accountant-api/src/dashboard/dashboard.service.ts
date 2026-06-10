// =============================================================================
// dashboard.service.ts — KPI aggregati tenant-level (STOP-dash1 ADR-0038)
// =============================================================================
// PRIMO uso di query aggregate del progetto (count/groupBy/aggregate). Girano
// automaticamente sotto il tenant context RLS: l'extension rls.ts intercetta
// `$allOperations` (tutte le model-op, non solo CRUD) → SET LOCAL app.tenant_id
// (ADR-0009). Inoltre softDeleteExtension intercetta count/aggregate/groupBy e
// inietta `where.deletedAt = null` (verificato STOP 0) → niente filtro esplicito.
// Per coerenza coi service esistenti (aziende/preventivi) passiamo comunque
// `where: { tenantId }` come difesa applicativa in-depth.
//
// Read-only: nessuna modifica ai service di dominio, nessuna scrittura.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';
import { StatoPreventivo, TipoCliente } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';

export interface UltimoPreventivo {
  id: string;
  codice: string;
  oggetto: string;
  stato: StatoPreventivo;
  totale: number;
  aziendaId: string;
  aziendaNome: string;
  updatedAt: string; // ISO
}

export interface DashboardStats {
  clienti: {
    // Due tagli ortogonali dello stesso insieme (aziende non-deleted):
    // taglio stato (attivi/nonAttivi) e taglio tipo (perTipo). Entrambi sommano
    // a `totale` ma non si spiegano a vicenda.
    totale: number;
    attivi: number;
    nonAttivi: number;
    perTipo: { azienda: number; personaFisica: number };
  };
  preventivi: {
    totale: number;
    perStato: { bozza: number; inviato: number; accettato: number; rifiutato: number };
    valoreTotale: number;
    ultimi: UltimoPreventivo[];
  };
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async getStats(tenantId: string): Promise<DashboardStats> {
    const prisma = this.db.prisma;

    const [
      totaleClienti,
      clientiAttivi,
      clientiNonAttivi,
      aziendePerTipo,
      totalePreventivi,
      preventiviPerStato,
      sommaValore,
      ultimiRaw,
    ] = await Promise.all([
      // 3 count indipendenti (tutti RLS + softDelete filtered): l'invariante
      // attivi + nonAttivi == totale è garantita perché filtrano lo stesso set.
      prisma.azienda.count({ where: { tenantId } }),
      prisma.azienda.count({ where: { tenantId, attivo: true } }),
      prisma.azienda.count({ where: { tenantId, attivo: false } }),
      prisma.azienda.groupBy({ by: ['tipoCliente'], where: { tenantId }, _count: true }),
      prisma.preventivo.count({ where: { tenantId } }),
      prisma.preventivo.groupBy({ by: ['stato'], where: { tenantId }, _count: true }),
      prisma.preventivo.aggregate({ where: { tenantId }, _sum: { totale: true } }),
      prisma.preventivo.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: { azienda: { select: { nome: true } } },
      }),
    ]);

    // groupBy → mappe con default 0 sui valori enum mancanti.
    const perTipo = { azienda: 0, personaFisica: 0 };
    for (const row of aziendePerTipo) {
      if (row.tipoCliente === TipoCliente.azienda) perTipo.azienda = row._count;
      else if (row.tipoCliente === TipoCliente.persona_fisica) perTipo.personaFisica = row._count;
    }

    const perStato = { bozza: 0, inviato: 0, accettato: 0, rifiutato: 0 };
    for (const row of preventiviPerStato) {
      if (row.stato === StatoPreventivo.bozza) perStato.bozza = row._count;
      else if (row.stato === StatoPreventivo.inviato) perStato.inviato = row._count;
      else if (row.stato === StatoPreventivo.accettato) perStato.accettato = row._count;
      else if (row.stato === StatoPreventivo.rifiutato) perStato.rifiutato = row._count;
    }

    const ultimi: UltimoPreventivo[] = ultimiRaw.map((p) => ({
      id: p.id,
      codice: p.codice,
      oggetto: p.oggetto,
      stato: p.stato,
      totale: p.totale.toNumber(),
      aziendaId: p.aziendaId,
      aziendaNome: p.azienda.nome,
      updatedAt: p.updatedAt.toISOString(),
    }));

    return {
      clienti: {
        totale: totaleClienti,
        attivi: clientiAttivi,
        nonAttivi: clientiNonAttivi,
        perTipo,
      },
      preventivi: {
        totale: totalePreventivi,
        perStato,
        valoreTotale: sommaValore._sum.totale ? sommaValore._sum.totale.toNumber() : 0,
        ultimi,
      },
    };
  }
}
