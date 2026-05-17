// =============================================================================
// api.ts — HTTP client per apps/web (TD-2 ADR-0012 resolution)
// =============================================================================
// Wrapper minimale di `fetch` con:
//   - `tenantSlug` opzionale → header `X-Tenant-Slug` (pre-auth login/login-pin
//     scope `/auth/login` + `/auth/login-pin`, backend TenantMiddleware D2a)
//   - `accessToken` opzionale → header `Authorization: Bearer <token>` (post-auth)
//   - JSON content-type default per POST
//   - 204 No Content handling per logout/delete/update (NestJS @HttpCode)
//   - `ApiError` tipizzato con `status` + `errorCode` (NestJS exception body)
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

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as {
    errorCode?: string;
    code?: string;
    message?: string;
  };
  // TD-BE resolution: backend taxonomy inconsistente (TD-AY in flux):
  //   - /auth/login (TD-AJ PR 2) emette `errorCode` (preferred)
  //   - /auth/login 429 lockout (TD-H ADR-0013) emette `code: E_AUTH_ACCOUNT_LOCKED`
  //   - ThrottlerException default NestJS emette 429 senza errorCode/code
  // Fallback chain: errorCode → code → sintetico statusCode-based per 429.
  const explicit = body.errorCode ?? body.code;
  const synthetic = res.status === 429 ? 'E_RATE_LIMITED' : 'E_UNKNOWN';
  return new ApiError(
    res.status,
    explicit ?? synthetic,
    body.message ?? `Request failed with status ${res.status}`,
  );
}

function buildHeaders(opts: RequestOptions, withJsonContent: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (withJsonContent) headers['Content-Type'] = 'application/json';
  if (opts.tenantSlug) headers['X-Tenant-Slug'] = opts.tenantSlug;
  if (opts.accessToken) headers['Authorization'] = `Bearer ${opts.accessToken}`;
  return headers;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: buildHeaders(options, true),
    body: JSON.stringify(body),
  });

  if (!res.ok) throw await parseError(res);
  // 204 No Content: pattern NestJS @HttpCode(NO_CONTENT) per logout/delete/update.
  // Caller dovrebbe usare apiPost<void>(...) e non leggere il return value.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: buildHeaders(options, false),
  });

  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}
