import { execSync } from 'node:child_process';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

// =============================================================================
// test-containers.ts (B2b) — Testcontainers Postgres + Redis per E2E
// =============================================================================
// Pattern shared per-file (no globale): beforeAll → startTestContainers,
// afterAll → stopTestContainers. Isolamento totale tra file test, container
// fresh-state ad ogni run.
//
// Images pinned coerenti con docker-compose.dev.yml:
//   - postgres:16-alpine (production schema base)
//   - redis:7-alpine     (B1 throttler + lockout storage)
//
// Promise.all per ridurre startup wall-time (~10-15s vs ~25s sequenziale).
//
// Migration Prisma eseguita post-start via execSync (`prisma migrate deploy`)
// con DATABASE_URL = DIRECT_URL = test container URI (postgres user è
// superuser di default su Testcontainers Postgres → bypass RLS in migrate).
//
// NB: nessun seed completo qui — seedMinimal in test-app.ts (più veloce, no
// 32 permessi/6 role templates/104 mappings).
// =============================================================================

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  databaseUrl: string;
  redisHost: string;
  redisPort: number;
}

export async function startTestContainers(): Promise<TestContainers> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('gestionale_test')
      .withUsername('postgres')
      .withPassword('postgres_test')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  const databaseUrl = postgres.getConnectionUri();
  const redisHost = redis.getHost();
  const redisPort = redis.getMappedPort(6379);

  // Prisma migrate deploy via packages/db CLI. DATABASE_URL + DIRECT_URL
  // entrambe puntano al container (postgres user è superuser di default in
  // Testcontainers Postgres → bypass RLS, identico al pattern dev DIRECT_URL).
  execSync('pnpm --filter @gestionale/db prisma:migrate:deploy', {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
    },
    stdio: 'inherit',
  });

  return { postgres, redis, databaseUrl, redisHost, redisPort };
}

export async function stopTestContainers(containers: TestContainers): Promise<void> {
  await Promise.all([containers.postgres.stop(), containers.redis.stop()]);
}
