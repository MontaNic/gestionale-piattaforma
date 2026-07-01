import { Prisma } from '@gestionale/db';
import { describe, expect, it } from 'vitest';

import { E_PRICE_AMBIGUOUS, PriceAmbiguousError, resolveUnitPrice } from './price-resolution';

const dec = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

describe('resolveUnitPrice — resolver prezzo-per-canale (PR-2, ADR-0068)', () => {
  it('1 listino attivo con override articolo → prezzo override', () => {
    const price = resolveUnitPrice({
      basePrice: dec('8.50'),
      channel: 'cassa',
      matchingActiveListIds: ['list-1'],
      overrideByListId: new Map([['list-1', dec('7.00')]]),
    });
    expect(price.equals(dec('7.00'))).toBe(true);
  });

  it('1 listino attivo senza override per l articolo → basePrice', () => {
    const price = resolveUnitPrice({
      basePrice: dec('8.50'),
      channel: 'cassa',
      matchingActiveListIds: ['list-1'],
      overrideByListId: new Map(),
    });
    expect(price.equals(dec('8.50'))).toBe(true);
  });

  it('0 listini attivi per il canale → basePrice (fallback)', () => {
    const price = resolveUnitPrice({
      basePrice: dec('8.50'),
      channel: 'delivery',
      matchingActiveListIds: [],
      overrideByListId: new Map(),
    });
    expect(price.equals(dec('8.50'))).toBe(true);
  });

  it('override di un ALTRO listino non-matchante è ignorato → basePrice', () => {
    const price = resolveUnitPrice({
      basePrice: dec('8.50'),
      channel: 'cassa',
      matchingActiveListIds: ['list-1'],
      overrideByListId: new Map([['list-OTHER', dec('3.00')]]),
    });
    expect(price.equals(dec('8.50'))).toBe(true);
  });

  it('≥2 listini attivi collidenti sul canale → PriceAmbiguousError (fail-fast)', () => {
    expect(() =>
      resolveUnitPrice({
        basePrice: dec('8.50'),
        channel: 'cassa',
        matchingActiveListIds: ['list-1', 'list-2'],
        overrideByListId: new Map([['list-1', dec('7.00')]]),
      }),
    ).toThrow(PriceAmbiguousError);
  });

  it('PriceAmbiguousError porta errorCode E_PRICE_AMBIGUOUS + matchCount', () => {
    let caught: unknown;
    try {
      resolveUnitPrice({
        basePrice: dec('8.50'),
        channel: 'cassa',
        matchingActiveListIds: ['a', 'b', 'c'],
        overrideByListId: new Map(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PriceAmbiguousError);
    expect((caught as PriceAmbiguousError).errorCode).toBe(E_PRICE_AMBIGUOUS);
    expect((caught as PriceAmbiguousError).matchCount).toBe(3);
  });
});
