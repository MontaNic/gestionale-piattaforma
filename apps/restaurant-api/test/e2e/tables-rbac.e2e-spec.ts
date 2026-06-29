// =============================================================================
// tables-rbac.e2e-spec.ts (F2 Tavoli, ADR-0058) — E2E RBAC PermissionsGuard
// =============================================================================
// Verifica i due verbi `tavoli.visualizza` / `tavoli.gestisci` sugli endpoint:
//   - viewer (solo tavoli.visualizza): GET /tables → 200, ma
//       POST/PATCH/DELETE → 403 E_AUTH_INSUFFICIENT_PERMISSIONS
//   - manager (tavoli.visualizza + tavoli.gestisci): POST /tables → 201
//
// Due utenti sullo stesso tenant demo con ruoli/grant distinti
// (seedTablePermissions grant 'viewer' | 'manager').
// =============================================================================

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, seedMinimal, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';
import { flushTenantSlugCache, loginAs, seedLimitedUser } from './helpers/menu-test-fixtures';
import { seedTablePermissions } from './helpers/table-test-fixtures';

describe('Tables RBAC E2E — tavoli.visualizza vs tavoli.gestisci', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let managerJwt: string;
  let viewerJwt: string;
  let seededTableId: string;

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

    // admin demo = manager (CRUD completo)
    await seedTablePermissions(containers.databaseUrl, {
      tenantId: demoSeed.tenantId,
      userId: demoSeed.adminUserId,
      grant: 'manager',
    });
    // secondo utente = viewer (solo lettura)
    const viewer = await seedLimitedUser(containers.databaseUrl, {
      tenantId: demoSeed.tenantId,
      email: 'viewer@demo.local',
      password: 'Viewer123!',
    });
    await seedTablePermissions(containers.databaseUrl, {
      tenantId: demoSeed.tenantId,
      userId: viewer.userId,
      grant: 'viewer',
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    managerJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'demo', viewer.email, viewer.password);

    // un tavolo pre-esistente (creato dal manager) per i test PATCH/DELETE viewer
    const create = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${managerJwt}`)
      .send({ numero: '1', capienza: 4 })
      .expect(201);
    seededTableId = create.body.data.id;
  });

  it('manager con tavoli.gestisci → POST /tables 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${managerJwt}`)
      .send({ numero: '2', capienza: 6 });
    expect(res.status).toBe(201);
  });

  it('viewer con tavoli.visualizza → GET /tables 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tables')
      .set('Authorization', `Bearer ${viewerJwt}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('viewer → POST /tables 403 E_AUTH_INSUFFICIENT_PERMISSIONS', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${viewerJwt}`)
      .send({ numero: '99', capienza: 2 });
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('viewer → PATCH /tables/:id 403', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/tables/${seededTableId}`)
      .set('Authorization', `Bearer ${viewerJwt}`)
      .send({ posX: 50, posY: 50 });
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('viewer → DELETE /tables/:id 403', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/tables/${seededTableId}`)
      .set('Authorization', `Bearer ${viewerJwt}`);
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });
});
