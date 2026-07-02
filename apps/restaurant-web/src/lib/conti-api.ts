// =============================================================================
// conti-api.ts — Data access client Comande / Conto (PR-1 FE, ADR-0067/0068)
// =============================================================================
// Funzioni tipizzate sopra i wrapper `@gestionale/api-client` (stesso stampo di
// menu-api.ts / table-api.ts): NO react-query / SWR / Server Actions. Il caller
// (page/component client) chiama dentro `useEffect`/handler, gestisce stato
// React locale + refetch on mutation.
//
// Normalizzazione Decimal→number: `ContoRiga.prezzoUnitario` e
// `ContoWithRighe.totale` viaggiano come stringa JSON (Prisma Decimal). I mapper
// `mapContoRiga` / `mapContoWithRighe` convertono wire→dominio in un solo punto
// così la UI riceve sempre `number` (mai la stringa raw).
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

import type {
  AddRigaInput,
  Conto,
  ContoRiga,
  ContoWithRighe,
  CreateContoInput,
  ListContiParams,
  UpdateRigaInput,
} from './conti-types';

interface Wrapped<T> {
  data: T;
}

/** Header auth comune a tutte le chiamate Conti (route protette JwtAuthGuard). */
function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

// ── Wire shapes + normalizzazione Decimal→number ─────────────────────────────
// Il backend serializza i Decimal come stringa: qui i tipi "Raw" li tengono
// stringa e i mapper li convertono a number prima di consegnarli alla UI.

type RawContoRiga = Omit<ContoRiga, 'prezzoUnitario'> & { prezzoUnitario: string };
type RawContoWithRighe = Omit<ContoWithRighe, 'righe' | 'totale'> & {
  righe: RawContoRiga[];
  totale: string;
};

function mapContoRiga(r: RawContoRiga): ContoRiga {
  return { ...r, prezzoUnitario: Number(r.prezzoUnitario) };
}

function mapContoWithRighe(c: RawContoWithRighe): ContoWithRighe {
  return { ...c, righe: c.righe.map(mapContoRiga), totale: Number(c.totale) };
}

// ── Conto ────────────────────────────────────────────────────────────────────
// `list` ritorna Conto "flat" (nessun campo Decimal → nessun mapping); il totale
// e le righe vivono solo in `getConto` (ContoWithRighe).

export async function listConti(params?: ListContiParams): Promise<Conto[]> {
  const qs = new URLSearchParams();
  if (params?.stato) qs.set('stato', params.stato);
  if (params?.tavoloId) qs.set('tavoloId', params.tavoloId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiGet<Wrapped<Conto[]>>(`/conti${suffix}`, authOptions());
  return res.data;
}

export async function getConto(contoId: string): Promise<ContoWithRighe> {
  const res = await apiGet<Wrapped<RawContoWithRighe>>(`/conti/${contoId}`, authOptions());
  return mapContoWithRighe(res.data);
}

export async function createConto(input: CreateContoInput): Promise<Conto> {
  const res = await apiPost<Wrapped<Conto>>('/conti', input, authOptions());
  return res.data;
}

export async function chiudiConto(contoId: string): Promise<Conto> {
  const res = await apiPost<Wrapped<Conto>>(`/conti/${contoId}/chiudi`, undefined, authOptions());
  return res.data;
}

export async function annullaConto(contoId: string): Promise<Conto> {
  const res = await apiPost<Wrapped<Conto>>(`/conti/${contoId}/annulla`, undefined, authOptions());
  return res.data;
}

// ── Righe ─────────────────────────────────────────────────────────────────────

export async function addRiga(contoId: string, input: AddRigaInput): Promise<ContoRiga> {
  const res = await apiPost<Wrapped<RawContoRiga>>(`/conti/${contoId}/righe`, input, authOptions());
  return mapContoRiga(res.data);
}

export async function updateRiga(
  contoId: string,
  rigaId: string,
  input: UpdateRigaInput,
): Promise<ContoRiga> {
  const res = await apiPatch<Wrapped<RawContoRiga>>(
    `/conti/${contoId}/righe/${rigaId}`,
    input,
    authOptions(),
  );
  return mapContoRiga(res.data);
}

export async function deleteRiga(contoId: string, rigaId: string): Promise<void> {
  await apiDelete<Wrapped<unknown>>(`/conti/${contoId}/righe/${rigaId}`, authOptions());
}
