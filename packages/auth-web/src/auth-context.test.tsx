import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// AuthContext + AuthGate — auth FE client-side (ADR-0027 §D5 5b)
// =============================================================================
// Chiude il gap "AuthContext/AuthGate senza test propri". Mocka i confini del
// package: il client HTTP (@gestionale/api-client, fetch /me) e il router Next
// (next/navigation). Esercita: provider che monta → fetch /me → stati di
// useAuth (anonimo vs autenticato), e il redirect di AuthGate.

// vi.mock è hoistato in cima al file: lo stato dei mock va dichiarato via
// vi.hoisted, altrimenti la factory vedrebbe i binding prima dell init.
const { apiGet, apiPost, ApiError, replace, push } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { apiGet: vi.fn(), apiPost: vi.fn(), ApiError, replace: vi.fn(), push: vi.fn() };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
}));
vi.mock('@gestionale/api-client', () => ({ apiGet, apiPost, ApiError }));

import { AuthGate } from './AuthGate';
import { AuthProvider, useAuth } from './AuthContext';
import { setTokens } from './auth';

const ME = {
  data: {
    user: {
      id: 'u1',
      tenantId: 't1',
      email: 'mario@acme.it',
      firstName: 'Mario',
      lastName: 'Rossi',
      isActive: true,
      lastLoginAt: null,
      emailVerifiedAt: null,
    },
    roles: [{ id: 'r1', name: 'admin', sedeId: null }],
    permissions: ['menu:read'],
  },
};

function Probe(): JSX.Element {
  const { isAuthenticated, isLoading, user, permissions } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="auth">{String(isAuthenticated)}</span>
      <span data-testid="email">{user?.email ?? 'none'}</span>
      <span data-testid="perms">{permissions.join(',')}</span>
    </div>
  );
}

describe('AuthProvider / useAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('senza token: isLoading→false, non autenticato, nessun fetch /me', async () => {
    render(
      <AuthProvider slug="acme">
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('email').textContent).toBe('none');
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('con token: fetch /me con bearer e popola user/permessi', async () => {
    setTokens('access-xyz', 'refresh-xyz');
    apiGet.mockResolvedValue(ME);

    render(
      <AuthProvider slug="acme">
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('true'));
    expect(apiGet).toHaveBeenCalledWith('/me', { accessToken: 'access-xyz' });
    expect(screen.getByTestId('email').textContent).toBe('mario@acme.it');
    expect(screen.getByTestId('perms').textContent).toBe('menu:read');
  });

  it('/me 401: pulisce i token e resta non autenticato', async () => {
    setTokens('stale', 'stale-refresh');
    apiGet.mockRejectedValue(new ApiError(401, 'unauthorized'));

    render(
      <AuthProvider slug="acme">
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(localStorage.getItem('gestionale_access_token')).toBeNull();
  });
});

describe('AuthGate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('anonimo: redirige a /t/<slug>/login e non mostra il contenuto protetto', async () => {
    render(
      <AuthProvider slug="acme">
        <AuthGate>
          <div data-testid="protected">secret</div>
        </AuthGate>
      </AuthProvider>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/t/acme/login'));
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it('autenticato: rende i children e non redirige', async () => {
    setTokens('access-xyz', 'refresh-xyz');
    apiGet.mockResolvedValue(ME);

    render(
      <AuthProvider slug="acme">
        <AuthGate>
          <div data-testid="protected">secret</div>
        </AuthGate>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it('durante il caricamento mostra lo spinner', () => {
    setTokens('access-xyz', 'refresh-xyz');
    apiGet.mockReturnValue(new Promise(() => {})); // mai risolta → resta in loading

    render(
      <AuthProvider slug="acme">
        <AuthGate>
          <div data-testid="protected">secret</div>
        </AuthGate>
      </AuthProvider>,
    );

    expect(screen.getByTestId('auth-gate-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).toBeNull();
  });
});
