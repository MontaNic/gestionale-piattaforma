// =============================================================================
// note-spese-api.ts — Data access client note spese (accountant, ADR-0074/75/76)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client (pattern documenti-api).
// Upload (multipart) e download (blob, Bearer) passano da `apiPostMultipart` /
// `apiGetBlob`: nessuna chiamata HTTP raw, così sopravvivono alla scadenza
// dell'access token via single-flight refresh (#160, TD-blob-download-no-refresh).
//
// Wire→domain: `totale`/`distanzaKm` sono Decimal (stringhe) → number; `data`
// è @db.Date serializzata ISO datetime → date-only YYYY-MM-DD (pattern
// scadenze-api). La normalizzazione vive qui, non nelle pagine.
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
  AllegatoNotaSpesa,
  AllegatoRef,
  CreateNotaSpesaInput,
  GetNoteSpeseParams,
  NotaSpesa,
  NotaSpesaDetail,
  TipoAllegatoNotaSpesa,
  UpdateNotaSpesaInput,
} from './note-spese-types';

interface Wrapped<T> {
  data: T;
}

/** Shape sul filo: Decimal e DateTime arrivano come stringhe. */
interface RawNotaSpesa extends Omit<NotaSpesaDetail, 'totale' | 'distanzaKm' | 'allegati'> {
  totale: string | number;
  distanzaKm: string | number | null;
  allegati?: (AllegatoRef | AllegatoNotaSpesa)[];
}

/** ISO datetime (o già date-only) → YYYY-MM-DD. */
function toDateOnly(value: string): string {
  return value.slice(0, 10);
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

function toNumberOrNull(value: string | number | null): number | null {
  return value === null ? null : toNumber(value);
}

function normalize(raw: RawNotaSpesa): NotaSpesaDetail {
  return {
    ...raw,
    data: toDateOnly(raw.data),
    totale: toNumber(raw.totale),
    distanzaKm: toNumberOrNull(raw.distanzaKm),
    allegati: (raw.allegati ?? []) as AllegatoNotaSpesa[],
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function getNoteSpese(params: GetNoteSpeseParams = {}): Promise<NotaSpesa[]> {
  const qs = new URLSearchParams();
  if (params.mese) qs.set('mese', params.mese);
  if (params.stato) qs.set('stato', params.stato);
  if (params.aziendaId) qs.set('aziendaId', params.aziendaId);
  if (params.userId) qs.set('userId', params.userId);
  const query = qs.toString();
  const res = await apiGet<Wrapped<RawNotaSpesa[]>>(
    `/note-spese${query ? `?${query}` : ''}`,
    authOptions(),
  );
  // In lista gli allegati sono leggeri ({id,tipo}): il cast riflette la shape BE.
  return res.data.map((r) => normalize(r) as unknown as NotaSpesa);
}

export async function getNotaSpesa(id: string): Promise<NotaSpesaDetail> {
  const res = await apiGet<Wrapped<RawNotaSpesa>>(`/note-spese/${id}`, authOptions());
  return normalize(res.data);
}

export async function createNotaSpesa(input: CreateNotaSpesaInput): Promise<NotaSpesaDetail> {
  const res = await apiPost<Wrapped<RawNotaSpesa>>('/note-spese', input, authOptions());
  return normalize(res.data);
}

export async function updateNotaSpesa(
  id: string,
  input: UpdateNotaSpesaInput,
): Promise<NotaSpesaDetail> {
  const res = await apiPatch<Wrapped<RawNotaSpesa>>(`/note-spese/${id}`, input, authOptions());
  return normalize(res.data);
}

export async function deleteNotaSpesa(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/note-spese/${id}`, authOptions());
}

// ── Transizione operatore (le decisioni approva/respingi sono PR-5) ──────────

/** `{bozza,respinta} → inviata`. Il BE rifiuta se manca giustificativo/scontrino. */
export async function inviaNotaSpesa(id: string): Promise<NotaSpesaDetail> {
  const res = await apiPost<Wrapped<RawNotaSpesa>>(`/note-spese/${id}/invia`, {}, authOptions());
  return normalize(res.data);
}

// ── Allegati ─────────────────────────────────────────────────────────────────

/** Upload allegato (multipart): file + tipo. Single-flight refresh su 401. */
export async function uploadAllegato(
  notaId: string,
  tipo: TipoAllegatoNotaSpesa,
  file: File,
): Promise<AllegatoNotaSpesa> {
  const form = new FormData();
  form.append('file', file);
  form.append('tipo', tipo);
  const res = await apiPostMultipart<Wrapped<AllegatoNotaSpesa>>(
    `/note-spese/${notaId}/allegati`,
    form,
    authOptions(),
  );
  return res.data;
}

/** Download allegato (blob, Bearer richiesto) → trigger save lato browser. */
export async function downloadAllegato(
  notaId: string,
  allegatoId: string,
  nomeOriginale: string,
): Promise<void> {
  const blob = await apiGetBlob(`/note-spese/${notaId}/allegati/${allegatoId}`, authOptions());
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeOriginale;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function deleteAllegato(notaId: string, allegatoId: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(
    `/note-spese/${notaId}/allegati/${allegatoId}`,
    authOptions(),
  );
}
