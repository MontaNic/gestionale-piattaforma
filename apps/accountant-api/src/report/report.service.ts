// =============================================================================
// report.service.ts — Report margine per mandato/azienda (ADR-0054, Onda 3 Task 4)
// =============================================================================
// Read-only/aggregazione: nessuno schema nuovo. Per ogni mandato in-scope
// (qualsiasi stato) calcola tre metriche dalle prestazioni:
//   - oreTotali = Σ ore (tutte)
//   - importoPrestazioni = Σ importo (solo righe con importo valorizzato); NULL
//     se nessuna prestazione ha importo (distingue "nessun dato" da "0")
//   - margine = importoConcordato − importoPrestazioni (NULL se importoPrestazioni NULL)
// Ordinamento: margine ASC (peggiori prima); le righe margine=NULL in coda
// (ignoto ≠ peggiore). RLS FORCE scoping tenant via interceptor + filtro tenantId.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';
import { type StatoMandato } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';

import { round2 } from '../common/money.util';

export interface MargineRow {
  mandatoId: string;
  codice: string;
  aziendaId: string;
  aziendaNome: string;
  stato: StatoMandato;
  importoConcordato: number;
  oreTotali: number;
  importoPrestazioni: number | null;
  margine: number | null;
}

@Injectable()
export class ReportService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async margine(tenantId: string): Promise<MargineRow[]> {
    const mandati = await this.db.prisma.mandato.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        codice: true,
        stato: true,
        importoConcordato: true,
        azienda: { select: { id: true, nome: true } },
        prestazioni: {
          where: { deletedAt: null },
          select: { ore: true, importo: true },
        },
      },
    });

    const rows: MargineRow[] = mandati.map((m) => {
      const oreTotali = round2(m.prestazioni.reduce((acc, p) => acc + Number(p.ore), 0));

      const conImporto = m.prestazioni.filter((p) => p.importo !== null);
      const importoPrestazioni =
        conImporto.length === 0
          ? null
          : round2(conImporto.reduce((acc, p) => acc + Number(p.importo), 0));

      const importoConcordato = Number(m.importoConcordato);
      const margine =
        importoPrestazioni === null ? null : round2(importoConcordato - importoPrestazioni);

      return {
        mandatoId: m.id,
        codice: m.codice,
        aziendaId: m.azienda.id,
        aziendaNome: m.azienda.nome,
        stato: m.stato,
        importoConcordato,
        oreTotali,
        importoPrestazioni,
        margine,
      };
    });

    // margine ASC (peggiori prima); null in coda.
    rows.sort((a, b) => {
      if (a.margine === null && b.margine === null) return 0;
      if (a.margine === null) return 1;
      if (b.margine === null) return -1;
      return a.margine - b.margine;
    });

    return rows;
  }
}
