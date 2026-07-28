// =============================================================================
// dashboard-api.ts — Data access client KPI dashboard (ADR-0084)
// =============================================================================
// Stesso stampo di conti-api.ts / menu-api.ts: funzione tipizzata sopra i
// wrapper `@gestionale/api-client`, nessun react-query/SWR, il caller chiama
// dentro `useEffect` e gestisce lo stato React locale.
//
// Normalizzazione Decimal→number: `incassoOggi` viaggia come STRINGA (Prisma
// Decimal serializzato, ADR-0084 D1). Il mapper la converte qui, in un solo
// punto, così la UI riceve sempre un `number` da passare a `formatEuro`.
// Nessun calcolo di dominio va fatto su quel number: è solo display.
//
// Gate BE: `report.operativo.visualizza`. La pagina NON deve chiamare questa
// funzione senza quel permesso — non per difesa (il BE risponde 403 comunque),
// ma perché il page-tour e2e fallisce su qualunque response ≥400.
// =============================================================================

import { apiGet } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

import type { DashboardStats } from './dashboard-types';

interface Wrapped<T> {
  data: T;
}

type RawDashboardStats = Omit<DashboardStats, 'incassoOggi'> & { incassoOggi: string };

export async function getDashboardStats(): Promise<DashboardStats> {
  const res = await apiGet<Wrapped<RawDashboardStats>>('/dashboard/stats', authOptions());
  return { ...res.data, incassoOggi: Number(res.data.incassoOggi) };
}
