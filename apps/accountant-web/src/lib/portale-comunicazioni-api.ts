// =============================================================================
// portale-comunicazioni-api.ts — Data access comunicazioni lato cliente (portale, ADR-0047)
// =============================================================================
// Superficie SOLO cliente: lista/dettaglio + reply (lato=cliente) + read-tracking.
// Distinta da comunicazioni-api.ts (operatore studio): endpoint /portale/*,
// permessi portale.comunicazioni.* e shape diversi. Le viste cliente sono le
// Cliente*View del backend — niente tenantId/autoreUserId/operatoreAssegnatoId,
// note interne escluse. Pattern api-client come portale-documenti-api.
// =============================================================================

import { apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

interface Wrapped<T> {
  data: T;
}

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

/** Lato del messaggio visibile al cliente (mai `interno`, escluso dal backend). */
export type PortaleComLato = 'studio' | 'cliente';

export interface PortaleComAllegato {
  id: string;
  nomeOrig: string;
  mimeType: string;
  dimensione: number;
}

export interface PortaleComMessaggio {
  id: string;
  lato: PortaleComLato;
  testo: string;
  createdAt: string; // wire JSON: DateTime → stringa ISO
  allegati: PortaleComAllegato[];
}

/** Riga lista (ClienteComunicazioneListView). */
export interface PortaleComunicazioneListItem {
  id: string;
  codice: string;
  oggetto: string;
  chiusa: boolean;
  updatedAt: string;
  nonLetti: number; // messaggi studio non ancora letti dal cliente
}

/** Dettaglio thread (ClienteComunicazioneDetailView). */
export interface PortaleComunicazioneDetail {
  id: string;
  codice: string;
  oggetto: string;
  chiusa: boolean;
  createdAt: string;
  updatedAt: string;
  messaggi: PortaleComMessaggio[];
}

export async function getPortaleComunicazioni(): Promise<PortaleComunicazioneListItem[]> {
  const res = await apiGet<Wrapped<PortaleComunicazioneListItem[]>>(
    '/portale/comunicazioni',
    authOptions(),
  );
  return res.data;
}

export async function getPortaleComunicazione(id: string): Promise<PortaleComunicazioneDetail> {
  const res = await apiGet<Wrapped<PortaleComunicazioneDetail>>(
    `/portale/comunicazioni/${id}`,
    authOptions(),
  );
  return res.data;
}

export async function replyPortaleComunicazione(
  id: string,
  testo: string,
): Promise<PortaleComMessaggio> {
  const res = await apiPost<Wrapped<PortaleComMessaggio>>(
    `/portale/comunicazioni/${id}/messaggi`,
    { testo },
    authOptions(),
  );
  return res.data;
}

/** Marca i messaggi studio come letti dal cliente (best-effort, idempotente). */
export async function markLettoPortaleComunicazione(id: string): Promise<void> {
  await apiPatch<Wrapped<{ updated: number }>>(
    `/portale/comunicazioni/${id}/letto-cliente`,
    {},
    authOptions(),
  );
}
