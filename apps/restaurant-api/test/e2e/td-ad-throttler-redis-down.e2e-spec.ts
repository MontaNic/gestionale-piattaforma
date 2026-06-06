import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, seedMinimal, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';

// =============================================================================
// td-ad-throttler-redis-down.e2e-spec.ts (B2b Fase 5)
// =============================================================================
// Integration test del fix TD-AD applicato in Fase 4:
// `AppThrottlerGuard.handleRequest` outer try/catch fail-open su Redis error.
//
// Scenario:
//   1. Baseline: login OK con Redis UP → 201 (regression check)
//   2. Stop Redis container mid-test
//   3. Login con Redis DOWN → atteso 201 (fail-open verificato).
//      Discovery #26 B2a pre-fix: senza TD-AD fix l'errore era 500
//      MaxRetriesPerRequestError → blocco completo auth flow.
//      Post-fix: log warn [FAIL-OPEN], request passa, auth funziona.
//
// Recovery NON testato qui: B2a STOP 5 ha gia' verificato manualmente che
// ioredis auto-reconnect ripristina entro ~121ms post-restart Redis container.
// Aggiungere recovery test richiederebbe re-start container con stesso
// host:port mapping (non garantito da Testcontainers) → fuori scope B2b.
// =============================================================================

describe('TD-AD: ThrottlerGuard fail-open su Redis DOWN', () => {
  let containers: TestContainers;
  let app: INestApplication;

  beforeAll(async () => {
    containers = await startTestContainers();
    app = await createTestApp(containers);
  });

  afterAll(async () => {
    await app?.close();
    // NB: redis container gia' stoppato dal test → stopTestContainers tenta
    // stop idempotente. Postgres resta da stoppare.
    try {
      await stopTestContainers(containers);
    } catch {
      // Ignorato — container redis gia' stoppato e' stato l'errore atteso.
    }
  });

  beforeEach(async () => {
    await truncateDatabase(containers.databaseUrl);
    await seedMinimal(containers.databaseUrl);
  });

  it('login funziona durante Redis DOWN (fail-open) — TD-AD verified', async () => {
    // 1. Baseline: login OK con Redis UP (regression check pre-stop)
    const upRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'demo')
      .send({ email: 'admin@demo.local', password: 'Admin123!' });
    expect(upRes.status).toBe(201);
    expect(upRes.body.data).toHaveProperty('accessToken');

    // 2. Stop Redis container mid-test
    await containers.redis.stop();

    // 3. Login con Redis DOWN: atteso 201 (TD-AD fail-open) NON 500
    //    Timeout esteso: ioredis ha retry exponential backoff
    //    (maxRetriesPerRequest=3, ~1-2s primo errore prima del fail-open).
    const downRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'demo')
      .send({ email: 'admin@demo.local', password: 'Admin123!' })
      .timeout(10_000);

    expect(downRes.status).toBe(201); // ⭐ KEY ASSERTION: TD-AD fail-open
    expect(downRes.body.data).toHaveProperty('accessToken');
  }, 30_000);
});
