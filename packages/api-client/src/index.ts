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

  if (!res.ok) throw await parseError(res);
  // 204 No Content: pattern NestJS @HttpCode(NO_CONTENT). Caller dovrebbe usare
  // <void> e non leggere il return value.
  if (res.status === 204) return undefined as T;
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
