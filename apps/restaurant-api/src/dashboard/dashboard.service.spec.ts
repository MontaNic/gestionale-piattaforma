// =============================================================================
// dashboard.service.spec.ts — `startOfDayInTimeZone`, confine del giorno (ADR-0084)
// =============================================================================
// Unit puro (nessun DI, nessun DB): la funzione è esportata dal modulo proprio
// per essere testabile senza istanziare il service — stesso schema di
// `isChiudibile` in conti.service.spec.ts.
//
// Perché unit e non e2e: l'e2e non può controllare "adesso", quindi non può
// esercitare i due switch DST — che sono l'unico punto in cui un calcolo del
// confine di giornata sbaglia davvero, e sbaglia di un giorno intero. Nel 2026
// gli switch europei cadono il 29/03 (avanti) e il 25/10 (indietro).
//
// Le attese sono in ISO UTC ED espresse come round-trip: `expectedRomeMidnight`
// verifica che l'istante restituito, riletto in Europe/Rome, sia esattamente
// 00:00:00 del giorno atteso. La seconda forma è indipendente
// dall'implementazione (non rifà lo stesso calcolo con gli stessi ingredienti).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { SERVICE_TIME_ZONE, startOfDayInTimeZone } from './dashboard.service';

/** L'istante, letto in `timeZone`, come "YYYY-MM-DD HH:mm:ss". */
function inZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(instant);
}

/** Il risultato è la mezzanotte romana del giorno atteso — check round-trip. */
function expectRomeMidnight(instant: Date, expectedDay: string): void {
  expect(inZone(startOfDayInTimeZone(instant, SERVICE_TIME_ZONE), SERVICE_TIME_ZONE)).toBe(
    `${expectedDay} 00:00:00`,
  );
}

describe('startOfDayInTimeZone — confine del giorno di servizio (ADR-0084)', () => {
  it('ora solare (CET, +1): mezzanotte romana = 23:00Z del giorno prima', () => {
    const start = startOfDayInTimeZone(new Date('2026-01-15T12:00:00Z'), SERVICE_TIME_ZONE);
    expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expectRomeMidnight(new Date('2026-01-15T12:00:00Z'), '2026-01-15');
  });

  it('ora legale (CEST, +2): mezzanotte romana = 22:00Z del giorno prima', () => {
    const start = startOfDayInTimeZone(new Date('2026-07-15T12:00:00Z'), SERVICE_TIME_ZONE);
    expect(start.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expectRomeMidnight(new Date('2026-07-15T12:00:00Z'), '2026-07-15');
  });

  // ⚠️ IL CASO CHE MOTIVA I DUE PASSAGGI. Il 29/03/2026 alle 14:00 locali siamo
  // già in CEST (+2), ma la mezzanotte di quello stesso giorno era ancora CET
  // (+1). Applicando l'offset dell'istante si otterrebbe 2026-03-28T22:00Z, che
  // in Europe/Rome è le 23:00 del 28 — il GIORNO PRIMA.
  it('giorno di passaggio a ora legale (29/03/2026): mezzanotte ancora CET', () => {
    const start = startOfDayInTimeZone(new Date('2026-03-29T12:00:00Z'), SERVICE_TIME_ZONE);
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expectRomeMidnight(new Date('2026-03-29T12:00:00Z'), '2026-03-29');
  });

  // Simmetrico: il 25/10/2026 alle 13:00 locali siamo già tornati in CET (+1),
  // ma la mezzanotte di quel giorno era ancora CEST (+2).
  it('giorno di ritorno a ora solare (25/10/2026): mezzanotte ancora CEST', () => {
    const start = startOfDayInTimeZone(new Date('2026-10-25T12:00:00Z'), SERVICE_TIME_ZONE);
    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expectRomeMidnight(new Date('2026-10-25T12:00:00Z'), '2026-10-25');
  });

  it('un minuto DOPO la mezzanotte romana → giorno corrente', () => {
    const start = startOfDayInTimeZone(new Date('2026-01-14T23:01:00Z'), SERVICE_TIME_ZONE);
    expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  // Il caso che rende visibile lo scarto fra UTC e Roma: le 22:30Z del 14/01
  // sono ancora il 14 a Roma (23:30), NON il 15. Un `setUTCHours(0,0,0,0)`
  // ingenuo qui restituirebbe il giorno sbagliato per un'ora intera ogni notte.
  it('un minuto PRIMA della mezzanotte romana → giorno precedente', () => {
    const start = startOfDayInTimeZone(new Date('2026-01-14T22:59:00Z'), SERVICE_TIME_ZONE);
    expect(start.toISOString()).toBe('2026-01-13T23:00:00.000Z');
  });

  it('i millisecondi dell istante non sporcano il confine', () => {
    const start = startOfDayInTimeZone(new Date('2026-01-15T12:34:56.789Z'), SERVICE_TIME_ZONE);
    expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('in UTC coincide con la mezzanotte UTC (sanity della funzione generica)', () => {
    const start = startOfDayInTimeZone(new Date('2026-01-15T12:00:00Z'), 'UTC');
    expect(start.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});
