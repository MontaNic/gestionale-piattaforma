// =============================================================================
// dashboard-api.ts — Data access client dashboard (STOP-dash1 ADR-0038)
// =============================================================================
// Wrapper su @gestionale/api-client (apiGet), token via getAccessToken(),
// response in { data }. Pattern aziende-api. Endpoint tenant-level (non nested).
// NB: i campi Decimal arrivano già come number (il backend li converte con
// .toNumber() nel service) → niente normalizzazione wire qui.
// =============================================================================

import { apiGet } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

import type { DashboardStats } from './dashboard-types';

interface Wrapped<T> {
  data: T;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const res = await apiGet<Wrapped<DashboardStats>>('/dashboard/stats', authOptions());
  return res.data;
}
