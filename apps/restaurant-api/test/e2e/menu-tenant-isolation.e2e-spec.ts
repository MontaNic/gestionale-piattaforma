// =============================================================================
// menu-tenant-isolation.e2e-spec.ts (sessione 17 F1 ADR-0019) — E2E isolation
// =============================================================================
// Verifica difesa cross-tenant sui nuovi endpoint Menu domain:
//   - RLS PostgreSQL (policy <table>_tenant_isolation) → list/get isolati
//   - TenantConsistencyGuard sessione 16 → header X-Tenant-Slug spoof → 401
//
// Scenari:
//   1. Demo crea menu M1 → 201
//   2. Acme (JWT acme + header acme coerente) GET /menus/<M1-id> → 404
//      (Guard passa: acme==acme; RLS isola M1 di demo → menu non trovato)
//   3. Acme JWT + header X-Tenant-Slug=demo (spoof) → 401 E_AUTH_TENANT_MISMATCH
//   4. Acme GET /menus (header acme) → array NON contiene M1 (RLS list isolation)
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
import { flushTenantSlugCache, loginAs, seedMenuPermissions } from './helpers/menu-test-fixtures';

describe('Menu domain tenant isolation E2E — RLS + TenantConsistencyGuard', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let demoJwt: string;
  let acmeJwt: string;

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
    await seedMenuPermissions(containers.databaseUrl, {
      tenantId: demoSeed.tenantId,
      userId: demoSeed.adminUserId,
    });
    await seedMenuPermissions(containers.databaseUrl, {
      tenantId: acmeSeed.tenantId,
      userId: acmeSeed.adminUserId,
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    demoJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
    acmeJwt = await loginAs(app, 'acme', 'admin@acme.local', 'Admin123!');
  });

  it('1. Demo crea menu M1 → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'demo')
      .send({ name: 'Menu Demo M1' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Menu Demo M1');
  });

  it('2. Acme (header coerente acme) GET /menus/<M1-id> → 404 RLS isolation', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'demo')
      .send({ name: 'Menu Demo M1' })
      .expect(201);
    const m1Id = create.body.data.id;

    // Acme JWT + header acme coerente → Guard passa (acme==acme).
    // RLS isola M1 (tenant demo) → menus.getById non lo trova → 404.
    const res = await request(app.getHttpServer())
      .get(`/api/v1/menus/${m1Id}`)
      .set('Authorization', `Bearer ${acmeJwt}`)
      .set('X-Tenant-Slug', 'acme');

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toContain('E_MENU_NOT_FOUND');
  });

  it('3. Acme JWT + header X-Tenant-Slug=demo (spoof) → 401 E_AUTH_TENANT_MISMATCH', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'demo')
      .send({ name: 'Menu Demo M1' })
      .expect(201);
    const m1Id = create.body.data.id;

    // JWT acme + header demo → TenantConsistencyGuard rileva mismatch → 401
    const res = await request(app.getHttpServer())
      .get(`/api/v1/menus/${m1Id}`)
      .set('Authorization', `Bearer ${acmeJwt}`)
      .set('X-Tenant-Slug', 'demo');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('E_AUTH_TENANT_MISMATCH');
  });

  it('4. Acme GET /menus (header acme) → array NON contiene M1 (RLS list isolation)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'demo')
      .send({ name: 'Menu Demo M1' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/menus')
      .set('Authorization', `Bearer ${acmeJwt}`)
      .set('X-Tenant-Slug', 'acme');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.find((m: { name: string }) => m.name === 'Menu Demo M1')).toBeUndefined();
  });
});
