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

import { GroqService } from '../ai/groq.service';
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

// Copertura dati: quanti mandati hanno importoPrestazioni valorizzato sul totale.
// Il FE mostra il disclaimer da qui, indipendentemente dall'AI (ADR-0057).
export interface MargineCopertura {
  totali: number;
  conPrestazioni: number;
}

export interface MargineInsight {
  // Testo AI (italiano, effimero) quando aiGenerated; null nel path deterministico
  // (< 2 mandati): in quel caso il FE rende una stringa localizzata da copertura
  // e dai dati già caricati, evitando italiano hardcoded dal BE (ADR-0057).
  insight: string | null;
  aiGenerated: boolean;
  copertura: MargineCopertura;
}

@Injectable()
export class ReportService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(GroqService) private readonly groq: GroqService,
  ) {}

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

  // Sintesi AI globale dei margini (ADR-0057). Riusa margine() per i dati, calcola
  // la copertura (mandati con importoPrestazioni valorizzato vs totali) e delega
  // la sintesi a GroqService. 503 se la feature AI è disabilitata (no key).
  async margineInsight(tenantId: string): Promise<MargineInsight> {
    const rows = await this.margine(tenantId);
    const copertura: MargineCopertura = {
      totali: rows.length,
      conPrestazioni: rows.filter((r) => r.importoPrestazioni !== null).length,
    };

    // Guard: con < 2 mandati un'analisi comparativa AI non ha senso (e il modello
    // tende a riempire con commenti sull'assenza di dati). Path deterministico:
    // nessuna chiamata Groq, il FE localizza il messaggio da copertura + righe.
    if (rows.length < 2) {
      return { insight: null, aiGenerated: false, copertura };
    }

    const insight = await this.groq.analizzaMargine(rows);
    return { insight, aiGenerated: true, copertura };
  }
}
