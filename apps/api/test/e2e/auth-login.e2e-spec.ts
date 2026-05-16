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
// auth-login.e2e-spec.ts (B2b + PR 2 TD-H/TD-AJ smoke extension)
// =============================================================================
// 5 scenari smoke auth flow via supertest + full NestJS bootstrap:
//   1. Login OK (admin@demo.local / Admin123!) → 201 + JWT pair
//   2. Wrong password → 401 errorCode E_AUTH_INVALID_CREDENTIALS + shape TD-AJ
//   3. No X-Tenant-Slug header → 401 E_AUTH_TENANT_REQUIRED (default shape)
//   4. TD-H cross-tenant lockout isolation (3 fail demo → 4° fail acme NOT locked)
//   5. TD-AJ response shape 401: {statusCode, errorCode, message, timestamp}
//
// Pattern: container fresh per file (beforeAll start, afterAll stop) +
// truncate + seedMinimal per ogni test (beforeEach) per isolamento totale.
// LOCKOUT_THRESHOLD=3 (test-app.ts), LOCKOUT_DURATION_MS=5000 → veloce.
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

  it('POST /auth/login wrong password → 401 errorCode E_AUTH_INVALID_CREDENTIALS (TD-AJ shape)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'demo')
      .send({ email: 'admin@demo.local', password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('E_AUTH_INVALID_CREDENTIALS');
    expect(res.body.message).toBe('Credenziali non valide');
    expect(res.body.statusCode).toBe(401);
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('POST /auth/login no tenant header → 401 E_AUTH_TENANT_REQUIRED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@demo.local', password: 'Admin123!' });

    expect(res.status).toBe(401);
    // Note: questo flow lancia da controller `new UnauthorizedException()` con
    // shape NestJS default (no errorCode). Out-of-scope DP3.1 → TD-AY coverage.
    expect(res.body.message).toBe('E_AUTH_TENANT_REQUIRED');
  });

  // ─── Test TD-H cross-tenant lockout isolation (PR 2 sessione 12) ─────────
  // Shared email `admin@demo.local` su tenant demo + acme. 3 fail su demo
  // triggera lockout SOLO su tenant demo (key Redis `tenant:<demo>:email:...`).
  // Tentativo wrong password su acme con stessa email NON deve essere 429.
  it('TD-H: lockout demo NOT blocks tenant acme (cross-tenant isolation)', async () => {
    // Seed secondo tenant con SAME email per scenario shared-email DoS proof.
    await seedSecondTenant(containers.databaseUrl, { email: 'admin@demo.local' });

    // 3 fail su demo → lockout key Redis `tenant:<demoId>:email:admin@demo.local`
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', 'demo')
        .send({ email: 'admin@demo.local', password: 'WrongPassword!' });
      expect([401, 429]).toContain(res.status);
    }

    // 4° tentativo su demo: 429 Locked (lockout active)
    const demoLocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'demo')
      .send({ email: 'admin@demo.local', password: 'WrongPassword!' });
    expect(demoLocked.status).toBe(429);
    expect(demoLocked.body.code).toBe('E_AUTH_ACCOUNT_LOCKED');

    // Stesso istante: tentativo wrong password su acme → 401 (NOT 429).
    // Cross-tenant isolation: key Redis è `tenant:<acmeId>:email:...`, distinta.
    const acmeNotLocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', 'acme')
      .send({ email: 'admin@demo.local', password: 'WrongPassword!' });
    expect(acmeNotLocked.status).toBe(401);
    expect(acmeNotLocked.body.errorCode).toBe('E_AUTH_INVALID_CREDENTIALS');
  });
});
