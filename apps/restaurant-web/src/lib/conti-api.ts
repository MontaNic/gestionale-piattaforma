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
import { authOptions } from '@gestionale/auth-web';

import type {
  AddRigaInput,
  ComandaInviata,
  Conto,
  ContoRiga,
  ContoWithRighe,
  CreateContoInput,
  ListContiParams,
  Pagamento,
  RawRiepilogoIvaGruppo,
  RegistraPagamentoInput,
  RiepilogoIvaGruppo,
  UpdateRigaInput,
} from './conti-types';

interface Wrapped<T> {
  data: T;
}

// ── Wire shapes + normalizzazione Decimal→number ─────────────────────────────
// Il backend serializza i Decimal come stringa: qui i tipi "Raw" li tengono
// stringa e i mapper li convertono a number prima di consegnarli alla UI.
//
// Cassa (ADR-0082): `residuo` e `pagamenti[].importo` sono Decimal → stessa
// normalizzazione di `totale`. `statoPagamento` e `chiudibile` arrivano già
// tipizzati dal BE e NON vengono toccati: sono autoritativi, ricalcolarli qui
// reintrodurrebbe la divergenza che il campo `chiudibile` esiste per evitare.
// `riepilogoIvaSnapshot` resta stringa nel dominio (fotografia fiscale, ADR-0081
// D4): il mapper lo converte solo al momento del render.

type RawContoRiga = Omit<ContoRiga, 'prezzoUnitario'> & { prezzoUnitario: string };
type RawPagamento = Omit<Pagamento, 'importo'> & { importo: string };
type RawContoWithRighe = Omit<
  ContoWithRighe,
  'righe' | 'totale' | 'pagamenti' | 'residuo' | 'riepilogoIva'
> & {
  righe: RawContoRiga[];
  totale: string;
  pagamenti: RawPagamento[];
  residuo: string;
  riepilogoIva: RawRiepilogoIvaGruppo[];
};

function mapContoRiga(r: RawContoRiga): ContoRiga {
  return { ...r, prezzoUnitario: Number(r.prezzoUnitario) };
}

function mapPagamento(p: RawPagamento): Pagamento {
  return { ...p, importo: Number(p.importo) };
}

/** Wire→dominio del riepilogo IVA. Esportata: la usa anche lo SNAPSHOT congelato. */
export function mapRiepilogoIva(g: RawRiepilogoIvaGruppo): RiepilogoIvaGruppo {
  return {
    vatPercent: g.vatPercent,
    lordo: Number(g.lordo),
    imponibile: Number(g.imponibile),
    iva: Number(g.iva),
  };
}

function mapContoWithRighe(c: RawContoWithRighe): ContoWithRighe {
  return {
    ...c,
    righe: c.righe.map(mapContoRiga),
    totale: Number(c.totale),
    pagamenti: c.pagamenti.map(mapPagamento),
    residuo: Number(c.residuo),
    riepilogoIva: c.riepilogoIva.map(mapRiepilogoIva),
  };
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

/**
 * Invia in cucina le righe pending del conto (split server-side per reparto).
 * Ritorna una `ComandaInviata` per reparto: nessun campo Decimal → nessun
 * mapper. Errori: 409 `E_COMANDA_NO_RIGHE_PENDING` (nessuna pending),
 * 409 `E_CONTO_NOT_OPEN` (conto non aperto).
 */
export async function inviaConto(contoId: string): Promise<ComandaInviata[]> {
  const res = await apiPost<Wrapped<ComandaInviata[]>>(
    `/conti/${contoId}/invia`,
    undefined,
    authOptions(),
  );
  return res.data;
}

// ── Pagamenti (Cassa pre-fiscale, ADR-0081 / ADR-0082) ───────────────────────
// Le 3 rotte vivono sotto i permessi `cassa.*`, distinti da `comande.*`: un
// cassiere può incassare senza toccare le righe. Nessuna delle 3 restituisce il
// conto aggiornato → dopo ogni mutazione il chiamante rifà `getConto` (pattern
// pessimistico di `comande/[contoId]`), che è anche l'unica fonte di `residuo`
// e `chiudibile` freschi.

/** `GET /conti/:id/pagamenti` (gate `cassa.visualizza`). Include gli stornati, marcati. */
export async function listPagamenti(contoId: string): Promise<Pagamento[]> {
  const res = await apiGet<Wrapped<RawPagamento[]>>(`/conti/${contoId}/pagamenti`, authOptions());
  return res.data.map(mapPagamento);
}

/**
 * `POST /conti/:id/pagamenti` (gate `cassa.pagamento.registra`). Ritorna il
 * SINGOLO pagamento creato, non il conto. Errori: 409 `E_PAGAMENTO_EXCEEDS_RESIDUO`
 * (overpay non modellato), 409 `E_CONTO_NOT_OPEN`, 400 sui vincoli del DTO.
 */
export async function registraPagamento(
  contoId: string,
  input: RegistraPagamentoInput,
): Promise<Pagamento> {
  const res = await apiPost<Wrapped<RawPagamento>>(
    `/conti/${contoId}/pagamenti`,
    input,
    authOptions(),
  );
  return mapPagamento(res.data);
}

/**
 * `POST /conti/:id/pagamenti/:pagamentoId/storna` (gate `cassa.storno.esegui`).
 * Storno SOFT e terminale: il pagamento resta visibile marcato ed esce dal
 * residuo. Errori: 409 `E_PAGAMENTO_ALREADY_STORNATO`, 409 `E_CONTO_NOT_OPEN`,
 * 404 `E_PAGAMENTO_NOT_FOUND`.
 */
export async function stornaPagamento(contoId: string, pagamentoId: string): Promise<Pagamento> {
  const res = await apiPost<Wrapped<RawPagamento>>(
    `/conti/${contoId}/pagamenti/${pagamentoId}/storna`,
    undefined,
    authOptions(),
  );
  return mapPagamento(res.data);
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

/** Storno di una riga INVIATA (ADR-storno): marca `stornata`, non cancella. */
export async function stornaRigaInviata(contoId: string, rigaId: string): Promise<void> {
  await apiPost<Wrapped<unknown>>(
    `/conti/${contoId}/righe/${rigaId}/storna`,
    undefined,
    authOptions(),
  );
}
