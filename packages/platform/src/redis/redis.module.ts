import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { RedisService } from './redis.service';

// =============================================================================
// RedisModule — @Global per esporre RedisService a tutto AppModule
// =============================================================================
// Pattern simmetrico a DbModule. Un solo client ioredis condiviso fra
// ThrottlerModule (storage rate-limit) e LockoutService (sliding window, B1
// fase 3) — evita 2 connection pool ridondanti.
//
// `imports: [ConfigModule]` esplicito (anche se ConfigModule.forRoot e'
// globale in AppModule): Discovery #29 B2b — Test.createTestingModule
// non sempre rispetta isGlobal eager order, ConfigService risulta undefined
// in RedisService constructor durante E2E bootstrap. Import esplicito e'
// production-safe (zero impatto runtime, ConfigModule re-uses singleton).
// =============================================================================
@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
