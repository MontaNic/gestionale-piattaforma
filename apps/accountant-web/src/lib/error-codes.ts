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

  // Dominio preventivi (STOP-e2 ADR-0037). Solo i codici runtime: i validation
  // backstop E_PREVENTIVO_*_INVALID/_TOO_LONG/_REQUIRED sono prevenuti dalla zod
  // client-side → fallback generico (vedi ADR-0036 §confine, ereditato).
  E_PREVENTIVO_NOT_FOUND: 'Preventivo non trovato.',
  E_PREVENTIVO_CODICE_EXISTS: 'Esiste già un preventivo con questo codice.',

  // Dominio scadenze (STOP-scad2 ADR-0040). Codici runtime: not-found + le FK
  // business (azienda/categoria non accessibili) emerse dal service (ADR-0039).
  // I validation backstop E_SCADENZA_*_INVALID/_REQUIRED/_TOO_LONG sono prevenuti
  // dalla zod client-side → fallback generico (vedi ADR-0039 §confine, ereditato).
  E_SCADENZA_NOT_FOUND: 'Scadenza non trovata.',
  E_SCADENZA_AZIENDA_NOT_FOUND: 'Azienda non trovata o non accessibile.',
  E_SCADENZA_CATEGORIA_NOT_FOUND: 'Categoria non trovata o non accessibile.',
  // Conflitto runtime (uniqueness per-tenant): non preventibile dalla zod client.
  E_SCADENZA_CATEGORIA_NOME_EXISTS: 'Esiste già una categoria con questo nome.',

  // Dominio comunicazioni (ADR-0043). Codici runtime: not-found, FK business,
  // regole thread (chiusa, lato cliente) e allegati. I validation backstop
  // E_COM_*_INVALID/_REQUIRED/_TOO_LONG sono prevenuti client-side → fallback.
  E_COM_NOT_FOUND: 'Comunicazione non trovata.',
  E_COM_AZIENDA_NOT_FOUND: 'Cliente non trovato o non accessibile.',
  E_COM_REFERENTE_NOT_FOUND: 'Referente non trovato per questo cliente.',
  E_COM_OPERATORE_NOT_FOUND: 'Operatore non trovato.',
  E_COM_CHIUSA_NO_REPLY: 'La comunicazione è chiusa: riaprila per rispondere.',
  E_COM_MSG_NOT_FOUND: 'Messaggio non trovato.',
  E_COM_MSG_LATO_CLIENTE_FORBIDDEN: 'Non puoi inviare messaggi come cliente.',
  E_COM_ALLEGATO_NOT_FOUND: 'Allegato non trovato.',
  E_COM_ALLEGATO_FILE_REQUIRED: 'Nessun file selezionato.',
  E_ALLEGATO_TOO_LARGE: 'File troppo grande (max 20MB).',

  // Portale cliente comunicazioni (ADR-0047). Guard fail-closed se un principal
  // non-cliente raggiunge /portale/comunicazioni (di norma già bloccato dalla
  // PermissionsGuard, questo è il messaggio di cortesia).
  E_PORTALE_COMUNICAZIONI_FORBIDDEN: 'Accesso riservato agli utenti del portale.',

  // Dominio documenti (ADR-0044). Codici runtime: not-found, FK business, tipo
  // duplicato, file mancante. I validation backstop E_DOCUMENTO_*_INVALID/
  // _REQUIRED/_TOO_LONG sono prevenuti client-side → fallback generico.
  E_DOCUMENTO_NOT_FOUND: 'Documento non trovato.',
  E_DOCUMENTO_AZIENDA_NOT_FOUND: 'Cliente non trovato o non accessibile.',
  E_DOCUMENTO_TIPO_NOT_FOUND: 'Tipo documento non trovato o non accessibile.',
  E_DOCUMENTO_TIPO_NOME_EXISTS: 'Esiste già un tipo documento con questo nome.',
  E_DOCUMENTO_FILE_REQUIRED: 'Nessun file selezionato.',

  // Dominio circolari (ADR-0045 studio + ADR-0048 portale cliente). Codici
  // runtime rilevanti al cliente: not-found, conferma non richiesta, guard
  // fail-closed se un principal non-cliente raggiunge /portale/circolari.
  E_CIRCOLARE_NOT_FOUND: 'Circolare non trovata.',
  E_CIRCOLARE_NO_CONFERMA: 'Questa circolare non richiede conferma di lettura.',
  E_PORTALE_CIRCOLARI_FORBIDDEN: 'Accesso riservato agli utenti del portale.',
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
  // Errori non-ApiError che espongono comunque un `errorCode` string (es. upload
  // allegati via fetch raw in comunicazioni-api, fuori dal wrapper api-client).
  if (
    typeof err === 'object' &&
    err !== null &&
    'errorCode' in err &&
    typeof (err as { errorCode: unknown }).errorCode === 'string'
  ) {
    return messageForErrorCode((err as { errorCode: string }).errorCode);
  }
  return FALLBACK_MESSAGE;
}
