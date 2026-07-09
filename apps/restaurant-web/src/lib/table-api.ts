// =============================================================================
// table-api.ts — Data access client F2 Tavoli / Mappa sala (ADR-0058)
// =============================================================================
// Funzioni tipizzate sopra i wrapper `@gestionale/api-client` (apiGet/apiPost/
// apiPatch/apiDelete), stesso pattern di menu-api.ts: no react-query, il caller
// gestisce stato React locale + refetch on mutation. Token da localStorage via
// getAccessToken(). Ogni response backend è `{ data }`, srotolata qui.
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

import type { CreateTableInput, Tavolo, UpdateTableInput } from './table-types';

interface Wrapped<T> {
  data: T;
}

export async function listTables(): Promise<Tavolo[]> {
  const res = await apiGet<Wrapped<Tavolo[]>>('/tables', authOptions());
  return res.data;
}

export async function getTable(tableId: string): Promise<Tavolo> {
  const res = await apiGet<Wrapped<Tavolo>>(`/tables/${tableId}`, authOptions());
  return res.data;
}

export async function createTable(input: CreateTableInput): Promise<Tavolo> {
  const res = await apiPost<Wrapped<Tavolo>>('/tables', input, authOptions());
  return res.data;
}

export async function updateTable(tableId: string, input: UpdateTableInput): Promise<Tavolo> {
  const res = await apiPatch<Wrapped<Tavolo>>(`/tables/${tableId}`, input, authOptions());
  return res.data;
}

export async function deleteTable(tableId: string): Promise<void> {
  await apiDelete<Wrapped<unknown>>(`/tables/${tableId}`, authOptions());
}
