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
// auth-login.e2e-spec.ts (B2b) — Primo E2E test del progetto
// =============================================================================
// 3 scenari smoke auth flow via supertest + full NestJS bootstrap:
//   1. Login OK (admin@demo.local / Admin123!) → 201 + JWT pair
//   2. Wrong password → 401 E_AUTH_INVALID_CREDENTIALS
//   3. No X-Tenant-Slug header → 401 E_AUTH_TENANT_REQUIRED
//
// Pattern: container fresh per file (beforeAll start, afterAll stop) +
// truncate + seedMinimal per ogni test (beforeEach) per isolamento totale.
// =============================================================================

describe('Auth login flow (E2E)', () => {
  let containers: TestContainers;
  let app: INestApplication;

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
    await seedMinimal(containers.databaseUrl);
  });

  it('POST /auth/login OK → 201 + JWT pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'demo')
      .send({ email: 'admin@demo.local', password: 'Admin123!' });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(res.body.data.expiresIn).toBe(900);
  });

  it('POST /auth/login wrong password → 401 E_AUTH_INVALID_CREDENTIALS', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'demo')
      .send({ email: 'admin@demo.local', password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('E_AUTH_INVALID_CREDENTIALS');
  });

  it('POST /auth/login no tenant header → 401 E_AUTH_TENANT_REQUIRED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@demo.local', password: 'Admin123!' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('E_AUTH_TENANT_REQUIRED');
  });
});
