// =============================================================================
// conti-types.ts — Domain types Comande / Conto (PR-1 FE, ADR-0067/0068)
// =============================================================================
// Shape allineata al contratto backend `/conti` (conti.controller + DTO).
//
// Note di serializzazione JSON:
//   - `Decimal` Prisma (`ContoRiga.prezzoUnitario`, `ContoWithRighe.totale`) →
//     stringa nel body JSON. Qui i tipi DOMINIO usano `number`: la conversione
//     wire→dominio vive nel layer `conti-api.ts` (mai la stringa raw in UI).
//   - `DateTime` → stringa ISO.
// =============================================================================

import type { Channel } from './menu-types';

export type { Channel };
export type StatoConto = 'aperto' | 'chiuso' | 'annullato';
export type PrintDepartment = 'cucina' | 'pizzeria' | 'bar';
export type StatoComanda = 'inviata' | 'in_preparazione' | 'pronta';
/** Portata/corso (ADR-portata). Ordine = ordine di servizio; `nessuna` = fallback. */
export type Portata =
  | 'antipasto'
  | 'primo'
  | 'secondo'
  | 'contorno'
  | 'dolce'
  | 'bevanda'
  | 'nessuna';

/**
 * Canali che possono aprire un conto in PR-1: `cassa` è escluso perché richiede
 * un `tavoloId` (coerenza canale↔tavolo D3) → apertura da tavolo arriva in PR-2.
 */
export const CREATABLE_CHANNELS = ['asporto', 'delivery', 'menu_online'] as const;
export type CreatableChannel = (typeof CREATABLE_CHANNELS)[number];

export const STATI_CONTO: readonly StatoConto[] = ['aperto', 'chiuso', 'annullato'];

