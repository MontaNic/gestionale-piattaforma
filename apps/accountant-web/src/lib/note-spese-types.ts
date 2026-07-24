// =============================================================================
// note-spese-types.ts — Domain types note spese (accountant, ADR-0074/75/76)
// =============================================================================
// Shape allineata alle response { data } di accountant-api (note-spese
// controller). Enum replicati come union + const array (no dipendenza da
// @gestionale/db: il FE non importa il package DB, vedi documenti-types).
//
// Wire→domain: `totale`/`distanzaKm` sono Decimal (stringhe sul filo) →
// normalizzati a number in note-spese-api; `data` è @db.Date serializzata come
// ISO datetime → normalizzata a date-only YYYY-MM-DD (pattern scadenze-api).
// `storageKey` non è mai esposto dal backend (PR-3a).
// =============================================================================

export type StatoNotaSpesa = 'bozza' | 'inviata' | 'approvata' | 'respinta';
export const STATI_NOTA_SPESA: readonly StatoNotaSpesa[] = [
  'bozza',
  'inviata',
  'approvata',
  'respinta',
];

export type MetodoPagamentoNotaSpesa =
  | 'contanti'
  | 'carta_aziendale'
  | 'carta_personale'
  | 'bonifico';
export const METODI_PAGAMENTO: readonly MetodoPagamentoNotaSpesa[] = [
  'contanti',
  'carta_aziendale',
  'carta_personale',
  'bonifico',
];

/** Metodi "carta": richiedono lo scontrino POS per l'invio (§4.2). */
export const METODI_CARTA: readonly MetodoPagamentoNotaSpesa[] = [
  'carta_aziendale',
  'carta_personale',
];

export type TipoSpesa =
  | 'vitto'
  | 'alloggio'
  | 'trasporto'
  | 'carburante'
  | 'pedaggio'
  | 'parcheggio'
  | 'rappresentanza'
  | 'formazione'
  | 'cancelleria'
  | 'altro';
export const TIPI_SPESA: readonly TipoSpesa[] = [
  'vitto',
  'alloggio',
  'trasporto',
  'carburante',
  'pedaggio',
  'parcheggio',
  'rappresentanza',
  'formazione',
  'cancelleria',
  'altro',
];

/** Tipi spesa per cui `distanzaKm` è pertinente (§4.6/D4: soft-warning FE). */
export const TIPI_SPESA_CON_KM: readonly TipoSpesa[] = ['trasporto', 'carburante'];

export type AliquotaIvaNotaSpesa = 'iva_22' | 'iva_10' | 'iva_4' | 'esente' | 'non_applicabile';
export const ALIQUOTE_IVA: readonly AliquotaIvaNotaSpesa[] = [
  'iva_22',
  'iva_10',
  'iva_4',
  'esente',
  'non_applicabile',
];

export type DeducibilitaFiscale = 'd_100' | 'd_75' | 'd_50' | 'd_0';
export const DEDUCIBILITA: readonly DeducibilitaFiscale[] = ['d_100', 'd_75', 'd_50', 'd_0'];

export type TipoAllegatoNotaSpesa = 'giustificativo' | 'scontrino_pos';
export const TIPI_ALLEGATO: readonly TipoAllegatoNotaSpesa[] = ['giustificativo', 'scontrino_pos'];

/** Allegato nella lista (payload leggero, PR-3a). */
export interface AllegatoRef {
  id: string;
  tipo: TipoAllegatoNotaSpesa;
}

/** Allegato nel dettaglio (PR-3a). Nessuno `storageKey`: il download passa dall'id. */
export interface AllegatoNotaSpesa extends AllegatoRef {
  nomeOriginale: string;
  mimeType: string;
  dimensione: number;
  createdAt: string;
}

