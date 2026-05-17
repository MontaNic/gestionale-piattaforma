import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { defaultLocale, isValidLocale } from './config';

// =============================================================================
// i18n/request.ts — next-intl request config (Next.js 15 App Router)
// =============================================================================
// Pattern doc ufficiale next-intl "without i18n routing":
//   https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing
//
// Locale resolution: cookie `NEXT_LOCALE` (convention Next.js storica),
// fallback `defaultLocale` se assente o non valido. Validation runtime per
// difesa in profondità — middleware esegue reset cookie ma client può
// settare valore arbitrario via `document.cookie` se non httpOnly.
//
// Next.js 15: `cookies()` API async, `await` obbligatorio.
// =============================================================================

export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get('NEXT_LOCALE')?.value;
  const locale = isValidLocale(raw) ? raw : defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
