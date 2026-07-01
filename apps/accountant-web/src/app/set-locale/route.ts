// =============================================================================
// /set-locale — POST cookie NEXT_LOCALE (ADR-0018 Sub-DP-A)
// =============================================================================
// Route di MECCANISMO (non pagina): setta il cookie NEXT_LOCALE. Vive fuori da
// `/api/*` DI PROPOSITO — quel namespace è riservato al backend NestJS same-origin
// (Caddy `handle /api/*` → api). Una route Next sotto `/api/*` verrebbe ingoiata
// dal proxy in prod (bug cambio lingua: 404 dal backend). L'handler è nel core
// condiviso `@gestionale/i18n` (ADR-0027 §D5 passo 4).
// =============================================================================

export { handleSetLocale as POST } from '@gestionale/i18n/route';
