import { beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// auth-refresh.test.ts — unit del single-flight refresh (precursor auth-refresh)
// =============================================================================
// Copre i test 2/4/5/6/8 della spec (i test 1/7/9 + skipAuthRetry vivono in
// api-client; il test 3 — effetto lato BE, no theft — è E2E testcontainers).
// Mocka `@gestionale/api-client` (apiPost) e `./auth` (storage token): nessun
// localStorage reale, il focus è la logica di coalescing/rotazione/failure.
// =============================================================================

vi.mock('@gestionale/api-client', () => ({ apiPost: vi.fn() }));
vi.mock('./auth', () => ({
  getAccessToken: vi.fn(),
  getRefreshToken: vi.fn(),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
}));

import { apiPost } from '@gestionale/api-client';

import { clearTokens, getRefreshToken, setTokens } from './auth';
import { refreshAccessToken } from './auth-refresh';

const apiPostMock = vi.mocked(apiPost);
const getRefreshTokenMock = vi.mocked(getRefreshToken);
const setTokensMock = vi.mocked(setTokens);
const clearTokensMock = vi.mocked(clearTokens);

const refreshOk = {
  data: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 },
};

beforeEach(() => {
  vi.clearAllMocks();
  getRefreshTokenMock.mockReturnValue('refresh-token-valido');
});

describe('refreshAccessToken — single-flight', () => {
  it('test 2 — N richieste parallele → UNA sola /auth/refresh (coalescing)', async () => {
    let resolveRefresh!: (v: unknown) => void;
    apiPostMock.mockReturnValue(
      new Promise((r) => {
        resolveRefresh = r;
      }),
    );
    // 5 chiamate concorrenti PRIMA che il refresh risolva → coalescing
    const pending = Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);
    resolveRefresh(refreshOk);
    const results = await pending;
    expect(apiPostMock).toHaveBeenCalledTimes(1); // una sola in volo
    expect(results).toEqual(['new-access', 'new-access', 'new-access', 'new-access', 'new-access']);
  });

  it('test 5 — /auth/refresh chiamata con skipAuthRetry (anti-ricorsione)', async () => {
    apiPostMock.mockResolvedValue(refreshOk);
    await refreshAccessToken();
    expect(apiPostMock).toHaveBeenCalledWith(
      '/auth/refresh',
      { refreshToken: 'refresh-token-valido' },
      { skipAuthRetry: true },
    );
  });

  it('test 6 — refresh riuscito → ENTRAMBI i token salvati (refresh ruotato)', async () => {
    apiPostMock.mockResolvedValue(refreshOk);
    const token = await refreshAccessToken();
    expect(token).toBe('new-access');
    expect(setTokensMock).toHaveBeenCalledWith('new-access', 'new-refresh');
  });

  it('test 4 — /auth/refresh fallisce → clearTokens + null, nessun setTokens', async () => {
    apiPostMock.mockRejectedValue(new Error('401'));
    const token = await refreshAccessToken();
    expect(token).toBeNull();
    expect(clearTokensMock).toHaveBeenCalledTimes(1);
    expect(setTokensMock).not.toHaveBeenCalled();
  });

  it('nessun refresh token in storage → null immediato, nessuna /auth/refresh', async () => {
    getRefreshTokenMock.mockReturnValue(null);
    const token = await refreshAccessToken();
    expect(token).toBeNull();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('test 8 — refreshInFlight azzerato dopo un refresh FALLITO (promise non appesa)', async () => {
    apiPostMock.mockRejectedValueOnce(new Error('401')); // primo burst → fallisce
    const first = await refreshAccessToken();
    expect(first).toBeNull();
    // secondo burst: deve ri-tentare (nuova apiPost), non riusare il fallimento appeso
    apiPostMock.mockResolvedValueOnce(refreshOk);
    const second = await refreshAccessToken();
    expect(second).toBe('new-access');
    expect(apiPostMock).toHaveBeenCalledTimes(2); // due burst distinti → due chiamate
  });
});
