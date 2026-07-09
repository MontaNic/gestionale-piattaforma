// =============================================================================
// catalogo-api.ts — Data access catalogo servizi (ADR-0050)
// =============================================================================
// CRUD categorie + servizi, pattern scadenze-api (apiGet/Post/Patch/Delete +
// authOptions token). Response in { data }. Le righe piattaforma hanno
// tenantId null (read-only lato UI). prezzoBase/ivaAliquota sono Prisma Decimal:
// sul filo arrivano come STRINGA → normalizzati a number (ADR-0037 Gotcha).
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { authOptions } from '@gestionale/auth-web';

import type { UnitaMisura } from './preventivi-types';

export type TipoRicorrenza = 'una_tantum' | 'mensile' | 'annuale';

interface Wrapped<T> {
  data: T;
}

// ── Categorie ──────────────────────────────────────────────────────────────────

export interface ServizioCategoria {
  id: string;
  tenantId: string | null;
  nome: string;
  descrizione: string | null;
  colore: string;
  ordine: number;
  attivo: boolean;
}

export interface CreateServizioCategoriaInput {
  nome: string;
  descrizione?: string;
  colore?: string;
  ordine?: number;
  attivo?: boolean;
}

export type UpdateServizioCategoriaInput = Partial<CreateServizioCategoriaInput>;

// ── Servizi ────────────────────────────────────────────────────────────────────

interface RawServizio {
  id: string;
  tenantId: string | null;
  codice: string;
  nome: string;
  descrizione: string | null;
  categoriaId: string | null;
  unitaMisura: UnitaMisura;
  prezzoBase: string; // Decimal sul filo
  ivaAliquota: string; // Decimal sul filo
  tipoRicorrenza: TipoRicorrenza;
  attivo: boolean;
  ordine: number;
}

export interface ServizioCatalogo {
  id: string;
  tenantId: string | null;
  codice: string;
  nome: string;
  descrizione: string | null;
  categoriaId: string | null;
  unitaMisura: UnitaMisura;
  prezzoBase: number;
  ivaAliquota: number;
  tipoRicorrenza: TipoRicorrenza;
  attivo: boolean;
  ordine: number;
}

export interface CreateServizioCatalogoInput {
  codice: string;
  nome: string;
  descrizione?: string;
  categoriaId?: string;
  unitaMisura?: UnitaMisura;
  prezzoBase: number;
  ivaAliquota?: number;
  tipoRicorrenza?: TipoRicorrenza;
  attivo?: boolean;
  ordine?: number;
}

export type UpdateServizioCatalogoInput = Partial<CreateServizioCatalogoInput>;

function mapServizio(r: RawServizio): ServizioCatalogo {
  return {
    ...r,
    prezzoBase: Number(r.prezzoBase),
    ivaAliquota: Number(r.ivaAliquota),
  };
}

// ── Categorie API ────────────────────────────────────────────────────────────

export async function getCatalogoCategorie(): Promise<ServizioCategoria[]> {
  const res = await apiGet<Wrapped<ServizioCategoria[]>>('/catalogo/categorie', authOptions());
  return res.data;
}

export async function createCatalogoCategoria(
  input: CreateServizioCategoriaInput,
): Promise<ServizioCategoria> {
  const res = await apiPost<Wrapped<ServizioCategoria>>(
    '/catalogo/categorie',
    input,
    authOptions(),
  );
  return res.data;
}

export async function updateCatalogoCategoria(
  id: string,
  input: UpdateServizioCategoriaInput,
): Promise<ServizioCategoria> {
  const res = await apiPatch<Wrapped<ServizioCategoria>>(
    `/catalogo/categorie/${id}`,
    input,
    authOptions(),
  );
  return res.data;
}

export async function deleteCatalogoCategoria(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(
    `/catalogo/categorie/${id}`,
    authOptions(),
  );
}

// ── Servizi API ──────────────────────────────────────────────────────────────

export interface GetServiziParams {
  categoriaId?: string;
  attivo?: boolean;
}

export async function getCatalogoServizi(
  params: GetServiziParams = {},
): Promise<ServizioCatalogo[]> {
  const qs = new URLSearchParams();
  if (params.categoriaId) qs.set('categoriaId', params.categoriaId);
  if (params.attivo !== undefined) qs.set('attivo', String(params.attivo));
  const query = qs.toString();
  const res = await apiGet<Wrapped<RawServizio[]>>(
    `/catalogo/servizi${query ? `?${query}` : ''}`,
    authOptions(),
  );
  return res.data.map(mapServizio);
}

export async function createCatalogoServizio(
  input: CreateServizioCatalogoInput,
): Promise<ServizioCatalogo> {
  const res = await apiPost<Wrapped<RawServizio>>('/catalogo/servizi', input, authOptions());
  return mapServizio(res.data);
}

export async function updateCatalogoServizio(
  id: string,
  input: UpdateServizioCatalogoInput,
): Promise<ServizioCatalogo> {
  const res = await apiPatch<Wrapped<RawServizio>>(`/catalogo/servizi/${id}`, input, authOptions());
  return mapServizio(res.data);
}

export async function deleteCatalogoServizio(id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(`/catalogo/servizi/${id}`, authOptions());
}
