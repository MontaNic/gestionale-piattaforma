// =============================================================================
// @gestionale/api-client — HTTP client FE condiviso (ADR-0027 §D5 passo 5a)
// =============================================================================
// Infrastruttura trasversale (né auth né dominio): estratta da `apps/restaurant-web/lib/api.ts`
// come passo 5a prima di auth-web (5b), perché consumata sia dall'auth FE sia
// dalle pagine di dominio (menu). Comportamento INVARIATO.
//
// Wrapper minimale di `fetch` con:
//   - `tenantSlug` opzionale → header `X-Tenant-Slug` (pre-auth login/login-pin
//     scope `/auth/login` + `/auth/login-pin`, backend TenantMiddleware D2a)
//   - `accessToken` opzionale → header `Authorization: Bearer <token>` (post-auth)
//   - JSON content-type default per i metodi con body (POST/PATCH)
//   - 204 No Content handling per logout/delete (NestJS @HttpCode)
//   - `ApiError` tipizzato con `status` + `errorCode` (NestJS exception body)
//
// 4 verbi: `apiGet` / `apiPost` / `apiPatch` / `apiDelete`. Tutti delegano a
// `request()` privato — un solo punto per fetch + parsing errori (ADR-0020 S19
// F1 Menu UI: PATCH = verbo update reale dei controller backend; DELETE backend
// risponde 200 `{ data }`, non 204 — `request()` gestisce entrambi).
//
// Pattern `RequestOptions` interface: fields dedicated tipizzati invece di
// raw `Record<string, string>` per evitare typo header name (es. 'X-Tenant-slug'
// con casing sbagliato silenziosamente fallisce backend match).
// =============================================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  /** Tenant slug per header `X-Tenant-Slug` (pre-auth login + login-pin). */
  tenantSlug?: string;
  /** Access token JWT per header `Authorization: Bearer <token>` (post-auth). */
  accessToken?: string;
  /**
   * Hook invocato su `401`: ritorna un access token NUOVO (→ retry singolo della
   * richiesta con quel token) oppure `null` (→ l'errore 401 risale, nessun retry).
   * Inversione di dipendenza (precursor auth-refresh §4.1): `api-client` resta
   * ignaro di COME il token viene rinnovato — il single-flight vive in `auth-web`.
   */
  onUnauthorized?: () => Promise<string | null>;
  /**
   * Se true, un `401` NON tenta il refresh. Impostato (a) sul retry, per garantire
   * un tentativo solo (nessun loop); (b) sulla chiamata a `/auth/refresh` stessa
   * (anti-ricorsione §4.3: il refresh non deve ri-triggerare un refresh).
   */
  skipAuthRetry?: boolean;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Pattern errorCode taxonomy — allineato a `GlobalHttpExceptionFilter` backend. */
const TAXONOMY_CODE = /^E_[A-Z][A-Z0-9_]*$/;

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as {
    errorCode?: string;
    code?: string;
    message?: string | string[];
  };
  // TD-BE resolution: backend taxonomy inconsistente (TD-AY in flux):
  //   - /auth/login (TD-AJ PR 2) emette `errorCode` (preferred)
  //   - /auth/login 429 lockout (TD-H ADR-0013) emette `code: E_AUTH_ACCOUNT_LOCKED`
  //   - ThrottlerException default NestJS emette 429 senza errorCode/code
  // Fallback chain: errorCode → code → sintetico statusCode-based per 429.
  let explicit = body.errorCode ?? body.code;

  // S20 scope-adjacent fix (ADR-0022 §parseError): GlobalHttpExceptionFilter
  // avvolge gli errori di validazione DTO in `errorCode: 'E_VALIDATION'` con il
  // codice specifico in `message: string[]` (un errorCode per campo fallito).
  // Senza unwrap ogni 400 di validazione cadrebbe sul messaggio generico.
  // Difensivo: promuovo `message[0]` solo se è un taxonomy code reale — se fosse
  // una stringa human-readable resta `E_VALIDATION` (→ messaggio i18n dedicato).
  if (explicit === 'E_VALIDATION' && Array.isArray(body.message)) {
    const first = body.message[0];
    if (typeof first === 'string' && TAXONOMY_CODE.test(first)) {
      explicit = first;
    }
  }

  const synthetic = res.status === 429 ? 'E_RATE_LIMITED' : 'E_UNKNOWN';
  const messageText = Array.isArray(body.message)
    ? body.message.join(', ')
    : (body.message ?? `Request failed with status ${res.status}`);
  return new ApiError(res.status, explicit ?? synthetic, messageText);
}

