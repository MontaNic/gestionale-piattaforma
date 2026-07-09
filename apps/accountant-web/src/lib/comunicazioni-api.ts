// =============================================================================
// comunicazioni-api.ts — Data access client comunicazioni (verticale accountant, ADR-0043)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client (pattern scadenze-api). NO
// react-query. Token via getAccessToken() (@gestionale/auth-web). Response
// avvolte in { data }.
//
// Allegati: l'api-client fa solo JSON → upload (multipart FormData) e download
// (blob, l'endpoint richiede Authorization: Bearer, non è un <a href> diretto)
// usano `fetch` raw con lo stesso base URL e header del client condiviso.
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { authOptions, getAccessToken } from '@gestionale/auth-web';

import type {
  ComAllegato,
  Comunicazione,
  ComunicazioneThread,
  CreateComMessaggioInput,
  CreateComunicazioneInput,
  ComMessaggio,
  UpdateComunicazioneInput,
} from './comunicazioni-types';

interface Wrapped<T> {
  data: T;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

export interface GetComunicazioniParams {
  aziendaId?: string;
  chiusa?: boolean;
  urgente?: boolean;
  operatoreAssegnatoId?: string;
  daPrendere?: boolean;
}

export async function getComunicazioni(
  params: GetComunicazioniParams = {},
): Promise<Comunicazione[]> {
  const qs = new URLSearchParams();
  if (params.aziendaId) qs.set('aziendaId', params.aziendaId);
  if (params.chiusa !== undefined) qs.set('chiusa', String(params.chiusa));
  if (params.urgente !== undefined) qs.set('urgente', String(params.urgente));
  if (params.operatoreAssegnatoId) qs.set('operatoreAssegnatoId', params.operatoreAssegnatoId);
  if (params.daPrendere) qs.set('daPrendere', 'true');
  const query = qs.toString();
  const res = await apiGet<Wrapped<Comunicazione[]>>(
    `/comunicazioni${query ? `?${query}` : ''}`,
    authOptions(),
  );
  return res.data;
}

export async function getComunicazione(id: string): Promise<ComunicazioneThread> {
  const res = await apiGet<Wrapped<ComunicazioneThread>>(`/comunicazioni/${id}`, authOptions());
  return res.data;
}

export async function createComunicazione(input: CreateComunicazioneInput): Promise<Comunicazione> {
  const res = await apiPost<Wrapped<Comunicazione>>('/comunicazioni', input, authOptions());
  return res.data;
}

export async function updateComunicazione(
  id: string,
  input: UpdateComunicazioneInput,
): Promise<Comunicazione> {
  const res = await apiPatch<Wrapped<Comunicazione>>(`/comunicazioni/${id}`, input, authOptions());
  return res.data;
}

export async function prendiInCarico(id: string): Promise<Comunicazione> {
  const res = await apiPost<Wrapped<Comunicazione>>(
    `/comunicazioni/${id}/prendi`,
    {},
    authOptions(),
  );
  return res.data;
}

export async function marcaLetto(id: string): Promise<void> {
  await apiPost<Wrapped<{ updated: number }>>(`/comunicazioni/${id}/letto`, {}, authOptions());
}

export async function deleteComunicazione(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/comunicazioni/${id}`, authOptions());
}

/** Stato feature AI (pubblico, no auth). Decide se mostrare il bottone bozza. */
export async function getAiStatus(): Promise<{ aiEnabled: boolean }> {
  return apiGet<{ aiEnabled: boolean }>('/ai/status');
}

/** Bozza AI di risposta operatore (ADR-0056). Non persiste nulla. */
export async function suggerisciRisposta(id: string): Promise<{ bozza: string }> {
  const res = await apiPost<Wrapped<{ bozza: string }>>(
    `/comunicazioni/${id}/suggerisci`,
    {},
    authOptions(),
  );
  return res.data;
}

export async function addMessaggio(
  comunicazioneId: string,
  input: CreateComMessaggioInput,
): Promise<ComMessaggio> {
  const res = await apiPost<Wrapped<ComMessaggio>>(
    `/comunicazioni/${comunicazioneId}/messaggi`,
    input,
    authOptions(),
  );
  return res.data;
}

/** Upload allegato (multipart). L'api-client fa solo JSON → fetch raw. */
export async function uploadAllegato(messaggioId: string, file: File): Promise<ComAllegato> {
  const form = new FormData();
  form.append('file', file);
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/comunicazioni/messaggi/${messaggioId}/allegati`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { errorCode?: string; message?: string };
    throw Object.assign(new Error(body.message ?? 'upload failed'), {
      errorCode: body.errorCode ?? 'E_UNKNOWN',
      status: res.status,
    });
  }
  return ((await res.json()) as Wrapped<ComAllegato>).data;
}

/** Download allegato (blob, Bearer richiesto) → trigger save lato browser. */
export async function downloadAllegato(allegatoId: string, nomeOrig: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/comunicazioni/allegati/${allegatoId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw Object.assign(new Error('download failed'), {
      errorCode: 'E_UNKNOWN',
      status: res.status,
    });
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeOrig;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
