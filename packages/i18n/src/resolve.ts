import type { AbstractIntlMessages } from 'next-intl';

import { defaultLocale, isValidLocale, type Locale } from './config';

// =============================================================================
// resolve.ts — cuore puro del meccanismo i18n (switch locale + fallback)
// =============================================================================
// Nessuna dipendenza runtime da Next: questo modulo è unit-testabile in node
// (`import type` da next-intl è cancellato a build time). `request.ts` lo wira
// con next/headers + next-intl/server; qui vive solo la logica deterministica.
// =============================================================================

/** Loader dei messaggi iniettato dall'app — il package è agnostico al contenuto. */
export type LoadMessages = (locale: Locale) => Promise<AbstractIntlMessages>;

/**
 * Risoluzione locale: valore grezzo del cookie `NEXT_LOCALE` → `Locale`.
 * Fallback a `defaultLocale` se assente o non valido (difesa in profondità:
 * il client può settare un valore arbitrario via `document.cookie`).
 */
export function resolveLocale(raw: string | undefined): Locale {
  return isValidLocale(raw) ? raw : defaultLocale;
}

/**
 * Core testabile della request config: dato il cookie grezzo e un loader,
 * produce `{ locale, messages }` per next-intl. Lo switch (it↔en) e il
 * fallback passano interamente da qui, senza toccare next/headers.
 */
export async function buildI18nRequestConfig(
  raw: string | undefined,
  loadMessages: LoadMessages,
): Promise<{ locale: Locale; messages: AbstractIntlMessages }> {
  const locale = resolveLocale(raw);
  return { locale, messages: await loadMessages(locale) };
}
