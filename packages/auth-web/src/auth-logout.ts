import { apiPost, ApiError } from '@gestionale/api-client';

import { clearTokens, getAccessToken } from './auth';

// =============================================================================
// auth-logout.ts — helper logout shared (pattern TD-6 ADR-0012 resolved)
// =============================================================================
// Pattern: POST /auth/logout PRIMA di clearTokens() per revocare la session
// backend (`is_active = false`). Senza POST la session resta orphan fino allo
// scadere naturale del JWT (15 min).
//
// Garanzia clearTokens(): eseguito SEMPRE (finally), anche se POST fallisce
// per network/401/500. Lo stato client deve restare consistente — un logout
// che lascia token in localStorage e' peggio di una session backend orphan.
//
// 401 specifico: token gia' scaduto → server non puo' revocare, ma client
// procede comunque a clearTokens (idempotente). Stessa decisione di
// ADR-0012 §Decision 1A.
// =============================================================================

export async function performLogout(): Promise<void> {
  const token = getAccessToken();
  try {
    if (token) {
      await apiPost<void>('/auth/logout', {}, { accessToken: token });
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Token gia' invalido/scaduto: server non puo' revocare. Procedi a
      // clearTokens — risultato funzionale identico (sessione gia' non valida).
    } else {
      console.warn(
        '[logout] server-side failed (session may remain orphan until JWT expiry):',
        err,
      );
    }
  } finally {
    clearTokens();
  }
}
