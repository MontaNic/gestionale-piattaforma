// =============================================================================
// preventivi-api.ts — Data access client preventivi (STOP-e2 ADR-0037)
// =============================================================================
// Funzioni tipizzate sopra @gestionale/api-client, satellite nested sotto
// aziende: /aziende/:aziendaId/preventivi. NO react-query (confine del verticale,
// coerente con aziende-api/referenti-api). Token via getAccessToken(). Response
// in { data }. La lista torna testate (senza voci); il detail include le voci.
//
// NORMALIZZAZIONE wire→domain (scoperta in verifica runtime STOP-e2): Prisma
// serializza i campi `Decimal` come STRINGA JSON ("432.1", non 432.1) e i
// `DateTime` come ISO completo ("2025-12-31T00:00:00.000Z"). Qui mappiamo una
// volta sola: Decimal→number, `validoFino`→date-only (YYYY-MM-DD), così i
// domain types (number, YYYY-MM-DD) restano onesti e i componenti non devono
// fare conversioni difensive (niente `Number(p.totale)` sparsi).
// =============================================================================

import { apiDelete, apiGet, apiPatch, apiPost } from '@gestionale/api-client';
import { getAccessToken } from '@gestionale/auth-web';

import type {
  CreatePreventivoInput,
  Preventivo,
  PreventivoVoce,
  PreventivoWithVoci,
  StatoPreventivo,
  UnitaMisura,
  UpdatePreventivoInput,
} from './preventivi-types';

interface Wrapped<T> {
  data: T;
}

// Shape grezza sul filo: Decimal come stringa, DateTime come ISO completo.
interface RawVoce {
  id: string;
  tenantId: string;
  preventivoId: string;
  nome: string;
  descrizione: string | null;
  unitaMisura: UnitaMisura;
  quantita: string;
  prezzoUnitario: string;
  scontoPct: string;
  ivaAliquota: string;
  totaleRiga: string;
  ordine: number;
  note: string | null;
}

interface RawPreventivo {
  id: string;
  tenantId: string;
  aziendaId: string;
  codice: string;
  oggetto: string;
  coverLetter: string | null;
  noteInterne: string | null;
  stato: StatoPreventivo;
  validoFino: string | null;
  totaleImponibile: string;
  totaleIva: string;
  totale: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  voci?: RawVoce[];
}

/** Date-only YYYY-MM-DD da un ISO datetime (o null). */
function toDateOnly(v: string | null): string | null {
  return v ? v.slice(0, 10) : null;
}

function mapVoce(r: RawVoce): PreventivoVoce {
  return {
    id: r.id,
    tenantId: r.tenantId,
    preventivoId: r.preventivoId,
    nome: r.nome,
    descrizione: r.descrizione,
    unitaMisura: r.unitaMisura,
    quantita: Number(r.quantita),
    prezzoUnitario: Number(r.prezzoUnitario),
    scontoPct: Number(r.scontoPct),
    ivaAliquota: Number(r.ivaAliquota),
    totaleRiga: Number(r.totaleRiga),
    ordine: r.ordine,
    note: r.note,
  };
}

function mapPreventivo(r: RawPreventivo): Preventivo {
  return {
    id: r.id,
    tenantId: r.tenantId,
    aziendaId: r.aziendaId,
    codice: r.codice,
    oggetto: r.oggetto,
    coverLetter: r.coverLetter,
    noteInterne: r.noteInterne,
    stato: r.stato,
    validoFino: toDateOnly(r.validoFino),
    totaleImponibile: Number(r.totaleImponibile),
    totaleIva: Number(r.totaleIva),
    totale: Number(r.totale),
    deletedAt: r.deletedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapWithVoci(r: RawPreventivo): PreventivoWithVoci {
  return { ...mapPreventivo(r), voci: (r.voci ?? []).map(mapVoce) };
}

function authOptions(): { accessToken?: string } {
  return { accessToken: getAccessToken() ?? undefined };
}

export async function listPreventivi(aziendaId: string): Promise<Preventivo[]> {
  const res = await apiGet<Wrapped<RawPreventivo[]>>(
    `/aziende/${aziendaId}/preventivi`,
    authOptions(),
  );
  return res.data.map(mapPreventivo);
}

export async function getPreventivo(aziendaId: string, id: string): Promise<PreventivoWithVoci> {
  const res = await apiGet<Wrapped<RawPreventivo>>(
    `/aziende/${aziendaId}/preventivi/${id}`,
    authOptions(),
  );
  return mapWithVoci(res.data);
}

export async function createPreventivo(
  aziendaId: string,
  input: CreatePreventivoInput,
): Promise<PreventivoWithVoci> {
  const res = await apiPost<Wrapped<RawPreventivo>>(
    `/aziende/${aziendaId}/preventivi`,
    input,
    authOptions(),
  );
  return mapWithVoci(res.data);
}

export async function updatePreventivo(
  aziendaId: string,
  id: string,
  input: UpdatePreventivoInput,
): Promise<PreventivoWithVoci> {
  const res = await apiPatch<Wrapped<RawPreventivo>>(
    `/aziende/${aziendaId}/preventivi/${id}`,
    input,
    authOptions(),
  );
  return mapWithVoci(res.data);
}

/** DELETE backend risponde 200 `{ data: { id, deleted: true } }`, non 204. */
export async function deletePreventivo(aziendaId: string, id: string): Promise<void> {
  await apiDelete<Wrapped<{ id: string; deleted: true }>>(
    `/aziende/${aziendaId}/preventivi/${id}`,
    authOptions(),
  );
}
