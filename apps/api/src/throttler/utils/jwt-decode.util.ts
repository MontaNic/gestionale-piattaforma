// =============================================================================
// jwt-decode.util.ts — Decode minimale JWT senza verify firma (B1 STOP 2)
// =============================================================================
// Estratto come funzione standalone per testability (LockoutService spec
// rimane focalizzato; questo helper e' testabile in isolation senza
// istanziare AppThrottlerGuard / NestJS context).
//
// IMPORTANTE: NO verify firma. Usato solo per identificare il caller per
// bucket di rate-limit, non per autorizzazione. JwtAuthGuard rifiutera'
// token forgiato/scaduto al passaggio successivo. Vedi guard sorgente +
// ADR-0013 TD-E.
// =============================================================================

/**
 * Estrae `sub` claim dal payload JWT senza verifica firma.
 * @param authHeader Valore dell'header `Authorization` (es. "Bearer <jwt>")
 * @returns `sub` claim come stringa, oppure `undefined` se:
 *   - header assente o non stringa
 *   - schema diverso da Bearer
 *   - token malformato (no 3 parti separate da `.`)
 *   - payload non-JSON o non-objct
 *   - `sub` assente o non-stringa
 */
export function extractSubFromAuthHeader(authHeader: unknown): string | undefined {
  if (typeof authHeader !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return undefined;
  const token = match[1];
  const parts = token?.split('.') ?? [];
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload: unknown = JSON.parse(payloadJson);
    if (
      payload &&
      typeof payload === 'object' &&
      'sub' in payload &&
      typeof (payload as { sub: unknown }).sub === 'string'
    ) {
      return (payload as { sub: string }).sub;
    }
  } catch {
    // Token malformed → fallback. Caller usera' IP-based bucket.
  }
  return undefined;
}
