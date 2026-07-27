// =============================================================================
// format.ts — Formatter di display condivisi (Cassa PR2, ADR-0082 D6)
// =============================================================================
// `formatEuro` nasceva duplicato per-pagina (comande/[contoId]); con la vista
// cassa i punti di render monetari diventano molti (residuo, importi pagamento,
// riepilogo IVA) → un solo punto di verità per la resa.
//
// Convenzione invariata rispetto all'originale: `€ 8.00` (2 decimali fissi,
// punto decimale, spazio dopo il simbolo). NON usa `Intl.NumberFormat`: la
// locale-awareness cambierebbe separatore e posizione del simbolo rispetto a
// quanto già a schermo oggi — resa uniforme > correttezza locale, finché non
// arriva una decisione i18n sui numeri.
//
// ⚠️ Solo DISPLAY. I monetari sono Decimal(10,2) lato BE e viaggiano come
// stringa: la normalizzazione wire→number vive nei mapper di `conti-api.ts`.
// Nessun calcolo di dominio va fatto sui `number` così ottenuti.
// =============================================================================

export function formatEuro(value: number): string {
  return `€ ${value.toFixed(2)}`;
}
