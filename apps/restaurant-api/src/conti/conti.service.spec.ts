// =============================================================================
// conti.service.spec.ts — `isChiudibile`, predicato della guardia di saldo D3
// =============================================================================
// Unit puro (nessun DI, nessun DB): la funzione è esportata dal modulo proprio
// per essere testabile senza istanziare il service. Copre la divergenza VOLUTA
// da `computeStatoPagamento` (`residuo <= 0` → `saldato`): il conto sovra-pagato
// è `saldato` ma NON chiudibile (ADR-0081 D3, esposto da ADR-0082).
// =============================================================================

import { Prisma } from '@gestionale/db';
import { describe, expect, it } from 'vitest';

import { isChiudibile } from './conti.service';

const dec = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

describe('isChiudibile — guardia di saldo D3 (ADR-0081 D3 / ADR-0082)', () => {
  it('residuo == 0 (saldato esatto) → true', () => {
    expect(isChiudibile(dec('8.00'), dec('8.00'))).toBe(true);
  });

  it('totale == 0 senza pagamenti (conto vuoto o tutto stornato) → true', () => {
    expect(isChiudibile(dec('0.00'), dec('0.00'))).toBe(true);
  });

  it('residuo > 0 (nessun incasso) → false', () => {
    expect(isChiudibile(dec('8.00'), dec('0.00'))).toBe(false);
  });

  it('residuo > 0 (incasso parziale) → false', () => {
    expect(isChiudibile(dec('8.00'), dec('3.00'))).toBe(false);
  });

  // ⚠️ CASO CHIAVE: storno parziale di un conto già saldato. `statoPagamento`
  // lo classifica `saldato` (residuo <= 0), ma la chiusura resta BLOCCATA.
  it('residuo < 0 && totale > 0 (sovra-pagato) → false — divergenza voluta da statoPagamento', () => {
    expect(isChiudibile(dec('5.00'), dec('8.00'))).toBe(false);
  });

  // Stessa premessa ma con l'UNICA riga stornata: il totale va a 0 → la seconda
  // clausola del predicato riapre la chiusura (non è ridondante).
  it('residuo < 0 && totale == 0 (unica riga stornata dopo il pagamento) → true', () => {
    expect(isChiudibile(dec('0.00'), dec('8.00'))).toBe(true);
  });

  it('decimali non allineati: 0.01 di residuo → false (nessuna tolleranza)', () => {
    expect(isChiudibile(dec('8.00'), dec('7.99'))).toBe(false);
  });
});
