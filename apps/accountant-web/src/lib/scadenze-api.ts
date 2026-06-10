// =============================================================================
// scadenze-api.ts — Data access client scadenze / calendario fiscale (STOP-scad2)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client (pattern aziende-api /
// preventivi-api). NO react-query. Token via getAccessToken() (@gestionale/
// auth-web). Response avvolte in { data }. Endpoint /scadenze + /scadenze/
// categorie (backend STOP-scad1 ADR-0039).
//
// NORMALIZZAZIONE wire→domain (ADR-0037 Gotcha): `dataScadenza` è @db.Date e
// Prisma la serializza come ISO datetime completo ("2026-06-30T00:00:00.000Z").
// La normalizziamo una volta a date-only YYYY-MM-DD così il domain type resta
// onesto e i componenti non fanno conversioni difensive (come `validoFino` in
// preventivi-api). Le categorie non hanno campi data → nessuna normalizzazione.
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

import type {
  CreateScadenzaCategoriaInput,
  CreateScadenzaInput,
  Scadenza,
  ScadenzaCategoria,
  UpdateScadenzaInput,
  VisibilitaScadenza,
} from './scadenze-types';

interface Wrapped<T> {
  data: T;
}

// Shape grezza sul filo: `dataScadenza` come ISO datetime completo (@db.Date).
interface RawScadenza {
  id: string;
  tenantId: string;
  titolo: string;
  descrizione: string | null;
  dataScadenza: string;
  categoriaId: string | null;
  visibilita: VisibilitaScadenza;
  aziendaId: string | null;
  attivo: boolean;
  codiceImport: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Date-only YYYY-MM-DD da un ISO datetime. */
function toDateOnly(v: string): string {
  return v.slice(0, 10);
}

function mapScadenza(r: RawScadenza): Scadenza {
  return { ...r, dataScadenza: toDateOnly(r.dataScadenza) };
}

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

export interface GetScadenzeParams {
  aziendaId?: string;
  categoriaId?: string;
  attivo?: boolean;
  da?: string; // YYYY-MM-DD, inclusive lower bound
  a?: string; // YYYY-MM-DD, inclusive upper bound
}

export async function getScadenze(params: GetScadenzeParams = {}): Promise<Scadenza[]> {
  const qs = new URLSearchParams();
  if (params.aziendaId) qs.set('aziendaId', params.aziendaId);
  if (params.categoriaId) qs.set('categoriaId', params.categoriaId);
  if (params.attivo !== undefined) qs.set('attivo', String(params.attivo));
  if (params.da) qs.set('da', params.da);
  if (params.a) qs.set('a', params.a);
  const query = qs.toString();
  const res = await apiGet<Wrapped<RawScadenza[]>>(
    `/scadenze${query ? `?${query}` : ''}`,
    authOptions(),
  );
  return res.data.map(mapScadenza);
}

export async function createScadenza(input: CreateScadenzaInput): Promise<Scadenza> {
  const res = await apiPost<Wrapped<RawScadenza>>('/scadenze', input, authOptions());
  return mapScadenza(res.data);
}

export async function updateScadenza(id: string, input: UpdateScadenzaInput): Promise<Scadenza> {
  const res = await apiPatch<Wrapped<RawScadenza>>(`/scadenze/${id}`, input, authOptions());
  return mapScadenza(res.data);
}

/** DELETE backend risponde 200 `{ data: { id, deleted: true } }`, non 204. */
export async function deleteScadenza(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/scadenze/${id}`, authOptions());
}

export async function getScadenzeCategorie(): Promise<ScadenzaCategoria[]> {
  const res = await apiGet<Wrapped<ScadenzaCategoria[]>>('/scadenze/categorie', authOptions());
  return res.data;
}

export async function createScadenzaCategoria(
  input: CreateScadenzaCategoriaInput,
): Promise<ScadenzaCategoria> {
  const res = await apiPost<Wrapped<ScadenzaCategoria>>(
    '/scadenze/categorie',
    input,
    authOptions(),
  );
  return res.data;
}
