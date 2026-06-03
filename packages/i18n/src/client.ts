'use client';

import type { Locale } from './config';

// =============================================================================
// client.ts — helper di switch locale lato client (ADR-0018 Sub-DP-A)
// =============================================================================
// Persiste la locale via POST /api/set-locale (cookie NEXT_LOCALE). Ritorna
// `true` se accettata: il chiamante decide come riflettere il cambiamento
// (es. `router.refresh()` per ri-renderizzare gli RSC con le nuove messages,
// senza full reload). Meccanismo agnostico alla UI della shell.
// =============================================================================

export async function setLocale(locale: Locale): Promise<boolean> {
  const res = await fetch('/api/set-locale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
  return res.ok;
}
