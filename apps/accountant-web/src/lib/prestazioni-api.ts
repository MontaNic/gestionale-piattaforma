// =============================================================================
// prestazioni-api.ts — Data access timesheet/prestazioni (ADR-0053)
// =============================================================================
// CRUD nested sotto /mandati/:id/prestazioni. Pattern scadenze/mandati-api.
// `ore`/`importo` sono Decimal sul filo (stringa) → normalizzati a number;
// `data` @db.Date → date-only YYYY-MM-DD.
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

interface Wrapped<T> {
  data: T;
}

interface RawPrestazione {
  id: string;
  tenantId: string;
  mandatoId: string;
  voceId: string | null;
  userId: string | null;
  data: string;
  ore: string;
  descrizione: string;
  fatturabile: boolean;
  importo: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Prestazione {
  id: string;
  tenantId: string;
  mandatoId: string;
  voceId: string | null;
  userId: string | null;
  data: string;
  ore: number;
  descrizione: string;
  fatturabile: boolean;
  importo: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePrestazioneInput {
  data: string;
  ore: number;
  descrizione: string;
  fatturabile?: boolean;
  importo?: number;
  voceId?: string;
  note?: string;
}

export type UpdatePrestazioneInput = Partial<CreatePrestazioneInput>;

function mapPrestazione(r: RawPrestazione): Prestazione {
  return {
    ...r,
    data: r.data.slice(0, 10),
    ore: Number(r.ore),
    importo: r.importo === null ? null : Number(r.importo),
  };
}

export async function getPrestazioni(mandatoId: string): Promise<Prestazione[]> {
  const res = await apiGet<Wrapped<RawPrestazione[]>>(
    `/mandati/${mandatoId}/prestazioni`,
    authOptions(),
  );
  return res.data.map(mapPrestazione);
}

export async function createPrestazione(
  mandatoId: string,
  input: CreatePrestazioneInput,
): Promise<Prestazione> {
  const res = await apiPost<Wrapped<RawPrestazione>>(
    `/mandati/${mandatoId}/prestazioni`,
    input,
    authOptions(),
  );
  return mapPrestazione(res.data);
}

export async function updatePrestazione(
  mandatoId: string,
  prestazioneId: string,
  input: UpdatePrestazioneInput,
): Promise<Prestazione> {
  const res = await apiPatch<Wrapped<RawPrestazione>>(
    `/mandati/${mandatoId}/prestazioni/${prestazioneId}`,
    input,
    authOptions(),
  );
  return mapPrestazione(res.data);
}

export async function deletePrestazione(mandatoId: string, prestazioneId: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(
    `/mandati/${mandatoId}/prestazioni/${prestazioneId}`,
    authOptions(),
  );
}
