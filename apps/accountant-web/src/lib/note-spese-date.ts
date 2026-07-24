// =============================================================================
// note-spese-date.ts — helper mese/giorno per le viste note spese
// =============================================================================
// Aritmetica in UTC: `data` è date-only (YYYY-MM-DD) e non deve subire drift di
// fuso. "Oggi" invece è calcolato sul calendario LOCALE dell'utente (è la sua
// giornata, non quella UTC). Nessuna dipendenza date esterna nel repo.
// =============================================================================

/** Mese corrente dell'utente in formato YYYY-MM. */
export function meseCorrente(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Oggi (calendario locale) in formato YYYY-MM-DD. */
export function oggiLocale(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Sposta il mese YYYY-MM di `delta` mesi (gestisce il cambio d'anno). */
export function shiftMese(mese: string, delta: number): string {
  const anno = Number(mese.slice(0, 4));
  const m = Number(mese.slice(5, 7));
  const d = new Date(Date.UTC(anno, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Numero di giorni del mese (mese 1-based). */
export function giorniDelMese(anno: number, mese1based: number): number {
  return new Date(Date.UTC(anno, mese1based, 0)).getUTCDate();
}

/** Offset lunedì-first della prima cella del mese (0 = lunedì … 6 = domenica). */
export function offsetPrimoGiorno(anno: number, mese1based: number): number {
  const dow = new Date(Date.UTC(anno, mese1based - 1, 1)).getUTCDay(); // 0 = domenica
  return (dow + 6) % 7;
}

/** `YYYY-MM-DD` → Date UTC stabile per la formattazione Intl. */
export function giornoToDate(giorno: string): Date {
  return new Date(`${giorno}T00:00:00Z`);
}
