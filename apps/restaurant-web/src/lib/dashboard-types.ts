// =============================================================================
// dashboard-types.ts — tipi di dominio dei KPI dashboard (ADR-0084)
// =============================================================================
// Forma DI DOMINIO, non forma di wire: `incassoOggi` qui è un `number`, mentre
// il BE lo serializza come stringa decimale a 2 cifre (Decimal, convenzione
// denaro food — ADR-0070/0081). La normalizzazione vive in `dashboard-api.ts`,
// come per `conti-api.ts`: la UI non deve mai vedere la stringa raw.
// =============================================================================

export interface DashboardStats {
  /** Conti in stato `aperto`. Fotografia: nessun confine temporale. */
  contiAperti: number;
  /** Comande in `inviata` o `in_preparazione`. */
  comandeInCorso: number;
  /** Σ pagamenti non stornati di oggi. `number` dopo la normalizzazione. */
  incassoOggi: number;
  /** Σ coperti dei conti aperti oggi, chiusi inclusi. */
  copertiOggi: number;
}
