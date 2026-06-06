import { applyDecorators, SetMetadata } from '@nestjs/common';

import { LOGIN_PIN_METADATA } from '../throttler.module';

// =============================================================================
// @LoginPinThrottle() — opt-in al throttler `auth-pin` (B2a, ADR-0014)
// =============================================================================
// Pattern coerente con @AuthStrict / @TenantCreate (B1): solo SetMetadata,
// niente Throttle({...}) inline. Limit/TTL vengono dalla forRootAsync
// env-driven (THROTTLE_AUTH_PIN_LIMIT / THROTTLE_AUTH_PIN_TTL_MS).
//
// Il flag metadata e' interpretato da:
//   1. `skipIfMetadataAbsent(LOGIN_PIN_METADATA)` nella forRoot → throttler
//      `auth-pin` skippato a meno che metadata flag true
//   2. AppThrottlerGuard.handleRequest branch `auth-pin` → tracker
//      `pin:<tenantId>:<ip>` (verifica empirica STEP 4.1: req.tenantId
//      popolato da TenantMiddleware su /auth/login-pin)
//
// TD-Y ADR-0014: deviceId NON nel tracker triplet (scope B2a, raccomandato
// completare per F1 PWA cameriere offline-first).
//
// Target endpoint: POST /auth/login-pin (apps/restaurant-api/src/auth/auth.controller.ts)
// =============================================================================
export const LoginPinThrottle = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(LOGIN_PIN_METADATA, true));
