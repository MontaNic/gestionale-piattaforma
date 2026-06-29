// =============================================================================
// money.util.ts — arrotondamento monetario condiviso (2 decimali).
// =============================================================================
// Usato da report (margine), tariffe e prestazioni (importo derivato) per
// arrotondare in modo coerente a 2 decimali. Estratto da report.service per
// evitare duplicazione (ADR-0055, Onda 4 Task 3b).
// =============================================================================

export const round2 = (n: number): number => Math.round(n * 100) / 100;
