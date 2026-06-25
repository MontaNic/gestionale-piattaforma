// =============================================================================
// mandati-api.ts — Data access mandati/incarichi (ADR-0051)
// =============================================================================
// Il mandato nasce da un preventivo accettato (createMandatoFromPreventivo →
// POST /preventivi/:id/mandato). CRUD sotto /mandati. Pattern scadenze-api.
// `importoConcordato` è Decimal sul filo (stringa) → normalizzato a number;
// le date @db.Date arrivano come ISO datetime → date-only YYYY-MM-DD.
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

export type StatoMandato = 'in_corso' | 'sospeso' | 'concluso' | 'annullato';

export const STATI_MANDATO: readonly StatoMandato[] = [
  'in_corso',
  'sospeso',
  'concluso',
  'annullato',
];

interface Wrapped<T> {
  data: T;
}

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

interface RawMandato {
  id: string;
  tenantId: string;
  preventivoId: string;
  aziendaId: string;
  codice: string;
  stato: StatoMandato;
  inizio: string | null;
  finePrevista: string | null;
  fineEffettiva: string | null;
  note: string | null;
  importoConcordato: string;
  createdAt: string;
  updatedAt: string;
}

export interface Mandato {
  id: string;
  tenantId: string;
  preventivoId: string;
  aziendaId: string;
  codice: string;
  stato: StatoMandato;
  inizio: string | null;
  finePrevista: string | null;
  fineEffettiva: string | null;
  note: string | null;
  importoConcordato: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateMandatoInput {
  stato?: StatoMandato;
  inizio?: string;
  finePrevista?: string;
  fineEffettiva?: string;
  note?: string;
}

function toDateOnly(v: string | null): string | null {
  return v ? v.slice(0, 10) : null;
}

function mapMandato(r: RawMandato): Mandato {
  return {
    ...r,
    importoConcordato: Number(r.importoConcordato),
    inizio: toDateOnly(r.inizio),
    finePrevista: toDateOnly(r.finePrevista),
    fineEffettiva: toDateOnly(r.fineEffettiva),
  };
}

export interface GetMandatiParams {
  stato?: StatoMandato;
  aziendaId?: string;
}

export async function getMandati(params: GetMandatiParams = {}): Promise<Mandato[]> {
  const qs = new URLSearchParams();
  if (params.stato) qs.set('stato', params.stato);
  if (params.aziendaId) qs.set('aziendaId', params.aziendaId);
  const query = qs.toString();
  const res = await apiGet<Wrapped<RawMandato[]>>(
    `/mandati${query ? `?${query}` : ''}`,
    authOptions(),
  );
  return res.data.map(mapMandato);
}

export async function getMandato(id: string): Promise<Mandato> {
  const res = await apiGet<Wrapped<RawMandato>>(`/mandati/${id}`, authOptions());
  return mapMandato(res.data);
}

/** Crea il mandato dal preventivo accettato. 400 se non accettato/già convertito. */
export async function createMandatoFromPreventivo(preventivoId: string): Promise<Mandato> {
  const res = await apiPost<Wrapped<RawMandato>>(
    `/preventivi/${preventivoId}/mandato`,
    {},
    authOptions(),
  );
  return mapMandato(res.data);
}

export async function updateMandato(id: string, input: UpdateMandatoInput): Promise<Mandato> {
  const res = await apiPatch<Wrapped<RawMandato>>(`/mandati/${id}`, input, authOptions());
  return mapMandato(res.data);
}

export async function deleteMandato(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/mandati/${id}`, authOptions());
}