/** Campi comuni a lista e dettaglio (domain, già normalizzati). */
interface NotaSpesaBase {
  id: string;
  tenantId: string;
  userId: string;
  data: string; // YYYY-MM-DD (normalizzata)
  aziendaId: string | null;
  mandatoId: string | null;
  tipoSpesa: TipoSpesa;
  metodoPagamento: MetodoPagamentoNotaSpesa;
  totale: number; // Decimal sul filo
  aliquotaIva: AliquotaIvaNotaSpesa;
  deducibilitaFiscale: DeducibilitaFiscale;
  fatturataASocieta: boolean;
  distanzaKm: number | null; // Decimal sul filo
  scopoMissione: string;
  note: string | null;
  stato: StatoNotaSpesa;
  inviataAt: string | null;
  decisaAt: string | null;
  decisaDaId: string | null;
  motivoRifiuto: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Elemento di lista: allegati leggeri (badge + indicatore presenza). */
export interface NotaSpesa extends NotaSpesaBase {
  allegati: AllegatoRef[];
}

/** Dettaglio: allegati completi (vista + download). */
export interface NotaSpesaDetail extends NotaSpesaBase {
  allegati: AllegatoNotaSpesa[];
}

export interface CreateNotaSpesaInput {
  data: string; // YYYY-MM-DD
  tipoSpesa: TipoSpesa;
  metodoPagamento: MetodoPagamentoNotaSpesa;
  totale: number;
  aliquotaIva: AliquotaIvaNotaSpesa;
  deducibilitaFiscale: DeducibilitaFiscale;
  scopoMissione: string;
  aziendaId?: string | null;
  mandatoId?: string | null;
  fatturataASocieta?: boolean;
  distanzaKm?: number | null;
  note?: string | null;
}

export type UpdateNotaSpesaInput = Partial<CreateNotaSpesaInput>;

export interface GetNoteSpeseParams {
  mese?: string; // YYYY-MM
  stato?: StatoNotaSpesa;
  aziendaId?: string;
  userId?: string; // onorato dal BE solo con notespese.leggi_tutte
}

// ── Helper di dominio (regole §4, usate per i warning FE non bloccanti) ───────

/** Giustificativo obbligatorio all'invio se `totale > 0` (§4.1). */
export function richiedeGiustificativo(n: { totale: number }): boolean {
  return n.totale > 0;
}

/** Scontrino POS obbligatorio all'invio se pagamento con carta (§4.2). */
export function richiedeScontrino(n: { metodoPagamento: MetodoPagamentoNotaSpesa }): boolean {
  return METODI_CARTA.includes(n.metodoPagamento);
}

/** Allegato mancante che bloccherebbe l'invio (§4.1/§4.2). Warning FE, non gate. */
export function allegatiMancanti(n: {
  totale: number;
  metodoPagamento: MetodoPagamentoNotaSpesa;
  allegati: readonly AllegatoRef[];
}): TipoAllegatoNotaSpesa[] {
  const presenti = new Set(n.allegati.map((a) => a.tipo));
  const mancanti: TipoAllegatoNotaSpesa[] = [];
  if (richiedeGiustificativo(n) && !presenti.has('giustificativo')) mancanti.push('giustificativo');
  if (richiedeScontrino(n) && !presenti.has('scontrino_pos')) mancanti.push('scontrino_pos');
  return mancanti;
}

/** `distanzaKm` valorizzata su un tipo spesa non pertinente (§4.6/D4, soft). */
export function distanzaKmFuoriContesto(n: {
  distanzaKm: number | null;
  tipoSpesa: TipoSpesa;
}): boolean {
  return n.distanzaKm !== null && n.distanzaKm > 0 && !TIPI_SPESA_CON_KM.includes(n.tipoSpesa);
}

/** Stati in cui la nota è modificabile (campi + allegati) — §4.4, enforced dal BE. */
export function isEditabile(n: { stato: StatoNotaSpesa }): boolean {
  return n.stato === 'bozza' || n.stato === 'respinta';
}
