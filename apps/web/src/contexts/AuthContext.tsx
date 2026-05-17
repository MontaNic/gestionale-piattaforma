'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

import { apiGet, ApiError } from '@/lib/api';
import { AUTH_CHANGE_EVENT, clearTokens, getAccessToken } from '@/lib/auth';
import { performLogout } from '@/lib/auth-logout';
import type { MeResponse, MeRole, MeUser } from '@/lib/types';

// =============================================================================
// AuthContext — tenant-scoped auth state (ADR-0018 §AuthContext strategy)
// =============================================================================
// Strategy: client-side fetch /me on mount (coerente con localStorage token
// reader TD-2 ADR-0012). Migration path TD-1 httpOnly cookie additivo —
// in futuro `initialUser` prop opzionale da Server Component layout
// per hydrate iniziale + skip fetch /me se hydrate present.
//
// Scope: provider monta in `app/t/[slug]/layout.tsx`, lo slug e' propagato
// come prop (preso da `params` server-side, Next.js 15 async). Single source
// of truth per tutta la sub-tree (authenticated routes + login page se serve).
//
// Storage event listener: se altro tab fa logout (localStorage clear), questo
// tab fa re-check + state reset. NO redirect qui — AuthGate gestisce.
// =============================================================================

interface AuthState {
  user: MeUser | null;
  roles: MeRole[];
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  tenant: { slug: string };
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const INITIAL_STATE: AuthState = {
  user: null,
  roles: [],
  permissions: [],
  isAuthenticated: false,
  isLoading: true,
  error: null,
};

function resetAuthState(): AuthState {
  return { ...INITIAL_STATE, isLoading: false };
}

export function AuthProvider({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}): JSX.Element {
  const router = useRouter();
  const [state, setState] = useState<AuthState>(INITIAL_STATE);

  const loginUrl = `/t/${slug}/login`;

  const loadProfile = useCallback(async (): Promise<void> => {
    const token = getAccessToken();
    if (!token) {
      setState(resetAuthState());
      return;
    }

    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await apiGet<MeResponse>('/me', { accessToken: token });
      setState({
        user: res.data.user,
        roles: res.data.roles,
        permissions: res.data.permissions,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        clearTokens();
        setState(resetAuthState());
        return;
      }
      setState({
        ...resetAuthState(),
        error: err instanceof Error ? err.message : 'Errore caricamento profilo',
      });
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    // Cross-tab sync: `storage` event NON triggera nel tab che ha chiamato
    // setItem → cattura solo cambiamenti da altri tab. `e.key === null`
    // segnala `localStorage.clear()`; chiavi specifiche segnalano
    // setItem/removeItem mirato.
    const onStorage = (e: StorageEvent): void => {
      if (
        e.key === null ||
        e.key === 'gestionale_access_token' ||
        e.key === 'gestionale_refresh_token'
      ) {
        void loadProfile();
      }
    };
    // Same-tab sync: `setTokens`/`clearTokens` dispatchano evento custom
    // (vedi lib/auth.ts) perche' `storage` event nativo NON copre questo tab.
    // Senza listener, dopo login il provider resta con `isAuthenticated=false`
    // (state stale) → AuthGate redirige indietro a /login.
    const onAuthChange = (): void => {
      void loadProfile();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    };
  }, [loadProfile]);

  const logout = useCallback(async (): Promise<void> => {
    await performLogout();
    setState(resetAuthState());
    router.push(loginUrl);
  }, [router, loginUrl]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      tenant: { slug },
      logout,
      refresh: loadProfile,
    }),
    [state, slug, logout, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
