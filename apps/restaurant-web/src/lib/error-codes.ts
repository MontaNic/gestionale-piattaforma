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
//
// Sessione 14 (TD-BE F1-shell PR): +2 mapping (E_AUTH_ACCOUNT_LOCKED dal TD-H
// 429 lockout, E_RATE_LIMITED sintetico fallback ThrottlerException default
// senza errorCode). Pattern empirico: backend lockout body usa `code:` invece
// di `errorCode:` (taxonomy inconsistenza TD-AY) — `parseError` (lib/api.ts)
// legge entrambi i campi + sintetizza E_RATE_LIMITED su statusCode 429 senza
// errorCode. Ack: questo mapping diventa subsumed in TD-AY closure sessione 15.
// =============================================================================

import { AuthErrorCode, CommonErrorCode } from '@gestionale/shared';

import { ApiError } from '@gestionale/api-client';

const FALLBACK_MESSAGE = 'Si è verificato un errore. Riprova.';
const CONNECTION_MESSAGE = 'Errore di connessione al server';

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

  // F1 Menu CRUD (sessione 17 ADR-0019)
  E_MENU_NOT_FOUND: 'Menu non trovato.',
  E_MENU_NAME_INVALID: 'Nome menu non valido.',
  E_MENU_NAME_TOO_SHORT: 'Il nome del menu deve avere almeno 2 caratteri.',
  E_MENU_NAME_TOO_LONG: 'Il nome del menu non può superare 100 caratteri.',
  E_MENU_NAME_EXISTS: 'Esiste già un menu con questo nome.',
  E_MENU_DESCRIPTION_INVALID: 'Descrizione menu non valida.',
  E_MENU_DESCRIPTION_TOO_LONG: 'La descrizione del menu non può superare 500 caratteri.',
  E_MENU_IS_ACTIVE_INVALID: 'Valore attivazione menu non valido.',
  E_MENU_SORT_ORDER_INVALID: 'Ordine di visualizzazione del menu non valido.',

  E_MENU_CATEGORY_NOT_FOUND: 'Categoria menu non trovata.',
  E_MENU_CATEGORY_NAME_INVALID: 'Nome categoria non valido.',
  E_MENU_CATEGORY_NAME_TOO_SHORT: 'Il nome della categoria deve avere almeno 2 caratteri.',
  E_MENU_CATEGORY_NAME_TOO_LONG: 'Il nome della categoria non può superare 100 caratteri.',
  E_MENU_CATEGORY_NAME_EXISTS: 'Esiste già una categoria con questo nome in questo menu.',
  E_MENU_CATEGORY_SORT_ORDER_INVALID: 'Ordine di visualizzazione della categoria non valido.',

  E_ARTICLE_NOT_FOUND: 'Articolo non trovato.',
  E_ARTICLE_CATEGORY_ID_INVALID: 'Categoria articolo non valida.',
  E_ARTICLE_NAME_INVALID: 'Nome articolo non valido.',
  E_ARTICLE_NAME_TOO_SHORT: "Il nome dell'articolo deve avere almeno 2 caratteri.",
  E_ARTICLE_NAME_TOO_LONG: "Il nome dell'articolo non può superare 120 caratteri.",
  E_ARTICLE_NAME_EXISTS: 'Esiste già un articolo con questo nome in questa categoria.',
  E_ARTICLE_DESCRIPTION_SHORT_INVALID: 'Descrizione breve non valida.',
  E_ARTICLE_DESCRIPTION_SHORT_REQUIRED: 'La descrizione breve è obbligatoria.',
  E_ARTICLE_DESCRIPTION_SHORT_TOO_LONG: 'La descrizione breve non può superare 200 caratteri.',
  E_ARTICLE_DESCRIPTION_LONG_INVALID: 'Descrizione estesa non valida.',
  E_ARTICLE_DESCRIPTION_LONG_TOO_LONG: 'La descrizione estesa non può superare 2000 caratteri.',
  E_ARTICLE_PHOTO_URL_INVALID: 'URL foto non valido.',
  E_ARTICLE_PHOTO_URL_TOO_LONG: "L'URL della foto non può superare 500 caratteri.",
  E_ARTICLE_BASE_PRICE_INVALID:
    'Prezzo base non valido (formato: importo positivo, max 2 decimali).',
  E_ARTICLE_VAT_INVALID: "L'aliquota IVA deve essere 4, 10 o 22.",
  E_ARTICLE_ALLERGENS_INVALID: 'Lista allergeni non valida.',
  E_ARTICLE_DIETARY_TAGS_INVALID: 'Tag dietetici non validi.',
  E_ARTICLE_PRINT_DEPARTMENT_INVALID: 'Reparto di stampa non valido.',
  E_ARTICLE_PREP_TIME_INVALID: 'Tempo di preparazione non valido.',
  E_ARTICLE_AVAILABILITY_INVALID: 'Stato disponibilità articolo non valido.',
  E_ARTICLE_SORT_ORDER_INVALID: "Ordine di visualizzazione dell'articolo non valido.",
  E_ARTICLE_CHANNEL_VISIBILITY_INVALID: 'Visibilità per canale non valida.',

  E_ARTICLE_PRICE_NOT_FOUND: 'Prezzo articolo non trovato.',
  E_ARTICLE_PRICE_INVALID: 'Prezzo non valido (importo positivo, max 2 decimali).',
  E_ARTICLE_PRICE_LIST_ID_INVALID: 'Listino di riferimento non valido.',
  E_ARTICLE_PRICE_EMPTY_PATCH: 'Nessun campo da aggiornare.',

  E_PRICE_LIST_NOT_FOUND: 'Listino non trovato.',
  E_PRICE_LIST_NAME_INVALID: 'Nome listino non valido.',
  E_PRICE_LIST_NAME_TOO_SHORT: 'Il nome del listino deve avere almeno 2 caratteri.',
  E_PRICE_LIST_NAME_TOO_LONG: 'Il nome del listino non può superare 100 caratteri.',
  E_PRICE_LIST_NAME_EXISTS: 'Esiste già un listino con questo nome.',
  E_PRICE_LIST_CHANNELS_INVALID: 'Canali listino non validi.',
  E_PRICE_LIST_CHANNELS_REQUIRED: 'Specificare almeno un canale per il listino.',
  E_PRICE_LIST_VALID_FROM_INVALID: 'Data inizio validità listino non valida.',
  E_PRICE_LIST_VALID_TO_INVALID: 'Data fine validità listino non valida.',
  E_PRICE_LIST_PRIORITY_INVALID: 'Priorità listino non valida.',
  E_PRICE_LIST_IS_ACTIVE_INVALID: 'Stato attivazione listino non valido.',

  // Fallback difensivo: `parseError` srotola `E_VALIDATION` → codice specifico
  // quando `message[0]` è un taxonomy code; se non lo è, resta questo messaggio.
  [CommonErrorCode.VALIDATION]: 'I dati inseriti non sono validi. Controlla i campi e riprova.',
  [CommonErrorCode.UNKNOWN]: FALLBACK_MESSAGE,
};

export function messageForErrorCode(code: string): string {
  // noUncheckedIndexedAccess (tsconfig web strict): Record lookup ritorna
  // `string | undefined` → fallback constant evita doppio coalesce.
  return ERROR_CODE_MESSAGES[code] ?? FALLBACK_MESSAGE;
}

/**
 * Risolve un errore generico `unknown` (catch block) in un messaggio IT per UI.
 * `ApiError` → mapping `errorCode`; qualunque altro errore (network, parse) →
 * messaggio connessione. Pattern estratto da `login/page.tsx` (S19 ADR-0020).
 */
export function messageForError(err: unknown): string {
  if (err instanceof ApiError) {
    return messageForErrorCode(err.errorCode);
  }
  return CONNECTION_MESSAGE;
}
