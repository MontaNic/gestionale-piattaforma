// =============================================================================
// dashboard-stats.dto.ts — contratto di risposta GET /dashboard/stats (ADR-0084)
// =============================================================================
// Response-only: l'endpoint non accetta né body né query, quindi non c'è nulla
// da validare con class-validator (a differenza dei `*.query.dto.ts` di conti/
// comande). Il DTO qui è puro contratto di forma, condiviso fra service e
// controller e consumato dal FE (PR3).
//
// ⚠️ `incassoOggi` è una STRINGA decimale a 2 cifre, non un number. È la
// convenzione denaro del verticale food (ADR-0070): `Conto.totale`/`residuo`
// sono già `Decimal.toFixed(2)` in `conti.service`. Diverge di proposito da
// ADR-0038 (accountant, `Decimal.toNumber()`): là la conversione a number era
// una scelta per evitare la gotcha wire di ADR-0037, qui la stringa è la forma
// già in uso su tutte le altre superfici food — allinearsi a essa vale più che
// allinearsi all'altro verticale.
// =============================================================================

export interface DashboardStats {
  /** Conti in stato `aperto` (nessun confine temporale: è una fotografia). */
  contiAperti: number;
  /** Comande in `inviata` o `in_preparazione` (le `pronta` non sono "in corso"). */
  comandeInCorso: number;
  /** Σ pagamenti non stornati creati da inizio giornata. Decimale a 2 cifre. */
  incassoOggi: string;
  /** Σ `coperti` dei conti APERTI oggi — inclusi quelli nel frattempo chiusi. */
  copertiOggi: number;
}
