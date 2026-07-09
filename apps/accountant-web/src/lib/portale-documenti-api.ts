// =============================================================================
// portale-documenti-api.ts — Data access lettore cliente (portale, ADR-0046)
// =============================================================================
// Superficie SOLO cliente: GET /portale/documenti (read-only) + download blob.
// Distinta da documenti-api.ts (operatore studio): endpoint, permesso
// (portale.documenti.visualizza) e shape diversi. La response cliente è la
// `ClienteDocumentoView` del backend — niente storageKey/createdBy/tenantId,
// con `tipoNome` già denormalizzato (il cliente non interroga il catalogo tipi).
// =============================================================================

import { apiGet } from '@gestionale/api-client';
import { authOptions, getAccessToken } from '@gestionale/auth-web';

import type { VisibilitaDocumento } from './documenti-types';

interface Wrapped<T> {
  data: T;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

/** Vista read-only allineata a ClienteDocumentoView (accountant-api). */
export interface PortaleDocumento {
  id: string;
  nomeOriginale: string;
  mimeType: string;
  dimensione: number;
  visibilita: VisibilitaDocumento;
  note: string | null;
  createdAt: string; // wire JSON: DateTime → stringa ISO
  tipoNome: string;
}

export async function getPortaleDocumenti(): Promise<PortaleDocumento[]> {
  const res = await apiGet<Wrapped<PortaleDocumento[]>>('/portale/documenti', authOptions());
  return res.data;
}

/** Download documento (blob, Bearer richiesto) → trigger save lato browser. */
export async function downloadPortaleDocumento(id: string, nomeOriginale: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/portale/documenti/${id}/download`, {
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
