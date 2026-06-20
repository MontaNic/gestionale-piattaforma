// =============================================================================
// documenti-api.ts — Data access client documenti (verticale accountant, ADR-0044)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client (pattern comunicazioni-api).
// Token via getAccessToken(). Upload (multipart) e download (blob, Bearer) usano
// `fetch` raw con lo stesso base URL del client condiviso (l'api-client fa JSON).
// =============================================================================

import { apiDelete, apiGet, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

import type {
  CreateDocumentoTipoInput,
  Documento,
  DocumentoTipo,
  UploadDocumentoInput,
  VisibilitaDocumento,
} from './documenti-types';

interface Wrapped<T> {
  data: T;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

export interface GetDocumentiParams {
  aziendaId?: string;
  tipoId?: string;
  visibilita?: VisibilitaDocumento;
}

export async function getDocumenti(params: GetDocumentiParams = {}): Promise<Documento[]> {
  const qs = new URLSearchParams();
  if (params.aziendaId) qs.set('aziendaId', params.aziendaId);
  if (params.tipoId) qs.set('tipoId', params.tipoId);
  if (params.visibilita) qs.set('visibilita', params.visibilita);
  const query = qs.toString();
  const res = await apiGet<Wrapped<Documento[]>>(
    `/documenti${query ? `?${query}` : ''}`,
    authOptions(),
  );
  return res.data;
}

export async function getDocumentiTipi(): Promise<DocumentoTipo[]> {
  const res = await apiGet<Wrapped<DocumentoTipo[]>>('/documenti/tipi', authOptions());
  return res.data;
}

export async function createDocumentoTipo(input: CreateDocumentoTipoInput): Promise<DocumentoTipo> {
  const res = await apiPost<Wrapped<DocumentoTipo>>('/documenti/tipi', input, authOptions());
  return res.data;
}

export async function deleteDocumento(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/documenti/${id}`, authOptions());
}

/** Upload documento (multipart): metadati + file. */
export async function uploadDocumento(file: File, input: UploadDocumentoInput): Promise<Documento> {
  const form = new FormData();
  form.append('file', file);
  form.append('tipoId', input.tipoId);
  form.append('aziendaId', input.aziendaId);
  form.append('visibilita', input.visibilita);
  if (input.note) form.append('note', input.note);
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/documenti`, {
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
  return ((await res.json()) as Wrapped<Documento>).data;
}

/** Download documento (blob, Bearer richiesto) → trigger save lato browser. */
export async function downloadDocumento(id: string, nomeOriginale: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/documenti/${id}/download`, {
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
  a.download = nomeOriginale;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
