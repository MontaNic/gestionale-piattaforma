// =============================================================================
// error-codes.ts — Mapping `errorCode` → message italiano UI (TD-AJ PR 2)
// =============================================================================
// Backend `auth.service` emette `errorCode` esplicito nel body 401/4xx (ADR-0016
// TD-AJ resolution). Frontend `parseError()` (api-client) lo legge → questa
// table fornisce il message localizzato italiano per UI (Alert, toast, ecc.).
//
// Skeleton verticale commercialisti (STOP-b2): table potata ai soli codici
// auth/common agnostici (no dominio menu — il verticale aggiungerà i propri
// codici a STOP-c). `messageForErrorCode` è l'unico consumer (login/page.tsx).
//
// Pattern i18n-ready: la table è il punto di estensione per i18next/nestjs-i18n
// (F1+). Fallback su `E_UNKNOWN` se il code non è in table.
// =============================================================================

import { AuthErrorCode, CommonErrorCode } from '@gestionale/shared';
import { ApiError } from '@gestionale/api-client';

const FALLBACK_MESSAGE = 'Si è verificato un errore. Riprova.';

export const ERROR_CODE_MESSAGES: Record<string, string> = {
  // Codici AGNOSTICI: chiavi dalla fonte unica @gestionale/shared (ADR-0027 §D5
  // passo 3). I messaggi IT restano qui (i18n → packages/i18n, passo 4).
  [AuthErrorCode.INVALID_CREDENTIALS]: 'Email o password non corrette',
  [AuthErrorCode.ACCOUNT_LOCKED]:
    'Account temporaneamente bloccato per troppi tentativi falliti. Riprova tra qualche minuto.',
  [AuthErrorCode.TENANT_REQUIRED]: 'Tenant non specificato. Riprova accedendo dal link corretto.',
  [AuthErrorCode.TENANT_MISMATCH]:
    'Accesso non autorizzato a questo tenant. Effettua nuovamente il login.',
  [AuthErrorCode.SESSION_INVALID]: 'Sessione non valida. Effettua nuovamente il login.',
  [CommonErrorCode.RATE_LIMITED]: 'Troppe richieste. Attendi qualche istante e riprova.',

  // Fallback difensivo: `parseError` srotola `E_VALIDATION` → codice specifico
  // quando `message[0]` è un taxonomy code; se non lo è, resta questo messaggio.
  [CommonErrorCode.VALIDATION]: 'I dati inseriti non sono validi. Controlla i campi e riprova.',
  [CommonErrorCode.UNKNOWN]: FALLBACK_MESSAGE,

  // Dominio aziende (STOP-c2 ADR-0032). Solo i codici che emergono a runtime:
  // i validation backstop E_AZIENDA_*_INVALID/_TOO_LONG/_REQUIRED sono prevenuti
  // dalla zod client-side → fallback generico accettato (vedi ADR-0032 §confine).
  E_AZIENDA_NOT_FOUND: 'Cliente non trovato.',
  E_AZIENDA_CODICE_EXISTS: 'Esiste già un cliente con questo codice.',

  // Dominio referenti (STOP-c3b ADR-0034). Solo il codice runtime: i validation
  // backstop E_REFERENTE_*_INVALID/_TOO_LONG/_REQUIRED sono prevenuti dalla zod
  // client-side → fallback generico (vedi ADR-0033 §confine, ereditato).
  E_REFERENTE_NOT_FOUND: 'Referente non trovato.',
};

export function messageForErrorCode(code: string): string {
  // noUncheckedIndexedAccess (tsconfig web strict): Record lookup ritorna
  // `string | undefined` → fallback constant evita doppio coalesce.
  return ERROR_CODE_MESSAGES[code] ?? FALLBACK_MESSAGE;
}

/**
 * Risolve un errore catturato (es. da una chiamata aziende-api) in un messaggio
 * IT. `ApiError` (api-client) → messaggio per il suo `errorCode`; altrimenti
 * fallback generico. Consumer: clienti/page.tsx + AziendaForm.
 */
export function messageForError(err: unknown): string {
  if (err instanceof ApiError) return messageForErrorCode(err.errorCode);
  return FALLBACK_MESSAGE;
}
