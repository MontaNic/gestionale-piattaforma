// =============================================================================
// comunicazioni-api.ts — Data access client comunicazioni (verticale accountant, ADR-0043)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client (pattern scadenze-api). NO
// react-query. Auth via authOptions() (@gestionale/auth-web): access token
// corrente + hook single-flight refresh. Response avvolte in { data }.
//
// Allegati: upload (multipart FormData) e download (blob, l'endpoint richiede
// Authorization: Bearer, non è un <a href> diretto) passano dai verbi
// `apiPostMultipart` / `apiGetBlob` del client condiviso, così anche questi
// call-site sopravvivono alla scadenza dell'access token via single-flight
// refresh (#160) invece di fallire con 401 silenzioso (TD-blob-download-no-refresh).
// =============================================================================

import {
  apiDelete,
  apiGet,
  apiGetBlob,
  apiPatch,
  apiPost,
  apiPostMultipart,
} from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

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

/** Upload allegato (multipart) via api-client (single-flight refresh su 401). */
export async function uploadAllegato(messaggioId: string, file: File): Promise<ComAllegato> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiPostMultipart<Wrapped<ComAllegato>>(
    `/comunicazioni/messaggi/${messaggioId}/allegati`,
    form,
    authOptions(),
  );
  return res.data;
}

/** Download allegato (blob, Bearer richiesto) → trigger save lato browser. */
export async function downloadAllegato(allegatoId: string, nomeOrig: string): Promise<void> {
  const blob = await apiGetBlob(`/comunicazioni/allegati/${allegatoId}`, authOptions());
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeOrig;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
