// =============================================================================
// forbidden-slugs.ts — Slug riservati (anti-collision route web/api)
// =============================================================================
// Estratto come modulo dedicato per riusabilita' (vedi pattern FORBIDDEN_PINS
// in auth/utils/pin-validator.ts). Hardcoded — niente fetch da DB/rete.
//
// Razionale ogni voce:
//   api, www, admin, app, public, static       -> conflitti route web/server
//   system                                      -> tenant "system" potrebbe
//                                                  essere confuso con system_*
//                                                  tables del catalog
//   health, auth, me, tenants                  -> path NestJS gia' montati
//
// Decision D4 STEP 1: lista chiusa, no validation case-insensitive necessaria
// (lo slug regex e' gia' [a-z], niente maiuscole arrivano qui).
// =============================================================================

export const FORBIDDEN_SLUGS: readonly string[] = [
  'api',
  'www',
  'admin',
  'system',
  'app',
  'public',
  'static',
  'health',
  'auth',
  'me',
  'tenants',
] as const;
