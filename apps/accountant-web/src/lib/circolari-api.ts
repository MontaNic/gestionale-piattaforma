// =============================================================================
// circolari-api.ts — Data access client circolari (verticale accountant, ADR-0045)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client (pattern comunicazioni-api).
// NO react-query. Token via getAccessToken() (@gestionale/auth-web). Response
// avvolte in { data }. publish/archive sono POST con body vuoto.
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

import type {
  Circolare,
  CircolareReportView,
  CircolareStato,
  CircolareWithDestinatari,
  CreateCircolareInput,
  UpdateCircolareInput,
} from './circolari-types';

interface Wrapped<T> {
  data: T;
}

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

export interface GetCircolariParams {
  stato?: CircolareStato;
}

export async function getCircolari(params: GetCircolariParams = {}): Promise<Circolare[]> {
  const qs = new URLSearchParams();
  if (params.stato) qs.set('stato', params.stato);
  const query = qs.toString();
  const res = await apiGet<Wrapped<Circolare[]>>(
    `/circolari${query ? `?${query}` : ''}`,
    authOptions(),
  );
  return res.data;
}

export async function getCircolare(id: string): Promise<CircolareWithDestinatari> {
  const res = await apiGet<Wrapped<CircolareWithDestinatari>>(`/circolari/${id}`, authOptions());
  return res.data;
}

export async function getCircolareReport(id: string): Promise<CircolareReportView> {
  const res = await apiGet<Wrapped<CircolareReportView>>(`/circolari/${id}/report`, authOptions());
  return res.data;
}

export async function createCircolare(
  input: CreateCircolareInput,
): Promise<CircolareWithDestinatari> {
  const res = await apiPost<Wrapped<CircolareWithDestinatari>>('/circolari', input, authOptions());
  return res.data;
}

export async function updateCircolare(
  id: string,
  input: UpdateCircolareInput,
): Promise<CircolareWithDestinatari> {
  const res = await apiPatch<Wrapped<CircolareWithDestinatari>>(
    `/circolari/${id}`,
    input,
    authOptions(),
  );
  return res.data;
}

export async function publishCircolare(id: string): Promise<Circolare> {
  const res = await apiPost<Wrapped<Circolare>>(`/circolari/${id}/publish`, {}, authOptions());
  return res.data;
}

export async function archiveCircolare(id: string): Promise<Circolare> {
  const res = await apiPost<Wrapped<Circolare>>(`/circolari/${id}/archive`, {}, authOptions());
  return res.data;
}

export async function deleteCircolare(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/circolari/${id}`, authOptions());
}
