// =============================================================================
// @gestionale/auth-web — auth frontend client-side del core (ADR-0027 §D5 5b)
// =============================================================================
// Public surface dell'auth FE agnostica al verticale: provider + guard + token
// storage + logout + contratti /me. Consuma @gestionale/api-client per le
// chiamate HTTP. Consumato da Next via transpilePackages (source export, le
// direttive "use client" di AuthContext/AuthGate sono preservate).
//
// NB convenzione di routing: AuthContext/AuthGate assumono lo schema URL
// multi-tenant path-based `/t/<slug>/login` (core piattaforma, TD-2). Da
// parametrizzare quando arriverà un verticale con schema URL diverso.
// =============================================================================

export { AuthProvider, useAuth } from './AuthContext';
export { AuthGate } from './AuthGate';
export {
  AUTH_CHANGE_EVENT,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isAuthenticated,
  setTokens,
} from './auth';
export { performLogout } from './auth-logout';
export type { LoginResponse, MeResponse, MeRole, MeUser } from './types';
