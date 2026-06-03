import { cookies } from 'next/headers';

import { isValidLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from './config';

// =============================================================================
// set-locale.ts — handler POST per cookie NEXT_LOCALE (ADR-0018 Sub-DP-A)
// =============================================================================
// Meccanismo riusabile: l'app monta `handleSetLocale` su /api/set-locale.
// Body: { locale: 'it' | 'en' } — validation via whitelist `isValidLocale`.
// Cookie: NEXT_LOCALE, path '/', maxAge 1 anno. Non httpOnly perche' UX
// cross-tab visibility (future feature locale switcher puo' leggere
// document.cookie).
//
// TD-BC: NO rate limit (low-risk F1 authenticated, re-evaluation F2 public).
// Il matcher del middleware esclude `/api/` → path pass-through, NO slug
// validation interferisce.
// =============================================================================

export async function handleSetLocale(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
  }

  const locale = (body as { locale?: unknown })?.locale;
  if (typeof locale !== 'string' || !isValidLocale(locale)) {
    return Response.json({ ok: false, error: 'INVALID_LOCALE' }, { status: 400 });
  }

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });

  return Response.json({ ok: true, locale });
}
