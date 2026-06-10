// =============================================================================
// preventivi-totali.ts — Mirror client della resolution totali (STOP-e2 ADR-0037)
// =============================================================================
// CONTRATTO: replica BYTE-ESATTA della formula server (accountant-api
// preventivi.service.computeVoce/computeTotali, ADR-0036 §A6). Serve a mostrare
// i 3 totali live nell'editor voci SENZA round-trip; il server resta l'autorità
// (ricalcola al salvataggio). Se questa formula diverge dal server, i totali a
// schermo "saltano" dopo il submit → il gate unit (preventivi-totali.test.ts)
// blocca la regressione con casi dove round-riga-prima-IVA ≠ round-aggregato.
//
// Ordine VINCOLANTE (non riordinare):
//   1. lordo = quantita * prezzoUnitario
//   2. scontato = lordo * (1 - scontoPct/100)
//   3. totaleRiga = round2(scontato)            ← arrotonda la riga PRIMA dell'IVA
//   4. iva = round2(totaleRiga * ivaAliquota/100) ← IVA PER-VOCE sul riga arrotondato
//   5. somma imponibili + iva per-voce, POI arrotonda gli aggregati
// =============================================================================

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Input numerico di una voce per il calcolo (già convertito a number). */
export interface VoceNumerica {
  quantita: number;
  prezzoUnitario: number;
  scontoPct: number;
  ivaAliquota: number;
}

export interface VoceComputed {
  totaleRiga: number;
  imponibile: number;
  iva: number;
}

export function computeVoce(v: VoceNumerica): VoceComputed {
  const lordo = v.quantita * v.prezzoUnitario;
  const scontato = lordo * (1 - v.scontoPct / 100);
  const totaleRiga = round2(scontato); // imponibile voce
  const iva = round2(totaleRiga * (v.ivaAliquota / 100));
  return { totaleRiga, imponibile: totaleRiga, iva };
}

export interface TotaliComputed {
  totaleImponibile: number;
  totaleIva: number;
  totale: number;
}

export function computeTotali(voci: VoceNumerica[]): TotaliComputed {
  let totaleImponibile = 0;
  let totaleIva = 0;
  for (const v of voci) {
    const c = computeVoce(v);
    totaleImponibile += c.imponibile;
    totaleIva += c.iva;
  }
  totaleImponibile = round2(totaleImponibile);
  totaleIva = round2(totaleIva);
  return { totaleImponibile, totaleIva, totale: round2(totaleImponibile + totaleIva) };
}
