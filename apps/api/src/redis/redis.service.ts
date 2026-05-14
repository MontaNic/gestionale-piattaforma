import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// =============================================================================
// RedisService — singleton ioredis client per rate limiting + lockout (B1)
// =============================================================================
// Pattern coerente con DbService: composition wrapper su client esterno con
// lifecycle hooks. Riusabile in futuro per cache, session, pub/sub (F1+).
// Dev-tolerant: PING failure su boot logga warning ma NON crasha. Production
// richiedera' circuit breaker + retry/reconnect strategy esplicita (TD ADR-0013).
// =============================================================================
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  // @Inject esplicito: Discovery #29 B2b — Vitest+esbuild non emette
  // design:paramtypes metadata, NestJS DI riceve undefined per i constructor
  // args inferred. @Inject(ConfigService) registra il token in
  // PARAMTYPES_METADATA bypassando il lookup design:paramtypes. Production
  // zero impact (metadata reflection ridondante con annotazione esplicita).
  constructor(@Inject(ConfigService) config: ConfigService) {
    const host = config.get<string>('REDIS_HOST') ?? 'localhost';
    const port = Number(config.get<string>('REDIS_PORT') ?? '6379');
    const password = config.get<string>('REDIS_PASSWORD');

    this.client = new Redis({
      host,
      port,
      // password assente in dev (no requirepass su docker-compose.dev.yml).
      // In staging/prod l'env var attiva l'auth Redis-side.
      ...(password ? { password } : {}),
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });

    // Listener globale: ioredis emette 'error' su connection drop e retry
    // failures. Senza handler il process crasha con "Unhandled error".
    // Log warning non bloccante: la storage Throttler fail-open di suo.
    this.client.on('error', (err) => {
      this.logger.warn(`Redis client error: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    // PING basic come liveness check. Fallimento NON crash: il guard
    // Throttler degraderà gracefully (vedi @nest-lab/throttler-storage-redis
    // fallback behaviour) e la rotta /health resta indipendente.
    try {
      const pong = await this.client.ping();
      this.logger.log(`Redis connected (PING -> ${pong})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis PING failed at boot: ${msg}. Dev-tolerant, continuing.`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Graceful close: quit() invia QUIT command e chiude il socket pulito.
    // Fallback disconnect() su error per shutdown rapido (test/SIGKILL).
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  getClient(): Redis {
    return this.client;
  }
}
