// =============================================================================
// /api/set-locale — POST cookie NEXT_LOCALE (ADR-0018 Sub-DP-A)
// =============================================================================
// L'handler vive nel meccanismo condiviso `@gestionale/i18n` (ADR-0027 §D5
// passo 4): qui lo si monta come route handler App Router.
// =============================================================================

export { handleSetLocale as POST } from '@gestionale/i18n/route';