export interface Conto {
  id: string;
  tenantId: string;
  tavoloId: string | null;
  channel: Channel;
  coperti: number | null;
  stato: StatoConto;
  apertoIl: string;
  chiusoIl: string | null;
  /**
   * Riepilogo IVA CONGELATO alla chiusura (ADR-0081 D4). `null` su conti aperti,
   * annullati e su tutti i conti pre-migration. Gli importi restano STRINGHE
   * decimali: è una fotografia fiscale, non un dato da ricalcolare — il mapper
   * la converte a number solo per il render (`RiepilogoIvaGruppo`).
   */
  riepilogoIvaSnapshot: RawRiepilogoIvaGruppo[] | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ── Cassa pre-fiscale (ADR-0081 / ADR-0082) ──────────────────────────────────

/** Metodi di pagamento del conto. Distinti da quelli delle note spese (accountant). */
export const METODI_PAGAMENTO = ['contanti', 'carta', 'altro'] as const;
export type MetodoPagamentoConto = (typeof METODI_PAGAMENTO)[number];

/**
 * Stato di pagamento DERIVATO dal BE (ADR-0081 D2), mai persistito e mai
 * ricalcolato qui: `saldato` copre anche il conto sovra-pagato (residuo < 0) e
 * il conto a totale 0. ⚠️ `saldato` NON implica chiudibile — per la chiusura
 * l'unica autorità è `ContoWithRighe.chiudibile`.
 */
export type StatoPagamento = 'da_pagare' | 'parziale' | 'saldato';

export interface Pagamento {
  id: string;
  tenantId: string;
  contoId: string;
  metodo: MetodoPagamentoConto;
  /** Importo APPLICATO al conto. Decimal(10,2) sul wire (stringa) → number nel dominio. */
  importo: number;
  /** Storno soft (ADR-0081): resta visibile marcato, esce dal residuo. Terminale. */
  stornato: boolean;
  stornatoIl: string | null;
  operatoreId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Gruppo del riepilogo IVA per aliquota — scorporo dal lordo (ADR-0070/ADR-0081 D4). */
export interface RiepilogoIvaGruppo {
  vatPercent: number;
  lordo: number;
  imponibile: number;
  iva: number;
}

/** Stessa forma con gli importi come arrivano dal wire (stringhe decimali). */
export interface RawRiepilogoIvaGruppo {
  vatPercent: number;
  lordo: string;
  imponibile: string;
  iva: string;
}

export interface ContoRiga {
  id: string;
  tenantId: string;
  contoId: string;
  articleId: string;
  nomeArticolo: string;
  /** Prisma Decimal(10,2) sul wire (stringa) → number nel dominio. */
  prezzoUnitario: number;
  quantita: number;
  reparto: PrintDepartment;
  /** Portata/corso snapshottata (ADR-portata): raggruppamento KDS/vista conto. */
  portata: Portata;
  /**
   * KDS (ADR-0069): `null` = riga PENDING (da inviare, mutabile); valorizzato =
   * riga INVIATA in cucina (immutabile). Il FE splitta le righe su questo campo.
   */
  comandaId: string | null;
  /** Annotazione cucina per-riga (opzionale). */
  note: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /**
   * Storno riga INVIATA (ADR-storno): `true` = revocata (resa barrata, esclusa
   * dal totale). Distinto da `deletedAt` (pending rimossa). Terminale.
   */
  stornata: boolean;
  stornataIl: string | null;
}

export interface ContoWithRighe extends Conto {
  righe: ContoRiga[];
  /** Derivato dal backend, Decimal sul wire (stringa) → number nel dominio. */
  totale: number;
  /** Pagamenti del conto, ordinati per createdAt asc. Include gli STORNATI (marcati). */
  pagamenti: Pagamento[];
  /**
   * `totale − Σ pagamenti non stornati`. Può essere NEGATIVO (sovra-pagato):
   * accade stornando una riga già pagata. Derivato dal BE.
   */
  residuo: number;
  statoPagamento: StatoPagamento;
  /** Riepilogo IVA LIVE (derivato a ogni GET). Lo snapshot congelato è su `Conto`. */
  riepilogoIva: RiepilogoIvaGruppo[];
  /**
   * Predicato della guardia di saldo D3 così com'è nel BE (ADR-0082):
   * `residuo == 0 || totale == 0`, con `== 0` STRETTO.
   *
   * ⚠️ È l'UNICA autorità sulla chiudibilità: non ricalcolarlo da `residuo` né
   * da `statoPagamento`. Un conto sovra-pagato è `statoPagamento: 'saldato'` con
   * `chiudibile: false` — derivarlo lato UI produrrebbe un bottone che il BE
   * rifiuta con 409 E_CONTO_NOT_SETTLED.
   */
  chiudibile: boolean;
}

// -----------------------------------------------------------------------------
// Input types (request body / query) — allineati ai DTO backend.
// -----------------------------------------------------------------------------

export interface CreateContoInput {
  channel: Channel;
  coperti?: number;
  tavoloId?: string;
}

export interface AddRigaInput {
  articleId: string;
  quantita: number;
  /** Annotazione cucina opzionale (AddRigaDto BE, max 200 char). */
  note?: string;
}

export interface UpdateRigaInput {
  quantita: number;
  /**
   * Nota opzionale (UpdateRigaDto BE, max 200 char). Omessa → il BE lascia la
   * nota invariata; stringa (incl. "") → aggiornata. Editabile solo su riga
   * pending (riga inviata → 409 E_RIGA_ALREADY_SENT).
   */
  note?: string;
}

/**
 * Body di `POST /conti/:id/pagamenti` (RegistraPagamentoDto BE). `importo` in
 * EURO con max 2 decimali, `>= 0.01`; il tetto reale è il residuo del conto e lo
 * verifica il BE (409 E_PAGAMENTO_EXCEEDS_RESIDUO) — il cap lato UI è solo UX.
 */
export interface RegistraPagamentoInput {
  metodo: MetodoPagamentoConto;
  importo: number;
}

/**
 * Esito di `POST /conti/:id/invia` (una Comanda per reparto presente tra le
 * righe pending). `inviataIl` è `DateTime` Prisma → stringa ISO sul wire.
 */
export interface ComandaInviata {
  id: string;
  reparto: PrintDepartment;
  stato: StatoComanda;
  inviataIl: string;
  righeCount: number;
}

export interface ListContiParams {
  stato?: StatoConto;
  tavoloId?: string;
}

// ── Feed KDS (GET /comande, ADR-0069) ────────────────────────────────────────
// Forma derivata dalla risposta reale del BE (`ComandaFeedItem`/`ComandaFeedRiga`
// in comande.service.ts). NESSUN prezzo sul ticket cucina. I `DateTime` Prisma
// viaggiano come stringa ISO sul wire.

/** Riga come mostrata sul ticket cucina: snapshot utile, mai il prezzo. */
export interface ComandaFeedRiga {
  id: string;
  nomeArticolo: string;
  quantita: number;
  note: string | null;
  reparto: PrintDepartment;
  portata: Portata;
  /** ADR-storno: la riga revocata resta nel feed marcata (render in Fase 2). */
  stornata: boolean;
}

/** Comanda nel feed KDS (una per reparto all'invio). */
export interface Comanda {
  id: string;
  contoId: string;
  reparto: PrintDepartment;
  stato: StatoComanda;
  inviataIl: string;
  inPreparazioneIl: string | null;
  prontaIl: string | null;
  tavoloId: string | null;
  tavoloNumero: string | null;
  righe: ComandaFeedRiga[];
}

/**
 * Ordine di SERVIZIO delle portate (non alfabetico): coincide con l'ordine del
 * type `Portata`. Usato per raggruppare le righe sulla board KDS.
 */
export const PORTATA_ORDER: readonly Portata[] = [
  'antipasto',
  'primo',
  'secondo',
  'contorno',
  'dolce',
  'bevanda',
  'nessuna',
];

/** Ordine delle colonne reparto sulla board KDS. */
export const REPARTO_ORDER: readonly PrintDepartment[] = ['cucina', 'pizzeria', 'bar'];
