import { Global, Module } from '@nestjs/common';

import { RedisService } from './redis.service';

// =============================================================================
// RedisModule — @Global per esporre RedisService a tutto AppModule
// =============================================================================
// Pattern simmetrico a DbModule. Un solo client ioredis condiviso fra
// ThrottlerModule (storage rate-limit) e LockoutService (sliding window, B1
// fase 3) — evita 2 connection pool ridondanti.
// ConfigModule e' globale (registrato in AppModule), quindi ConfigService
// e' DI-iniettabile senza re-import qui.
// =============================================================================
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
