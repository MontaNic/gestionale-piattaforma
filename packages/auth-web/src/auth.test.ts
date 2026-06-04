import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_CHANGE_EVENT,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isAuthenticated,
  setTokens,
} from './auth';

// =============================================================================
// auth.ts — token storage (localStorage) + same-tab sync event
// =============================================================================
// Copre il comportamento estratto in @gestionale/auth-web (ADR-0027 §D5 5b):
// set/get/clear dei token + dispatch dell'evento custom AUTH_CHANGE_EVENT che
// AuthContext usa per re-fetchare /me dopo login/logout nello stesso tab.
// TD-1 (token in localStorage) NON toccato: si testa il comportamento esistente.

describe('auth token storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('setTokens scrive access+refresh e getter li rileggono', () => {
    setTokens('access-1', 'refresh-1');
    expect(getAccessToken()).toBe('access-1');
    expect(getRefreshToken()).toBe('refresh-1');
  });

  it('isAuthenticated riflette la presenza dell access token', () => {
    expect(isAuthenticated()).toBe(false);
    setTokens('access-1', 'refresh-1');
    expect(isAuthenticated()).toBe(true);
  });

  it('clearTokens rimuove entrambi i token', () => {
    setTokens('access-1', 'refresh-1');
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it('getAccessToken/getRefreshToken tornano null senza token', () => {
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('setTokens dispatcha AUTH_CHANGE_EVENT (same-tab sync)', () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_CHANGE_EVENT, listener);
    setTokens('access-1', 'refresh-1');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_CHANGE_EVENT, listener);
  });

  it('clearTokens dispatcha AUTH_CHANGE_EVENT (same-tab sync)', () => {
    setTokens('access-1', 'refresh-1');
    const listener = vi.fn();
    window.addEventListener(AUTH_CHANGE_EVENT, listener);
    clearTokens();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_CHANGE_EVENT, listener);
  });
});
