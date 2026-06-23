// =============================================================================
// portale-circolari-api.ts — Data access circolari lato cliente (portale, ADR-0048)
// =============================================================================
// Superficie SOLO cliente: lista/dettaglio read-only delle circolari pubblicate
// indirizzate alla propria azienda + conferma di presa-visione. La lettura
// (markLetta) è implicita: il backend la segna all'apertura del dettaglio (GET
// :id), nessuna chiamata dedicata lato FE. Distinta da circolari-api.ts (operatore
// studio): endpoint /portale/*, permesso portale.circolari.visualizza e shape
// ridotto (le Cliente*View del backend — niente tenantId/stato/destinatari).
// Pattern api-client come portale-documenti-api / portale-comunicazioni-api.
// =============================================================================

import { apiGet, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

interface Wrapped<T> {
  data: T;
}

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

/** Riga lista (ClienteCircolareListView). Date ISO sul filo (DateTime → stringa). */
export interface PortaleCircolareListItem {
  id: string;
  titolo: string;
  oggettoEmail: string;
  priorita: number;
  richiedeConferma: boolean;
  pubblicataIl: string | null;
  scadeIl: string | null;
  letta: boolean;
  confermata: boolean;
}

/** Dettaglio (ClienteCircolareDetailView): testata + body grezzo (reso come testo). */
export interface PortaleCircolareDetail extends PortaleCircolareListItem {
  bodyHtml: string;
}

export async function getPortaleCircolari(): Promise<PortaleCircolareListItem[]> {
  const res = await apiGet<Wrapped<PortaleCircolareListItem[]>>(
    '/portale/circolari',
    authOptions(),
  );
  return res.data;
}

/** Dettaglio circolare. Il backend segna la circolare come letta a questo GET. */
export async function getPortaleCircolare(id: string): Promise<PortaleCircolareDetail> {
  const res = await apiGet<Wrapped<PortaleCircolareDetail>>(
    `/portale/circolari/${id}`,
    authOptions(),
  );
  return res.data;
}

/** Conferma di presa-visione. 422 E_CIRCOLARE_NO_CONFERMA se non richiesta. */
export async function confermaPortaleCircolare(id: string): Promise<{ confermataAt: string }> {
  const res = await apiPost<Wrapped<{ confermataAt: string }>>(
    `/portale/circolari/${id}/conferma`,
    {},
    authOptions(),
  );
  return res.data;
}
