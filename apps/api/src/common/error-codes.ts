// =============================================================================
// error-codes.ts — Enum centralizzato error codes per response API (TD-AJ PR 2)
// =============================================================================
// Pattern (ADR-0016 TD-AJ resolution):
//   - Backend emette `errorCode` esplicito nel body delle HttpException (oltre
//     statusCode + message + timestamp), invece di mettere il code nel `message`.
//   - Frontend `parseError()` (apps/web/src/lib/api.ts) legge `errorCode` →
//     mapping i18n-ready via `ERROR_CODE_MESSAGES` (apps/web/src/lib/error-codes.ts).
//   - Naming convention: prefix `E_` + dominio (`AUTH_`, ...) + descrittore.
//
// Scope PR 2 (DP3.1): solo `/auth/login` (INVALID_CREDENTIALS). Estensione ad
// altri 401 endpoint (auth/refresh, auth/logout, auth/login-pin, auth/pin-setup)
// tracked come TD-AY post-merge.
// =============================================================================

export enum AuthErrorCode {
  INVALID_CREDENTIALS = 'E_AUTH_INVALID_CREDENTIALS',
}

export enum CommonErrorCode {
  UNKNOWN = 'E_UNKNOWN',
}
