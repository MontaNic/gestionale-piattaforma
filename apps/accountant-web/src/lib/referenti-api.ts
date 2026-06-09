// =============================================================================
// referenti-api.ts — Data access client referenti (STOP-c3b ADR-0034)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client, satellite nested sotto
// aziende: /aziende/:aziendaId/referenti. NO react-query (confine del verticale,
// coerente con aziende-api). Token via getAccessToken(). Response in { data }.
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

import type { CreateReferenteInput, Referente, UpdateReferenteInput } from './referenti-types';

interface Wrapped<T> {
  data: T;
}

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

export async function listReferenti(aziendaId: string): Promise<Referente[]> {
  const res = await apiGet<Wrapped<Referente[]>>(`/aziende/${aziendaId}/referenti`, authOptions());
  return res.data;
}

export async function createReferente(
  aziendaId: string,
  input: CreateReferenteInput,
): Promise<Referente> {
  const res = await apiPost<Wrapped<Referente>>(
    `/aziende/${aziendaId}/referenti`,
    input,
    authOptions(),
  );
  return res.data;
}

export async function updateReferente(
  aziendaId: string,
  id: string,
  input: UpdateReferenteInput,
): Promise<Referente> {
  const res = await apiPatch<Wrapped<Referente>>(
    `/aziende/${aziendaId}/referenti/${id}`,
    input,
    authOptions(),
  );
  return res.data;
}

/** DELETE backend risponde 200 `{ data: { id, deleted: true } }`, non 204. */
export async function deleteReferente(aziendaId: string, id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(
    `/aziende/${aziendaId}/referenti/${id}`,
    authOptions(),
  );
}
