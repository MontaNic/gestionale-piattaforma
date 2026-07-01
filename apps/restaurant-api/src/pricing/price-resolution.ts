// =============================================================================
// price-resolution.ts — Core puro del resolver prezzo-per-canale (PR-2, ADR-0068)
// =============================================================================
// Funzione pura (no DB, no NestJS) → unit-testabile in isolamento. È il pezzo di
// rischio di PR-2: la selezione del prezzo dato l'insieme di listini attivi che
// coprono un canale.
//
// Scope-lock PR-2 (D2, STOP 0 pricing): resolver BANALE — al più 1 listino
// attivo per canale nei dati reali. La selezione multi-listino (priority +
// finestre validità) è dormiente → TD-pricing-multilistino.
//   - ≥2 listini attivi sul canale → PriceAmbiguousError (fail-fast: MAI un
//     prezzo non-deterministico; modello+service NON impediscono l'overlap).
//   - 1 listino → override ArticlePrice(article, list) se esiste, altrimenti basePrice.
//   - 0 listini → basePrice (fallback).
// `priority`/`validFromDate`/`validToDate` NON sono usati per selezionare.
// =============================================================================

import { Prisma } from '@gestionale/db';

export const E_PRICE_AMBIGUOUS = 'E_PRICE_AMBIGUOUS';

/** Sollevato quando ≥2 listini attivi coprono lo stesso canale (fail-fast). */
export class PriceAmbiguousError extends Error {
  readonly errorCode = E_PRICE_AMBIGUOUS;
  constructor(
    readonly channel: string,
    readonly matchCount: number,
  ) {
    super(`Ambiguous price: ${matchCount} active price lists match channel '${channel}'`);
    this.name = 'PriceAmbiguousError';
  }
}

export interface PriceResolutionInput {
  /** `Article.basePrice` — fallback e prezzo per canali senza listino. */
  basePrice: Prisma.Decimal;
  /** Canale della vendita (per il messaggio d'errore). */
  channel: string;
  /** Id dei listini ATTIVI + non-deleted che includono `channel`. */
  matchingActiveListIds: readonly string[];
  /** `ArticlePrice.price` per l'articolo, indicizzato per `priceListId`. */
  overrideByListId: ReadonlyMap<string, Prisma.Decimal>;
}

/**
 * Risolve il prezzo unitario da congelare (snapshot DP-C). Pura: nessun side
 * effect, deterministica. Vedi caveat scope-lock nell'header.
 */
export function resolveUnitPrice(input: PriceResolutionInput): Prisma.Decimal {
  const { basePrice, channel, matchingActiveListIds, overrideByListId } = input;

  if (matchingActiveListIds.length >= 2) {
    throw new PriceAmbiguousError(channel, matchingActiveListIds.length);
  }
  // Dopo la guardia >=2 la lunghezza è 0 o 1: [0] è l'unico listino o undefined.
  const onlyListId = matchingActiveListIds[0];
  if (onlyListId !== undefined) {
    return overrideByListId.get(onlyListId) ?? basePrice;
  }
  return basePrice;
}
