// =============================================================================
// report-api.ts — Data access report analitici (ADR-0054)
// =============================================================================
// /report/margine: aggregazione read-only. I numeri arrivano già calcolati
// server-side (non sono Prisma Decimal grezzi) → nessuna normalizzazione.
// =============================================================================

import { apiGet } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

import type { StatoMandato } from './mandati-api';

interface Wrapped<T> {
  data: T;
}

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
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
