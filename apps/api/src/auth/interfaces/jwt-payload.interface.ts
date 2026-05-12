// =============================================================================
// jwt-payload.interface.ts — Shape dei JWT access/refresh
// =============================================================================
// Decisione 7 (ADR-0008): payload MINIMAL. Niente roles/permissions inline:
// vengono caricati fresh dal DB ogni request via JwtStrategy + UsersService.
// Pro: revoca permessi istantanea, niente token "stale" con privilegi rimossi.
// Con: 1 query DB per request autenticata (accettato per F1, vedi ADR-0008).
// =============================================================================

export interface JwtPayload {
  /** User id (UUID v7) — claim standard JWT `sub`. */
  sub: string;
  /** Tenant id (UUID v7) — coerenza multi-tenancy in JWT, no header spoofing. */
  tenantId: string;
  /** Session id (UUID v7) — lookup runtime per verificare is_active + expires_at. */
  sessionId: string;
  /** Tipo token, per disambiguare access vs refresh. */
  type: 'access' | 'refresh';
  /** Issued at (epoch seconds), auto-popolato da @nestjs/jwt sign. */
  iat?: number;
  /** Expires at (epoch seconds), auto-popolato da @nestjs/jwt sign. */
  exp?: number;
}
