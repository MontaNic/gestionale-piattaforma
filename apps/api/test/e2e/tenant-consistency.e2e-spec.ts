import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, seedMinimal, seedSecondTenant, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';

// =============================================================================
// tenant-consistency.e2e-spec.ts (sessione 16, ADR-0012 §TD-7) — E2E
// TenantConsistencyGuard
// =============================================================================
// Scope: defense-in-depth cross-tenant prevention su endpoint protetti.
//
// Scenari (5):
//   1. JWT demo + X-Tenant-Slug=demo → 200 (match: passa Guard, hit endpoint)
//   2. JWT demo + NO header → 200 (backward-compat: branch 3 skip)
//   3. JWT demo + X-Tenant-Slug=acme → 401 E_AUTH_TENANT_MISMATCH (cross-tenant)
//   4. JWT demo + X-Tenant-Slug=non-esistente → 401 E_AUTH_TENANT_MISMATCH
//   5. Cache hit smoke: lookup ripetuto stesso slug non rompe (esiti consistenti)
//
// Setup container fresh per file (pattern B2b coerente con rbac-permissions).
// beforeEach: truncate + seedMinimal (demo) + seedSecondTenant (acme).
//
// NB: la global prefix dell'app e' 'api/v1' (createTestApp setGlobalPrefix).
// =============================================================================

// =============================================================================
// flushTenantSlugCache — pulisce namespace `tenant:slug:*` in Redis tra test
// =============================================================================
// truncateDatabase + seedMinimal/seedSecondTenant rigenerano i tenant UUID ad
// ogni beforeEach. Senza questo flush la cache Redis del TenantConsistencyGuard
// (TTL 60s) restituisce l'UUID stale del run precedente → JWT.tenantId (nuovo
// run) ≠ cached slugTenantId → false positive mismatch 401.
//
// In production il problema non esiste: tenant UUID e' praticamente immutabile
// (rename slug raro, soft-delete invalidato entro TTL 60s). Test-only artefact.
// =============================================================================
async function flushTenantSlugCache(host: string, port: number): Promise<void> {
  const { default: Redis } = await import('ioredis');
  const client = new Redis({ host, port, lazyConnect: false, maxRetriesPerRequest: 1 });
  try {
    const keys = await client.keys('tenant:slug:*');
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } finally {
    await client.quit();
  }
}

async function loginAs(
  app: INestApplication,
  tenantSlug: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Tenant-Slug', tenantSlug)
    .send({ email, password });
  if (res.status !== 201) {
    throw new Error(
      `Login failed for ${email} on tenant ${tenantSlug}: status=${res.status} body=${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.accessToken as string;
}

describe('TenantConsistencyGuard E2E — GET /me cross-tenant defense-in-depth', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let demoJwt: string;

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
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    await seedMinimal(containers.databaseUrl);
    await seedSecondTenant(containers.databaseUrl);
    demoJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
  });

  it('scenario 1 — JWT demo + header X-Tenant-Slug=demo → 200 (match)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'demo');

    expect(res.status).toBe(200);
    expect(res.body.data?.user?.email).toBe('admin@demo.local');
  });

  it('scenario 2 — JWT demo SENZA header X-Tenant-Slug → 200 (backward-compat skip)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${demoJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data?.user?.email).toBe('admin@demo.local');
  });

  it('scenario 3 — JWT demo + header X-Tenant-Slug=acme → 401 E_AUTH_TENANT_MISMATCH (cross-tenant)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'acme');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('E_AUTH_TENANT_MISMATCH');
  });

  it('scenario 4 — JWT demo + header X-Tenant-Slug=non-esistente → 401 E_AUTH_TENANT_MISMATCH', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'tenant-inesistente-xyz');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('E_AUTH_TENANT_MISMATCH');
  });

  it('scenario 5 — cache smoke: lookup ripetuto stesso slug → esiti consistenti', async () => {
    // 2 chiamate consecutive: la seconda dovrebbe colpire la cache Redis
    // (positive cache 'tenant:slug:demo' → demo tenantId). Smoke verifica solo
    // l'idempotenza dell'output; assertion stronger sul cache hit richiederebbe
    // spy su prisma.tenant.findUnique (skip per smoke iniziale TD-7).
    const res1 = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'demo');
    const res2 = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${demoJwt}`)
      .set('X-Tenant-Slug', 'demo');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});
