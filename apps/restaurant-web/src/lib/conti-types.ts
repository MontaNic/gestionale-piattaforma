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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
