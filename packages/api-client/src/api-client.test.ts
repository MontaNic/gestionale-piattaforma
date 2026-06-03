import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiDelete, ApiError, apiGet, apiPost } from './index';

// =============================================================================
// Test del client HTTP condiviso (ADR-0027 §D5 passo 5a). Mocka `fetch` globale
// e verifica: header (tenant/bearer/content-type), 204 No Content, e la catena
// di fallback di `parseError` (errorCode → code → sintetico → unwrap E_VALIDATION).
// =============================================================================

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function lastInit(): { method: string; headers: Record<string, string>; body?: string } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch non chiamato');
  return call[1] as { method: string; headers: Record<string, string>; body?: string };
}

async function rejected(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(
    () => {
      throw new Error('atteso reject');
    },
    (e: unknown) => e,
  );
  if (!(err instanceof ApiError)) throw new Error('atteso ApiError');
  return err;
}

describe('api-client — successo + header', () => {
  it('apiGet parsa il JSON e chiama path + metodo GET', async () => {
    fetchMock.mockResolvedValue(jsonRes({ data: 42 }));
    const out = await apiGet<{ data: number }>('/me');
    expect(out).toEqual({ data: 42 });
    const call = fetchMock.mock.calls.at(-1);
    expect(String(call?.[0])).toContain('/me');
    expect(lastInit().method).toBe('GET');
  });

  it('header: tenantSlug → X-Tenant-Slug, accessToken → Bearer, nessun Content-Type senza body', async () => {
    fetchMock.mockResolvedValue(jsonRes({ ok: true }));
    await apiGet('/x', { tenantSlug: 'demo', accessToken: 'tok' });
    const { headers } = lastInit();
    expect(headers['X-Tenant-Slug']).toBe('demo');
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('apiPost invia body JSON + Content-Type', async () => {
    fetchMock.mockResolvedValue(jsonRes({ data: { accessToken: 'a' } }));
    await apiPost('/auth/login', { email: 'x' }, { tenantSlug: 'demo' });
    const init = lastInit();
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ email: 'x' }));
  });

  it('204 No Content → undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const out = await apiDelete('/x', { accessToken: 't' });
    expect(out).toBeUndefined();
  });
});

describe('api-client — taxonomy ApiError', () => {
  it('preferisce errorCode esplicito', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ errorCode: 'E_AUTH_INVALID_CREDENTIALS', message: 'bad' }, 401),
    );
    const err = await rejected(apiGet('/x'));
    expect(err.status).toBe(401);
    expect(err.errorCode).toBe('E_AUTH_INVALID_CREDENTIALS');
  });

  it('fallback su `code` quando errorCode assente (lockout)', async () => {
    fetchMock.mockResolvedValue(jsonRes({ code: 'E_AUTH_ACCOUNT_LOCKED' }, 429));
    const err = await rejected(apiGet('/x'));
    expect(err.errorCode).toBe('E_AUTH_ACCOUNT_LOCKED');
  });

  it('429 senza codice → sintetico E_RATE_LIMITED', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, 429));
    const err = await rejected(apiGet('/x'));
    expect(err.errorCode).toBe('E_RATE_LIMITED');
  });

  it('errore generico senza codice → E_UNKNOWN + message passthrough', async () => {
    fetchMock.mockResolvedValue(jsonRes({ message: 'boom' }, 500));
    const err = await rejected(apiGet('/x'));
    expect(err.errorCode).toBe('E_UNKNOWN');
    expect(err.message).toBe('boom');
  });

  it('E_VALIDATION con message[] promuove il primo taxonomy code', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ errorCode: 'E_VALIDATION', message: ['E_AUTH_PIN_INVALID', 'altro'] }, 400),
    );
    const err = await rejected(apiGet('/x'));
    expect(err.errorCode).toBe('E_AUTH_PIN_INVALID');
    expect(err.message).toBe('E_AUTH_PIN_INVALID, altro');
  });

  it('E_VALIDATION con message[] non-taxonomy resta E_VALIDATION', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ errorCode: 'E_VALIDATION', message: ['Email non valida'] }, 400),
    );
    const err = await rejected(apiGet('/x'));
    expect(err.errorCode).toBe('E_VALIDATION');
  });
});
