// =============================================================================
// report-api.ts — Data access report analitici (ADR-0054)
// =============================================================================
// /report/margine: aggregazione read-only. I numeri arrivano già calcolati
// server-side (non sono Prisma Decimal grezzi) → nessuna normalizzazione.
// =============================================================================

import { apiGet, apiPost } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

import type { StatoMandato } from './mandati-api';

interface Wrapped<T> {
  data: T;
}

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

export async function getMargine(): Promise<MargineRow[]> {
  const res = await apiGet<Wrapped<MargineRow[]>>('/report/margine', authOptions());
  return res.data;
}

export interface MargineInsight {
  // null nel path deterministico (< 2 mandati): il FE localizza il messaggio.
  insight: string | null;
  aiGenerated: boolean;
  copertura: { totali: number; conPrestazioni: number };
}

// Sintesi AI dei margini (ADR-0057). POST: azione, non lettura idempotente.
// 503 (E_AI_DISABLED/E_AI_UPSTREAM/E_AI_EMPTY) se la feature AI non risponde.
export async function getMargineInsight(): Promise<MargineInsight> {
  const res = await apiPost<Wrapped<MargineInsight>>('/report/margine/insight', {}, authOptions());
  return res.data;
}
