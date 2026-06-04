const ACCESS_KEY = 'gestionale_access_token';
const REFRESH_KEY = 'gestionale_refresh_token';

// Custom event same-tab sync per AuthContext (ADR-0018 §AuthContext strategy).
// Lo `storage` event nativo NON e' triggerato nel tab che chiama setItem —
// serve un dispatch esplicito perche' il listener di AuthContext re-fetchi
// /me dopo setTokens/clearTokens chiamati da login/logout flows.
// Cross-tab sync resta coperto da `storage` event listener.
export const AUTH_CHANGE_EVENT = 'gestionale:auth-change';

function dispatchAuthChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function setTokens(access: string, refresh: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
  dispatchAuthChange();
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  dispatchAuthChange();
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}
