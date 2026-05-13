import { applyDecorators, SetMetadata } from '@nestjs/common';

import { AUTH_STRICT_METADATA } from '../throttler.module';

// =============================================================================
// @AuthStrict() — opt-in al throttler `auth-strict` (B1, fase 2)
// =============================================================================
// Applica il flag metadata che il `skipIf` nella forRootAsync globale (vedi
// throttler.module.ts) interpreta come "esegui questo throttler". Senza
// metadata, il throttler `auth-strict` (limit=5/min) viene SKIPPED.
//
// TTL/limit NON passati qui: vengono dalla forRootAsync (env-driven). Il
// decorator e' puro opt-in semantico, niente override numerico.
//
// Target endpoint (apps/api/src/auth/auth.controller.ts):
//   - POST /auth/login
//   - POST /auth/login-pin
// =============================================================================
export const AuthStrict = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(AUTH_STRICT_METADATA, true));
