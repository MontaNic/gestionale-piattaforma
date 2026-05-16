// =============================================================================
// error-codes.ts — Mapping `errorCode` → message italiano UI (TD-AJ PR 2)
// =============================================================================
// Backend `auth.service` emette `errorCode` esplicito nel body 401/4xx (ADR-0016
// TD-AJ resolution). Frontend `parseError()` (lib/api.ts) lo legge → questa
// table fornisce il message localizzato italiano per UI (Alert, toast, ecc.).
//
// Pattern i18n-ready: la table è il punto di estensione per i18next/nestjs-i18n
// (F1+). Fallback su `E_UNKNOWN` se il code non è in table (es: backend nuovo,
// frontend non ancora deployed con il code).
//
// Scope PR 2 (DP3.1): solo `E_AUTH_INVALID_CREDENTIALS`. Estensione altri code
// → man-mano TD-AY closure.
// =============================================================================

const FALLBACK_MESSAGE = 'Si è verificato un errore. Riprova.';

export const ERROR_CODE_MESSAGES: Record<string, string> = {
  E_AUTH_INVALID_CREDENTIALS: 'Email o password non corrette',
  E_UNKNOWN: FALLBACK_MESSAGE,
};

export function messageForErrorCode(code: string): string {
  // noUncheckedIndexedAccess (tsconfig web strict): Record lookup ritorna
  // `string | undefined` → fallback constant evita doppio coalesce.
  return ERROR_CODE_MESSAGES[code] ?? FALLBACK_MESSAGE;
}
