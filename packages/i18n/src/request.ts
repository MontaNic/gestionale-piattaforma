import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { LOCALE_COOKIE } from './config';
import { buildI18nRequestConfig, type LoadMessages } from './resolve';

// =============================================================================
// request.ts — factory next-intl request config (Next.js 15 App Router)
// =============================================================================
// Pattern doc ufficiale next-intl "without i18n routing":
//   https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing
//
// Il package fornisce l'infrastruttura; l'app inietta i propri messaggi via
// `loadMessages` (meccanismo agnostico al contenuto — ADR-0027 §D5 passo 4).
// Locale resolution: cookie `NEXT_LOCALE`, fallback `defaultLocale` (vedi
// `resolve.ts`). Next.js 15: `cookies()` è async → `await` obbligatorio.
// =============================================================================

export { resolveLocale, buildI18nRequestConfig, type LoadMessages } from './resolve';
export { LOCALE_COOKIE } from './config';

/**
 * Crea il default export atteso da `createNextIntlPlugin`. L'app passa il
 * proprio loader di messaggi (es. `(l) => import('./messages/' + l + '.json')`).
 */
export function createI18nRequestConfig(loadMessages: LoadMessages) {
  return getRequestConfig(async () => {
    const store = await cookies();
    return buildI18nRequestConfig(store.get(LOCALE_COOKIE)?.value, loadMessages);
  });
}
