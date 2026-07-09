// =============================================================================
// aziende-api.ts — Data access client anagrafica clienti (STOP-c2 ADR-0032)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client. NO react-query (confine
// del verticale, coerente con menu-api di restaurant-web). Token via
// getAccessToken() (@gestionale/auth-web). Response avvolte in { data }.
// API base = NEXT_PUBLIC_API_URL (accountant-web → http://localhost:3002/api/v1).
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

import type { Azienda, CreateAziendaInput, UpdateAziendaInput } from './aziende-types';

interface Wrapped<T> {
  data: T;
}

export async function listAziende(): Promise<Azienda[]> {
  const res = await apiGet<Wrapped<Azienda[]>>('/aziende', authOptions());
  return res.data;
}

export async function getAzienda(id: string): Promise<Azienda> {
  const res = await apiGet<Wrapped<Azienda>>(`/aziende/${id}`, authOptions());
  return res.data;
}

export async function createAzienda(input: CreateAziendaInput): Promise<Azienda> {
  const res = await apiPost<Wrapped<Azienda>>('/aziende', input, authOptions());
  return res.data;
}

export async function updateAzienda(id: string, input: UpdateAziendaInput): Promise<Azienda> {
  const res = await apiPatch<Wrapped<Azienda>>(`/aziende/${id}`, input, authOptions());
  return res.data;
}

/** DELETE backend risponde 200 `{ data: { id, deleted: true } }`, non 204. */
export async function deleteAzienda(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/aziende/${id}`, authOptions());
}