function buildHeaders(opts: RequestOptions, withJsonContent: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (withJsonContent) headers['Content-Type'] = 'application/json';
  if (opts.tenantSlug) headers['X-Tenant-Slug'] = opts.tenantSlug;
  if (opts.accessToken) headers['Authorization'] = `Bearer ${opts.accessToken}`;
  return headers;
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions,
  body?: unknown,
): Promise<T> {
  const hasBody = body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: buildHeaders(options, hasBody),
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    // 401 + hook di refresh disponibile + non già in retry/refresh → un solo
    // tentativo: rinnova il token e ri-esegui la richiesta con quello fresco.
    // `skipAuthRetry: true` sul retry garantisce che un 401 di ritorno risalga
    // come errore (nessun secondo refresh, nessun loop). `res` non è ancora
    // stato letto qui, quindi `parseError(res)` sotto resta valido nel ramo null.
    if (res.status === 401 && options.onUnauthorized && !options.skipAuthRetry) {
      const refreshedToken = await options.onUnauthorized();
      if (refreshedToken !== null) {
        return request<T>(
          method,
          path,
          { ...options, accessToken: refreshedToken, skipAuthRetry: true },
          body,
        );
      }
    }
    throw await parseError(res);
  }
  // 204 No Content: pattern NestJS @HttpCode(NO_CONTENT). Caller dovrebbe usare
  // <void> e non leggere il return value.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// =============================================================================
// Blob / multipart — verbi per download e upload che bypassavano l'interceptor
// =============================================================================
// TD-blob-download-no-refresh: 5 `fetch` raw in accountant-web (3 download blob
// + 2 upload multipart) non passavano dal single-flight refresh di #160 → 401
// silenzioso a token scaduto. `request()` decodifica sempre JSON e serializza il
// body con `JSON.stringify`, quindi non è riusabile per Blob/FormData.
//
// `fetchWithAuthRetry` estrae la SOLA decisione 401→refresh→retry (identica a
// `request()`) ritornando la `Response` grezza — chi chiama decide come leggere
// il body (blob vs json). `request()` NON è rifattorizzato sopra questo core in
// questo fix: la duplicazione è deliberata e tracciata da TD-blob-retry-
// duplication (path critico condiviso di entrambi i verticali, tier ALTO).

/** Opzioni auth per i verbi blob/multipart — sottoinsieme di `RequestOptions`. */
type AuthRetryOptions = Pick<RequestOptions, 'accessToken' | 'onUnauthorized' | 'skipAuthRetry'>;

/** Inietta `Authorization: Bearer` in `init.headers` (merge non distruttivo). */
function withAuthHeader(init: RequestInit, accessToken?: string): RequestInit {
  if (!accessToken) return init;
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${accessToken}`,
    },
  };
}

/**
 * Esegue `fetch` con la stessa logica single-flight 401→refresh→retry di
 * `request()`, ma ritorna la `Response` grezza (nessun `res.json()`, nessuna
 * serializzazione del body). Un solo retry: `skipAuthRetry: true` sul secondo
 * tentativo (anti-loop, identico a `request()`).
 */
async function fetchWithAuthRetry(
  input: string,
  init: RequestInit,
  options: AuthRetryOptions,
): Promise<Response> {
  const res = await fetch(input, withAuthHeader(init, options.accessToken));
  if (res.status === 401 && options.onUnauthorized && !options.skipAuthRetry) {
    const refreshedToken = await options.onUnauthorized();
    if (refreshedToken !== null) {
      return fetchWithAuthRetry(input, init, {
        ...options,
        accessToken: refreshedToken,
        skipAuthRetry: true,
      });
    }
  }
  return res;
}

/**
 * GET → `Blob`. Download autenticati (allegati/documenti): l'endpoint richiede
 * `Authorization: Bearer`, quindi non è un `<a href>` diretto. Il save lato
 * browser (createObjectURL → `<a download>`) resta nel call-site FE.
 */
export async function apiGetBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const res = await fetchWithAuthRetry(`${API_BASE}${path}`, { method: 'GET' }, options);
  if (!res.ok) throw await parseError(res);
  return res.blob();
}

/**
 * POST multipart (`FormData`) → JSON tipizzato. Upload di file: NON si setta
 * `Content-Type` manualmente — il browser lo imposta col `boundary` corretto a
 * partire dalla `FormData`. `request()` non è usabile qui (serializza `body`
 * con `JSON.stringify` e forza `application/json`).
 */
export async function apiPostMultipart<T>(
  path: string,
  formData: FormData,
  options: RequestOptions = {},
): Promise<T> {
  const res = await fetchWithAuthRetry(
    `${API_BASE}${path}`,
    { method: 'POST', body: formData },
    options,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>('GET', path, options);
}

export function apiPost<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('POST', path, options, body);
}

export function apiPatch<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('PATCH', path, options, body);
}

export function apiDelete<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>('DELETE', path, options);
}
