// =============================================================================
// config.ts — configurazione locale del meccanismo i18n (ADR-0027 §D5 passo 4)
// =============================================================================
// Pattern ADR-0018 Sub-DP-A: localePrefix 'never' (cookie NEXT_LOCALE reader).
// Lista locales single source of truth — riusata da `middleware` (guard),
// `resolve` (fallback) e `set-locale` (validation).
//
// Le locale supportate vivono nel core condiviso (la piattaforma supporta it/en):
// i *messaggi* restano per-app (contenuto del verticale), il meccanismo no.
// =============================================================================

export const locales = ['it', 'en'] as const;
export const defaultLocale = 'it' as const;
export type Locale = (typeof locales)[number];

export function isValidLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value);
}

// Cookie convention storica Next.js. Condiviso da request/set-locale/middleware
// per evitare divergenze (nome + durata 1 anno).
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
