import type { NextRequest, NextResponse } from 'next/server';

import { defaultLocale, isValidLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from './config';

// =============================================================================
// middleware.ts — locale guard per il middleware Next (ADR-0018 Sub-DP-A)
// =============================================================================
// Difesa in profondità (edge): se il cookie `NEXT_LOCALE` ha un valore non
// valido (l'utente può settarlo via document.cookie) lo si resetta a
// `defaultLocale`. La risoluzione locale effettiva avviene server-side in
// `request.ts`. Restituisce la stessa `response` per consentire il chaining
// con la logica applicativa (es. slug-routing del verticale).
// =============================================================================

export function applyLocaleGuard(req: NextRequest, response: NextResponse): NextResponse {
  const raw = req.cookies.get(LOCALE_COOKIE)?.value;
  if (raw && !isValidLocale(raw)) {
    response.cookies.set(LOCALE_COOKIE, defaultLocale, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
    });
  }
  return response;
}
