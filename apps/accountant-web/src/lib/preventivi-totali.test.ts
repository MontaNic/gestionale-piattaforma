// =============================================================================
// preventivi-totali.test.ts — Gate dedicato mirror totali (STOP-e2 ADR-0037 §test)
// =============================================================================
// Garantisce che il mirror client dia lo STESSO risultato del server. I casi
// "divergenti" sono scelti perché `round-riga-prima-IVA` produce un numero
// diverso da `round-aggregato` (round dopo aver sommato tutto): se qualcuno
// riordina la formula, almeno un caso fallisce.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { computeTotali, computeVoce, round2, type VoceNumerica } from './preventivi-totali';

describe('round2', () => {
  it('arrotonda half-up a 2 decimali', () => {
    // Documenta il comportamento float REALE (identico al server, stessa formula):
    expect(round2(1.005)).toBe(1.0); // 1.005*100 = 100.4999… → 100
    expect(round2(1.015)).toBe(1.01); // 1.015*100 = 101.4999… → 101
    expect(round2(1.255)).toBe(1.25); // 1.255*100 = 125.4999… → 125
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('computeVoce', () => {
  it('applica sconto poi IVA sul totaleRiga arrotondato', () => {
    // 3 * 10 = 30; sconto 10% → 27; IVA 22% di 27 = 5.94
    const c = computeVoce({ quantita: 3, prezzoUnitario: 10, scontoPct: 10, ivaAliquota: 22 });
    expect(c.totaleRiga).toBe(27);
    expect(c.imponibile).toBe(27);
    expect(c.iva).toBe(5.94);
  });

  it('arrotonda la riga PRIMA di calcolare l’IVA', () => {
    // 1 * 0.333 = 0.333 → round2 = 0.33; IVA 22% di 0.33 = 0.0726 → 0.07
    // (NON 22% di 0.333 = 0.07326 → 0.07, qui coincide ma il riga è 0.33 non 0.333)
    const c = computeVoce({ quantita: 1, prezzoUnitario: 0.333, scontoPct: 0, ivaAliquota: 22 });
    expect(c.totaleRiga).toBe(0.33);
    expect(c.iva).toBe(0.07);
  });
});

describe('computeTotali — casi dove round-per-voce ≠ round-aggregato', () => {
  // Caso 1: tre righe la cui IVA per-voce arrotondata somma diversamente
  // dall'IVA calcolata sull'imponibile aggregato.
  it('caso 1: IVA per-voce sommata ≠ IVA su imponibile aggregato', () => {
    const voci: VoceNumerica[] = [
      { quantita: 1, prezzoUnitario: 0.1, scontoPct: 0, ivaAliquota: 22 }, // riga 0.10, iva round2(0.022)=0.02
      { quantita: 1, prezzoUnitario: 0.1, scontoPct: 0, ivaAliquota: 22 }, // riga 0.10, iva 0.02
      { quantita: 1, prezzoUnitario: 0.1, scontoPct: 0, ivaAliquota: 22 }, // riga 0.10, iva 0.02
    ];
    // Per-voce: imponibile 0.30, iva 0.02*3 = 0.06, totale 0.36.
    // Aggregato sbagliato: round2(0.30*0.22) = round2(0.066) = 0.07 → divergerebbe.
    const t = computeTotali(voci);
    expect(t.totaleImponibile).toBe(0.3);
    expect(t.totaleIva).toBe(0.06);
    expect(t.totale).toBe(0.36);
  });

  // Caso 2: aliquote IVA miste (22% e 10%) — l'aggregato non può usare un'unica
  // aliquota; l'unico risultato corretto è la somma per-voce.
  it('caso 2: aliquote miste 22% e 10%', () => {
    const voci: VoceNumerica[] = [
      { quantita: 2, prezzoUnitario: 50, scontoPct: 0, ivaAliquota: 22 }, // riga 100, iva 22
      { quantita: 1, prezzoUnitario: 30, scontoPct: 0, ivaAliquota: 10 }, // riga 30, iva 3
    ];
    const t = computeTotali(voci);
    expect(t.totaleImponibile).toBe(130);
    expect(t.totaleIva).toBe(25);
    expect(t.totale).toBe(155);
  });

  // Caso 3: sconto frazionario che genera centesimi sulla riga, poi IVA.
  it('caso 3: sconto frazionario → arrotondamento riga propaga sull’IVA', () => {
    const voci: VoceNumerica[] = [
      { quantita: 3, prezzoUnitario: 9.99, scontoPct: 7, ivaAliquota: 22 },
      // lordo 29.97; scontato 29.97*0.93 = 27.8721 → riga round2 = 27.87
      // iva round2(27.87*0.22)=round2(6.1314)=6.13
      { quantita: 1, prezzoUnitario: 5.55, scontoPct: 0, ivaAliquota: 10 },
      // riga 5.55; iva round2(0.555)=0.56  (0.555 → round-half: 55.5→56)
    ];
    const t = computeTotali(voci);
    expect(t.totaleImponibile).toBe(round2(27.87 + 5.55));
    expect(t.totaleImponibile).toBe(33.42);
    expect(t.totaleIva).toBe(round2(6.13 + 0.56));
    expect(t.totaleIva).toBe(6.69);
    expect(t.totale).toBe(40.11);
  });

  it('lista vuota → tutti zero', () => {
    const t = computeTotali([]);
    expect(t).toEqual({ totaleImponibile: 0, totaleIva: 0, totale: 0 });
  });
});
