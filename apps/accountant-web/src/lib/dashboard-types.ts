// =============================================================================
// dashboard-types.ts — Domain types dashboard KPI (STOP-dash1 ADR-0038)
// =============================================================================
// Mirror della shape di GET /dashboard/stats (accountant-api dashboard.service).
// I totali Decimal sono GIÀ normalizzati a number dal backend (service fa
// .toNumber()) → niente conversione wire qui. `updatedAt` ISO string.
// =============================================================================

import type { StatoPreventivo } from './preventivi-types';

export interface UltimoPreventivo {
  id: string;
  codice: string;
  oggetto: string;
  stato: StatoPreventivo;
  totale: number;
  aziendaId: string;
  aziendaNome: string;
  updatedAt: string; // ISO
}

export interface DashboardStats {
  clienti: {
    totale: number;
    attivi: number;
    nonAttivi: number;
    perTipo: { azienda: number; personaFisica: number };
  };
  preventivi: {
    totale: number;
    perStato: { bozza: number; inviato: number; accettato: number; rifiutato: number };
    valoreTotale: number;
    ultimi: UltimoPreventivo[];
  };
}
