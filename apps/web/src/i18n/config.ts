// =============================================================================
// i18n/config.ts — next-intl locales config (no routing, cookie-based)
// =============================================================================
// Pattern ADR-0018 Sub-DP-A: localePrefix 'never' (cookie NEXT_LOCALE reader).
// Lista locales single source of truth — middleware reuse per validation
// e i18n/request.ts per fallback.
// =============================================================================

export const locales = ['it', 'en'] as const;
export const defaultLocale = 'it' as const;
export type Locale = (typeof locales)[number];

export function isValidLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value);
}
