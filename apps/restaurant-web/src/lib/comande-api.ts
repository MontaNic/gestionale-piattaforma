// =============================================================================
// comande-api.ts — Data access client feed KDS (Fase 1, ADR-0069)
// =============================================================================
// Consuma i 2 endpoint BE del feed comande (orfani fino a qui):
//   - GET   /comande            → feed board (default: inviata + in_preparazione)
//   - PATCH /comande/:id/stato  → avanzamento forward-only (inviata→in_prep→pronta)
//
// Stesso stampo di conti-api.ts / menu-api.ts: verbi tipizzati sopra
// `@gestionale/api-client` + `authOptions()`, ZERO chiamate raw. Nessun react-
// query/SWR: il caller (board client) chiama in handler/effect e gestisce lo
// stato React locale.
//
// Nessuna normalizzazione Decimal: il ticket cucina non ha prezzi. I `DateTime`
// restano stringa ISO (come dal wire) — la UI li usa così.
// =============================================================================

import { apiGet, apiPatch } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

import type { Comanda, PrintDepartment, StatoComanda } from './conti-types';

interface Wrapped<T> {
  data: T;
}

export interface ListComandeParams {
  stato?: StatoComanda;
  reparto?: PrintDepartment;
  contoId?: string;
}

/**
 * Feed KDS. Senza `stato`, il BE ritorna le comande attive (inviata +
 * in_preparazione, esclude pronta) ordinate FIFO per `inviataIl`.
 */
export async function listComande(params?: ListComandeParams): Promise<Comanda[]> {
  const qs = new URLSearchParams();
  if (params?.stato) qs.set('stato', params.stato);
  if (params?.reparto) qs.set('reparto', params.reparto);
  if (params?.contoId) qs.set('contoId', params.contoId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiGet<Wrapped<Comanda[]>>(`/comande${suffix}`, authOptions());
  return res.data;
}

/**
 * Avanzamento stato comanda (forward-only lato BE: `E_COMANDA_INVALID_TRANSITION`
 * se il target non viene dopo lo stato attuale). Ritorna il nuovo stato confermato.
 */
export async function cambiaStatoComanda(
  id: string,
  stato: StatoComanda,
): Promise<{ id: string; stato: StatoComanda }> {
  const res = await apiPatch<Wrapped<{ id: string; stato: StatoComanda }>>(
    `/comande/${id}/stato`,
    { stato },
    authOptions(),
  );
  return res.data;
}
