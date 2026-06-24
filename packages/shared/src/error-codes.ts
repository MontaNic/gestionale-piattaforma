// =============================================================================
// error-codes.ts — Tassonomia error-code AGNOSTICA, fonte unica (ADR-0027 §D5 p.3)
// =============================================================================
// Pattern (ADR-0016 TD-AJ resolution):
//   - Il backend emette `errorCode` esplicito nel body delle HttpException
//     (oltre a statusCode + message + timestamp).
//   - Il frontend `parseError()` (apps/restaurant-web/src/lib/api.ts) legge `errorCode` →
//     messaggio i18n-ready via `ERROR_CODE_MESSAGES` (apps/restaurant-web/src/lib/error-codes.ts).
//   - Naming convention: prefix `E_` + dominio (`AUTH_`, ...) + descrittore.
//
// SCOPE di questo file (passo 3): SOLO i codici **agnostici** (auth/common,
// cross-cutting di piattaforma). I codici di **dominio** ristorazione
// (E_MENU_*/E_ARTICLE_*/E_PRICE_LIST_*) NON sono core e restano nel verticale
// (emessi da apps/restaurant-api domain services, mappati a messaggi in apps/restaurant-web). I
// messaggi italiani sono contenuto i18n → andranno in packages/i18n (passo 4).
//
// Prima del passo 3 questi codici erano duplicati/divergenti: il BE li emetteva
// come string literal sparse (es. 'E_AUTH_SESSION_INVALID' in ~10 controller) +
// un enum a 2 voci; il FE li aveva come chiavi di un catalogo messaggi. Qui
// diventano la fonte unica importata da entrambi i lati.
// =============================================================================

export enum AuthErrorCode {
  INVALID_CREDENTIALS = 'E_AUTH_INVALID_CREDENTIALS',
  ACCOUNT_LOCKED = 'E_AUTH_ACCOUNT_LOCKED',
  TENANT_REQUIRED = 'E_AUTH_TENANT_REQUIRED',
  TENANT_MISMATCH = 'E_AUTH_TENANT_MISMATCH',
  SESSION_INVALID = 'E_AUTH_SESSION_INVALID',
  // Reset password (forgot/reset flow). RESET_TOKEN_INVALID copre token
  // inesistente, malformato e già usato (no oracle sullo stato del token);
  // RESET_TOKEN_EXPIRED è distinto solo per UX ("link scaduto, richiedine
  // uno nuovo"). PASSWORD_TOO_SHORT è validazione applicativa server-side
  // (difesa anche dove la ValidationPipe non gira — vedi test-app E2E).
  RESET_TOKEN_INVALID = 'E_AUTH_RESET_TOKEN_INVALID',
  RESET_TOKEN_EXPIRED = 'E_AUTH_RESET_TOKEN_EXPIRED',
  PASSWORD_TOO_SHORT = 'E_AUTH_PASSWORD_TOO_SHORT',
}

export enum CommonErrorCode {
  RATE_LIMITED = 'E_RATE_LIMITED',
  VALIDATION = 'E_VALIDATION',
  UNKNOWN = 'E_UNKNOWN',
}

/**
 * Set canonico dei codici agnostici di piattaforma. Usato dal test di parità e
 * come guard anti-deriva FE/BE: ogni codice agnostico emesso dal BE e ogni
 * chiave agnostica del catalogo messaggi FE deve appartenere a questo set.
 */
export const PLATFORM_ERROR_CODES = [
  ...Object.values(AuthErrorCode),
  ...Object.values(CommonErrorCode),
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];
