// =============================================================================
// tables-tenant-isolation.e2e-spec.ts (F2 Tavoli, ADR-0058) — E2E isolation
// =============================================================================
// Verifica difesa cross-tenant sugli endpoint /tables: l'`:id` di un tavolo di
// un altro tenant NON deve leakare — RLS isola la riga → 404 (non 403, non leak).
//
// Scenari (demo crea T1, acme opera con JWT+header coerenti acme):
//   1. acme GET    /tables/<T1-id> → 404
//   2. acme PATCH  /tables/<T1-id> → 404
//   3. acme DELETE /tables/<T1-id> → 404
//   4. acme GET    /tables         → array NON contiene T1 (list isolation)
//
// flushTenantSlugCache beforeEach: truncate rigenera tenant UUID → cache
// TenantConsistencyGuard TTL 60s stale (Discovery #51 sessione 16).
// =============================================================================

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, seedMinimal, seedSecondTenant, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';
import { flushTenantSlugCache, loginAs } from './helpers/menu-test-fixtures';
import { seedTablePermissions } from './helpers/table-test-fixtures';

describe('Tables tenant isolation E2E — cross-tenant :id → 404 (no leak)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let demoJwt: string;
  let acmeJwt: string;
  let demoTableId: string;

  beforeAll(async () => {
    containers = await startTestContainers();
    app = await createTestApp(containers);
  });

  afterAll(async () => {
    await app?.close();
    await stopTestContainers(containers);
  });

  beforeEach(async () => {
    await truncateDatabase(containers.databaseUrl);
    const demoSeed = await seedMinimal(containers.databaseUrl);
    const acmeSeed = await seedSecondTenant(containers.databaseUrl);
    await seedTablePermissions(containers.databaseUrl, {
      tenantId: demoSeed.tenantId,
      userId: demoSeed.adminUserId,
      grant: 'manager',
    });
    await seedTablePermissions(containers.databaseUrl, {
      tenantId: acmeSeed.tenantId,
      userId: acmeSeed.adminUserId,
      grant: 'manager',
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    demoJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
    acmeJwt = await loginAs(app, 'acme', 'admin@acme.local', 'Admin123!');

    const create = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'demo')
      .send({ numero: 'D1', capienza: 4 })
      .expect(201);
    demoTableId = create.body.data.id;
  });

  it('1. acme GET /tables/<demo-id> → 404 (RLS isola, no leak)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/tables/${demoTableId}`)
      .set('Authorization', `Bearer ${acmeJwt}`)
      .set('X-Tenant-Slug', 'acme');
    expect(res.status).toBe(404);
  });

  it('2. acme PATCH /tables/<demo-id> → 404', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/tables/${demoTableId}`)
      .set('Authorization', `Bearer ${acmeJwt}`)
      .set('X-Tenant-Slug', 'acme')
      .send({ posX: 10, posY: 10 });
    expect(res.status).toBe(404);
  });

  it('3. acme DELETE /tables/<demo-id> → 404', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/tables/${demoTableId}`)
      .set('Authorization', `Bearer ${acmeJwt}`)
      .set('X-Tenant-Slug', 'acme');
    expect(res.status).toBe(404);
  });

  it('4. acme GET /tables → array NON contiene il tavolo demo (list isolation)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tables')
      .set('Authorization', `Bearer ${acmeJwt}`)
      .set('X-Tenant-Slug', 'acme');
    expect(res.status).toBe(200);
    expect(res.body.data.find((tv: { id: string }) => tv.id === demoTableId)).toBeUndefined();
  });
});
