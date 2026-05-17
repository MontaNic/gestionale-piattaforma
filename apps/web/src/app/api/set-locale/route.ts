import { cookies } from 'next/headers';

import { isValidLocale } from '@/i18n/config';

// =============================================================================
// /api/set-locale — POST handler per cookie NEXT_LOCALE (ADR-0018 Sub-DP-A)
// =============================================================================
// Body: { locale: 'it' | 'en' }
// Validation: locale in lista whitelist (i18n/config.ts isValidLocale).
// Cookie: NEXT_LOCALE, path '/', maxAge 1 anno. Non httpOnly perche' UX
// cross-tab visibility (storage event listener AuthContext non legge cookie,
// ma future feature locale switcher cross-tab puo' leggere document.cookie).
//
// TD-BC: NO rate limit (low-risk F1 authenticated, re-evaluation F2 public).
// Middleware matcher esclude `/api/` → questo path e' pass-through, NO slug
// validation interferisce.
// =============================================================================

export async function POST(req: Request): Promise<Response> {
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
  store.set('NEXT_LOCALE', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  return Response.json({ ok: true, locale });
}
