// =============================================================================
// rbac.module.ts — RBAC enforcement module (PermissionsGuard + decorator)
// =============================================================================
// Esporta PermissionsGuard per registrazione APP_GUARD in AppModule.
//
// NB: Guard NON è registrato come APP_GUARD qui dentro (sarebbe scope-local).
// Registrazione globale avviene in app.module.ts via providers APP_GUARD
// (pattern coerente con AppThrottlerGuard B1/B2b).
//
// Imports:
// - UsersModule: UsersService.hasPermission (lazy lookup, RLS via ALS context)
// - RedisModule: cache permissions TTL 60s + dedupe audit auth.permission_denied
// - ConfigModule: env var RBAC_CACHE_TTL_S
// - DbService: già Global (DbModule @Global), audit insert inline su deny path
// =============================================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { RedisModule } from '@gestionale/platform';
import { UsersModule } from '../users/users.module';
import { PermissionsGuard } from './guards/permissions.guard';

@Module({
  imports: [UsersModule, RedisModule, ConfigModule],
  providers: [PermissionsGuard],
  exports: [PermissionsGuard],
})
export class RbacModule {}
