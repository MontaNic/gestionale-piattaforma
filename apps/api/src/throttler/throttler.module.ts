import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

import { RedisService } from '../redis/redis.service';
import { skipIfMetadataAbsent } from './utils/skip-if-metadata.util';

// =============================================================================
// AppThrottlerModule — rate limiting globale via @nestjs/throttler + Redis
// =============================================================================
// 3 named throttlers (B1):
//   - default        : fallback globale, applicato a tutti gli endpoint non
//                      override. Soglia generosa (60 req/min) per evitare
//                      false positive su client legittimi.
//   - auth-strict    : login + login-pin (fase 2, opt-in via metadata flag).
//                      5 tentativi/min per IP.
//   - tenant-create  : POST /tenants (fase 2, opt-in via metadata flag).
//                      3 creazioni/h per userId.
//
// IMPORTANTE: NestJS Throttler v6 applica TUTTI i named throttler globalmente
// per ogni request. Senza l'opt-in pattern qui sotto, `auth-strict` (limit=5)
// e `tenant-create` (limit=3) bloccherebbero anche endpoint innocui come
// /health. Soluzione: `skipIf` callback che SKIPPA i throttler stricter a
// meno che l'handler/controller non abbia esplicitamente attivato il flag
// via metadata (applicato da custom decorator in fase 2).
//
// Storage: Redis (condiviso via RedisModule). Sliding window naturale del
// package storage redis: chiavi `throttle:<name>:<key>` con TTL.
//
// APP_GUARD ThrottlerGuard registrato in AppModule applica `default` a tutto.
// Limit/TTL letti da env per future tuning senza re-deploy.
// =============================================================================

// Metadata keys: applicate dai custom decorator @AuthStrict() / @TenantCreate()
// che arriveranno in fase 2 (apps/api/src/throttler/decorators/). Export qui
// per poter essere consumate dal decorator senza duplicare la stringa.
export const AUTH_STRICT_METADATA = 'gestionale:throttle:auth-strict';
export const TENANT_CREATE_METADATA = 'gestionale:throttle:tenant-create';
// B2a: opt-in per-tenant rate limit /auth/login-pin (ADR-0014).
export const LOGIN_PIN_METADATA = 'gestionale:throttle:login-pin';

// skipIfMetadataAbsent estratto in utils/skip-if-metadata.util.ts per testability
// (vedi STOP 4). Pattern higher-order: builder ritorna callback ExecutionContext-aware
// che ritorna true (skip throttler) se metadata flag assente, false altrimenti.

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService): ThrottlerModuleOptions => ({
        throttlers: [
          {
            name: 'default',
            ttl: Number(config.get<string>('THROTTLE_DEFAULT_TTL_MS') ?? '60000'),
            limit: Number(config.get<string>('THROTTLE_DEFAULT_LIMIT') ?? '60'),
          },
          {
            name: 'auth-strict',
            ttl: Number(config.get<string>('THROTTLE_AUTH_TTL_MS') ?? '60000'),
            limit: Number(config.get<string>('THROTTLE_AUTH_LIMIT') ?? '5'),
            skipIf: skipIfMetadataAbsent(AUTH_STRICT_METADATA),
          },
          {
            name: 'tenant-create',
            ttl: Number(config.get<string>('THROTTLE_TENANT_CREATE_TTL_MS') ?? '3600000'),
            limit: Number(config.get<string>('THROTTLE_TENANT_CREATE_LIMIT') ?? '3'),
            skipIf: skipIfMetadataAbsent(TENANT_CREATE_METADATA),
          },
          {
            // B2a: per-tenant rate limit /auth/login-pin (vedi ADR-0014).
            // Tracker (tenantId, ip) custom in AppThrottlerGuard. Default
            // 10 req/60s: PIN 4-6 cifre brute-forceable (10^4-10^6 keyspace),
            // scope per-tenant limita blast radius.
            name: 'auth-pin',
            ttl: Number(config.get<string>('THROTTLE_AUTH_PIN_TTL') ?? '60000'),
            limit: Number(config.get<string>('THROTTLE_AUTH_PIN_LIMIT') ?? '10'),
            skipIf: skipIfMetadataAbsent(LOGIN_PIN_METADATA),
          },
        ],
        storage: new ThrottlerStorageRedisService(redis.getClient()),
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class AppThrottlerModule {}
