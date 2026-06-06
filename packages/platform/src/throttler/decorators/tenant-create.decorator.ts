import { applyDecorators, SetMetadata } from '@nestjs/common';

import { TENANT_CREATE_METADATA } from '../throttler.module';

// =============================================================================
// @TenantCreate() — opt-in al throttler `tenant-create` (B1, fase 2)
// =============================================================================
// Stessa semantica di @AuthStrict ma per il throttler `tenant-create`
// (limit=3/h). Inoltre il flag metadata viene letto dal custom
// AppThrottlerGuard.getTracker() per switchare il tracker da IP-only a
// userId-or-IP (vedi guards/app-throttler.guard.ts) — attacker autenticato
// con `sistema.tenant.gestisci` non puo' bypassare con IP rotation.
//
// Target endpoint (apps/restaurant-api/src/tenants/tenants.controller.ts):
//   - POST /tenants
// =============================================================================
export const TenantCreate = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(TENANT_CREATE_METADATA, true));
