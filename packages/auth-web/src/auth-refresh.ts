// =============================================================================
// auth-refresh.ts — single-flight refresh access token + helper authOptions
// =============================================================================
// Precursor auth-refresh (§4.4/§4.5). Collega il `/auth/refresh` del BE — già
// completo (rotazione del refresh token a ogni chiamata + theft-detection sul
// reuse) — che il FE non consumava mai. Non costruisce sicurezza: collega quella
// che esiste.
//
// SINGLE-FLIGHT = requisito HARD, non ottimizzazione. Con rotazione + theft-
// detection, N richieste parallele in 401 con un refresh naive: la prima ruota
// il token, la 2ª..N-esima presentano un token GIÀ ruotato → il BE lo legge come
// furto → revoca TUTTE le sessioni + email di alert + audit `auth.theft_detected`.
// Quindi una sola `/auth/refresh` può essere in volo: le altre attendono e
// riusano il risultato.
// =============================================================================

import { apiPost, type RequestOptions } from '@gestionale/api-client';

import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './auth';

interface RefreshResponse {
  data: { accessToken: string; refreshToken: string; expiresIn: number };
}

// Promise a livello di MODULO (non stato React: le richieste HTTP non vivono nel
// render tree). Reset in `finally` — un refresh fallito NON deve lasciare la
// promise appesa, altrimenti ogni chiamata successiva riuserebbe il fallimento.
let refreshInFlight: Promise<string | null> | null = null;

async function eseguiRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    // `skipAuthRetry`: anti-ricorsione (§4.3) — un 401 sul refresh stesso NON
    // deve ri-triggerare un refresh (si avviterebbe).
    const res = await apiPost<RefreshResponse>(
      '/auth/refresh',
      { refreshToken },
      { skipAuthRetry: true },
    );
    // Salvare ENTRAMBI: il BE ruota il refresh token, il vecchio è morto. Salvare
    // solo l'access lascerebbe in localStorage un refresh già ruotato → prossimo
    // refresh → theft-detection.
    setTokens(res.data.accessToken, res.data.refreshToken);
    return res.data.accessToken;
  } catch {
    // Refresh fallito (refresh token scaduto/revocato): logout pulito. clearTokens
    // dispatcha AUTH_CHANGE_EVENT → AuthContext resetta lo stato e AuthGate redirige.
    clearTokens();
    return null;
  }
}

/**
 * Rinnova l'access token in single-flight: una sola `/auth/refresh` in volo, le
 * chiamate concorrenti riusano la stessa promise (coalescing). Ritorna il nuovo
 * access token, o `null` se il refresh fallisce (→ il chiamante lascia risalire
 * il 401 / esegue il logout).
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = eseguiRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Opzioni auth condivise per ogni chiamata HTTP autenticata (route protette
 * JwtAuthGuard). Rimpiazza le 21 copie locali di `authOptions()` negli wrapper
 * `lib/*-api.ts` (§4.5): bundle di access token corrente + hook di refresh
 * single-flight. Punto d'iniezione UNICO di `onUnauthorized`.
 */
export function authOptions(): RequestOptions {
  return {
    accessToken: getAccessToken() ?? undefined,
    onUnauthorized: refreshAccessToken,
  };
}
