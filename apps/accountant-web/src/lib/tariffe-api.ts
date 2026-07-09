// =============================================================================
// tariffe-api.ts — Data access tariffario orario (ADR-0055)
// =============================================================================
// CRUD listino tariffe di costo (per ruolo o utente) + lookup ruoli/utenti per
// i picker del form. Pattern catalogo/prestazioni-api. `tariffaOraria` è Prisma
// Decimal: sul filo arriva come STRINGA → normalizzata a number (ADR-0037).
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

interface Wrapped<T> {
  data: T;
}

interface RawTariffa {
  id: string;
  tenantId: string;
  roleId: string | null;
  userId: string | null;
  tariffaOraria: string; // Decimal sul filo
  attivo: boolean;
  note: string | null;
  roleName: string | null;
  userName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tariffa {
  id: string;
  tenantId: string;
  roleId: string | null;
  userId: string | null;
  tariffaOraria: number;
  attivo: boolean;
  note: string | null;
  roleName: string | null;
  userName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTariffaInput {
  roleId?: string;
  userId?: string;
  tariffaOraria: number;
  note?: string;
}

export interface UpdateTariffaInput {
  tariffaOraria?: number;
  attivo?: boolean;
  note?: string;
}

export interface LookupOption {
  id: string;
  name: string;
}

function mapTariffa(r: RawTariffa): Tariffa {
  return { ...r, tariffaOraria: Number(r.tariffaOraria) };
}

export async function getTariffe(): Promise<Tariffa[]> {
  const res = await apiGet<Wrapped<RawTariffa[]>>('/tariffe', authOptions());
  return res.data.map(mapTariffa);
}

export async function createTariffa(input: CreateTariffaInput): Promise<Tariffa> {
  const res = await apiPost<Wrapped<RawTariffa>>('/tariffe', input, authOptions());
  return mapTariffa(res.data);
}

export async function updateTariffa(id: string, input: UpdateTariffaInput): Promise<Tariffa> {
  const res = await apiPatch<Wrapped<RawTariffa>>(`/tariffe/${id}`, input, authOptions());
  return mapTariffa(res.data);
}

export async function deleteTariffa(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/tariffe/${id}`, authOptions());
}

export async function getTariffeRoles(): Promise<LookupOption[]> {
  const res = await apiGet<Wrapped<LookupOption[]>>('/tariffe/roles', authOptions());
  return res.data;
}

export async function getTariffeUsers(): Promise<LookupOption[]> {
  const res = await apiGet<Wrapped<LookupOption[]>>('/tariffe/users', authOptions());
  return res.data;
}
