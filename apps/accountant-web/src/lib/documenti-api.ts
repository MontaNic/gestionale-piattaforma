// =============================================================================
// documenti-api.ts — Data access client documenti (verticale accountant, ADR-0044)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client (pattern comunicazioni-api).
// Upload (multipart) e download (blob, Bearer) passano dai verbi
// `apiPostMultipart` / `apiGetBlob`, così sopravvivono alla scadenza dell'access
// token via single-flight refresh (#160) invece di un 401 silenzioso
// (TD-blob-download-no-refresh).
// =============================================================================

import { apiDelete, apiGet, apiGetBlob, apiPost, apiPostMultipart } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

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

/** Upload documento (multipart): metadati + file. Single-flight refresh su 401. */
export async function uploadDocumento(file: File, input: UploadDocumentoInput): Promise<Documento> {
  const form = new FormData();
  form.append('file', file);
  form.append('tipoId', input.tipoId);
  form.append('aziendaId', input.aziendaId);
  form.append('visibilita', input.visibilita);
  if (input.note) form.append('note', input.note);
  const res = await apiPostMultipart<Wrapped<Documento>>('/documenti', form, authOptions());
  return res.data;
}

/** Download documento (blob, Bearer richiesto) → trigger save lato browser. */
export async function downloadDocumento(id: string, nomeOriginale: string): Promise<void> {
  const blob = await apiGetBlob(`/documenti/${id}/download`, authOptions());
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeOriginale;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
