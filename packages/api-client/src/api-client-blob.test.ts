import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGetBlob, ApiError, apiPostMultipart } from './index';

// =============================================================================
// Test dei verbi blob/multipart (TD-blob-download-no-refresh). `apiGetBlob` e
// `apiPostMultipart` condividono con `request()` la SOLA decisione 401→refresh→
// retry (via `fetchWithAuthRetry` interno) ma ritornano Blob/JSON senza toccare
// il path critico. Questi test sono security-critical: esercitano il retry, non
// solo l'happy path — un refresh trasparente rotto sarebbe invisibile ai
// consumer FE (errore silenziato con `.catch(() => undefined)`).
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

function blobRes(content: string, status = 200): Response {
  return new Response(new Blob([content], { type: 'application/pdf' }), { status });
}

function initAt(i: number): RequestInit {
  const call = fetchMock.mock.calls[i];
  if (!call) throw new Error(`fetch call ${i} assente`);
  return call[1] as RequestInit;
}

function authHeaderAt(i: number): string | undefined {
  return (initAt(i).headers as Record<string, string> | undefined)?.['Authorization'];
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

describe('apiGetBlob — download con single-flight refresh', () => {
  it('test 1 — 401 → onUnauthorized → retry singolo con token NUOVO → Blob del 2° tentativo', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ errorCode: 'E_AUTH_TOKEN_EXPIRED' }, 401))
      .mockResolvedValueOnce(blobRes('PDF-CONTENT'));
    const onUnauthorized = vi.fn().mockResolvedValue('newtok');

    const blob = await apiGetBlob('/documenti/1/download', {
      accessToken: 'stale',
      onUnauthorized,
    });

    expect(await blob.text()).toBe('PDF-CONTENT');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // il primo tentativo usa il token stale, il retry quello fresco
    expect(authHeaderAt(0)).toBe('Bearer stale');
    expect(authHeaderAt(1)).toBe('Bearer newtok');
  });

  it('test 2 — 401 → onUnauthorized ritorna null (refresh fallito) → nessun retry, errore 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ errorCode: 'E_AUTH_TOKEN_EXPIRED' }, 401));
    const onUnauthorized = vi.fn().mockResolvedValue(null);

    const err = await rejected(
      apiGetBlob('/documenti/1/download', { accessToken: 'stale', onUnauthorized }),
    );

    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('test 3 — retry ancora 401 → l errore risale, nessun loop (fetch max 2 volte)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ errorCode: 'E_AUTH_TOKEN_EXPIRED' }, 401))
      .mockResolvedValueOnce(jsonRes({ errorCode: 'E_AUTH_TOKEN_EXPIRED' }, 401));
    const onUnauthorized = vi.fn().mockResolvedValue('newtok');

    const err = await rejected(
      apiGetBlob('/documenti/1/download', { accessToken: 'stale', onUnauthorized }),
    );

    expect(err.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('test 5 — happy path 200 → ritorna Blob, onUnauthorized mai chiamato', async () => {
    fetchMock.mockResolvedValueOnce(blobRes('OK'));
    const onUnauthorized = vi.fn().mockResolvedValue('newtok');

    const blob = await apiGetBlob('/documenti/1/download', { accessToken: 'good', onUnauthorized });

    expect(await blob.text()).toBe('OK');
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(initAt(0).method).toBe('GET');
  });
});

describe('apiPostMultipart — upload con single-flight refresh', () => {
  it('test 4 — 401 → refresh → retry → JSON; stessa FormData, nessun Content-Type manuale', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ errorCode: 'E_AUTH_TOKEN_EXPIRED' }, 401))
      .mockResolvedValueOnce(jsonRes({ data: { id: 'doc-1' } }));
    const onUnauthorized = vi.fn().mockResolvedValue('newtok');
    const form = new FormData();
    form.append('file', new Blob(['x']), 'f.pdf');

    const out = await apiPostMultipart<{ data: { id: string } }>('/documenti', form, {
      accessToken: 'stale',
      onUnauthorized,
    });

    expect(out).toEqual({ data: { id: 'doc-1' } });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaderAt(1)).toBe('Bearer newtok');
    // il body resta la STESSA FormData su entrambi i tentativi (non ri-serializzata)
    expect(initAt(0).body).toBe(form);
    expect(initAt(1).body).toBe(form);
    // nessun Content-Type forzato: lo imposta il browser col boundary
    const headers0 = initAt(0).headers as Record<string, string> | undefined;
    const headers1 = initAt(1).headers as Record<string, string> | undefined;
    expect(headers0?.['Content-Type']).toBeUndefined();
    expect(headers1?.['Content-Type']).toBeUndefined();
  });

  it('test 6 — happy path 200 → ritorna JSON tipizzato', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ data: { id: 'doc-2' } }));
    const form = new FormData();
    form.append('file', new Blob(['y']), 'g.pdf');

    const out = await apiPostMultipart<{ data: { id: string } }>('/documenti', form, {
      accessToken: 'good',
    });

    expect(out).toEqual({ data: { id: 'doc-2' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(initAt(0).method).toBe('POST');
  });
});
