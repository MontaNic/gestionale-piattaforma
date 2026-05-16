// =============================================================================
// auth-error-response.dto.ts — Shape response errori auth (TD-AJ PR 2)
// =============================================================================
// Type-only DTO: documenta il contract response 401 di `/auth/login` per
// consumer client (frontend `parseError` legge questa shape). NON usato come
// validation DTO (ValidationPipe lavora solo su request input).
//
// Coerenza con altre 401 NestJS default (`error: 'Unauthorized'`) NON garantita:
// scope PR 2 (DP3.1) = solo `/auth/login`. Altri 401 endpoint usano ancora il
// default NestJS shape → TD-AY tracerà uniformazione.
// =============================================================================

export interface AuthErrorResponse {
  /** HTTP status code (e.g. 401). Speculare a `HttpException.getStatus()`. */
  statusCode: number;
  /** Code machine-readable per i18n mapping client. Prefix `E_<DOMAIN>_<DESC>`. */
  errorCode: string;
  /** Message human-readable italiano (UI fallback se i18n table miss). */
  message: string;
  /** ISO 8601 timestamp emissione errore (debug + audit correlation client/server). */
  timestamp: string;
}
