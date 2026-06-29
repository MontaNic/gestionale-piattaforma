// =============================================================================
// tariffe-crud.e2e-spec.ts (ADR-0055) — E2E tariffario orario
// =============================================================================
// Full AppModule bootstrap (Testcontainers) + supertest. CRUD sotto /tariffe.
// Coverage (ADR-0052 CHECK-BE-1 RBAC + CHECK-BE-2 soft-delete):
//   1.  POST tariffa role-scoped → 201
//   2.  POST tariffa user-scoped → 201
//   3.  POST con viewer (tariffario.visualizza) → 403            [CHECK-BE-1]
//   4.  POST con roleId+userId entrambi → 400 E_TARIFFA_SCOPE_INVALID
//   5.  POST senza né roleId né userId → 400 E_TARIFFA_SCOPE_INVALID
//   6.  POST roleId inesistente → 400 E_TARIFFA_ROLE_NOT_FOUND
//   7.  POST duplicata (stesso ruolo attivo) → 409 E_TARIFFA_DUPLICATA
//   8.  GET lista → roleName risolto
//   9.  GET cross-tenant (tariffa di A da B) → 404               [CHECK-BE-1]
//   10. PATCH tariffaOraria → 200
//   11. DELETE → soft-delete: lista non la mostra + ri-creazione stesso scope OK [CHECK-BE-2]
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
import {
  TARIFFE_ADMIN_CODES,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedTariffeViewer,
} from './helpers/tariffe-test-fixtures';

describe('Tariffe CRUD E2E — /api/v1/tariffe', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminAJwt: string;
  let viewerJwt: string;
  let adminBJwt: string;
  let roleAId: string;
  let adminAUserId: string;

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

    const seedA = await seedMinimal(containers.databaseUrl);
    const permsA = await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
      roleName: 'Tariffe Admin',
      codes: [...TARIFFE_ADMIN_CODES],
    });
    const viewer = await seedTariffeViewer(containers.databaseUrl, { tenantId: seedA.tenantId });

    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      roleName: 'Tariffe Admin',
      codes: [...TARIFFE_ADMIN_CODES],
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'studio-demo', viewer.email, viewer.password);
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');

    roleAId = permsA.roleId;
    adminAUserId = seedA.adminUserId;
  });

  const base = '/api/v1/tariffe';
  function post(jwt: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(base).set('Authorization', `Bearer ${jwt}`).send(body);
  }

  it('1. POST tariffa role-scoped → 201', async () => {
    const res = await post(adminAJwt, { roleId: roleAId, tariffaOraria: 50 });
    expect(res.status).toBe(201);
    expect(res.body.data.roleId).toBe(roleAId);
    expect(res.body.data.userId).toBeNull();
    expect(Number(res.body.data.tariffaOraria)).toBe(50);
  });

  it('2. POST tariffa user-scoped → 201', async () => {
    const res = await post(adminAJwt, { userId: adminAUserId, tariffaOraria: 80 });
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(adminAUserId);
    expect(res.body.data.roleId).toBeNull();
  });

  it('3. POST con viewer (tariffario.visualizza) → 403', async () => {
    const res = await post(viewerJwt, { roleId: roleAId, tariffaOraria: 50 });
    expect(res.status).toBe(403);
  });

  it('4. POST con roleId+userId entrambi → 400 E_TARIFFA_SCOPE_INVALID', async () => {
    const res = await post(adminAJwt, { roleId: roleAId, userId: adminAUserId, tariffaOraria: 50 });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_TARIFFA_SCOPE_INVALID');
  });

  it('5. POST senza scope → 400 E_TARIFFA_SCOPE_INVALID', async () => {
    const res = await post(adminAJwt, { tariffaOraria: 50 });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_TARIFFA_SCOPE_INVALID');
  });

  it('6. POST roleId inesistente → 400 E_TARIFFA_ROLE_NOT_FOUND', async () => {
    const res = await post(adminAJwt, {
      roleId: '00000000-0000-7000-8000-000000000000',
      tariffaOraria: 50,
    });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_TARIFFA_ROLE_NOT_FOUND');
  });

  it('7. POST duplicata (stesso ruolo attivo) → 409 E_TARIFFA_DUPLICATA', async () => {
    await post(adminAJwt, { roleId: roleAId, tariffaOraria: 50 }).expect(201);
    const res = await post(adminAJwt, { roleId: roleAId, tariffaOraria: 60 });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_TARIFFA_DUPLICATA');
  });

  it('8. GET lista → roleName risolto', async () => {
    await post(adminAJwt, { roleId: roleAId, tariffaOraria: 50 }).expect(201);
    const res = await request(app.getHttpServer())
      .get(base)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].roleName).toBe('Tariffe Admin');
    expect(res.body.data[0].userName).toBeNull();
  });

  it('9. GET cross-tenant (tariffa di A da B) → 404', async () => {
    const id = (await post(adminAJwt, { roleId: roleAId, tariffaOraria: 50 }).expect(201)).body.data
      .id;
    const res = await request(app.getHttpServer())
      .get(`${base}/${id}`)
      .set('Authorization', `Bearer ${adminBJwt}`);
    expect(res.status).toBe(404);
  });

  it('10. PATCH tariffaOraria → 200', async () => {
    const id = (await post(adminAJwt, { roleId: roleAId, tariffaOraria: 50 }).expect(201)).body.data
      .id;
    const res = await request(app.getHttpServer())
      .patch(`${base}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ tariffaOraria: 75, attivo: false })
      .expect(200);
    expect(Number(res.body.data.tariffaOraria)).toBe(75);
    expect(res.body.data.attivo).toBe(false);
  });

  it('11. DELETE → soft-delete + ri-creazione stesso scope OK', async () => {
    const id = (await post(adminAJwt, { roleId: roleAId, tariffaOraria: 50 }).expect(201)).body.data
      .id;
    await request(app.getHttpServer())
      .delete(`${base}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(base)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(list.body.data.find((t: { id: string }) => t.id === id)).toBeUndefined();

    // Il partial-unique è WHERE deleted_at IS NULL → ri-creazione consentita.
    await post(adminAJwt, { roleId: roleAId, tariffaOraria: 55 }).expect(201);
  });

  it('12. GET /tariffe/roles → 200, include il ruolo del tenant', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/roles`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(res.body.data.find((r: { id: string }) => r.id === roleAId)?.name).toBe('Tariffe Admin');
  });

  it("13. GET /tariffe/users → 200, include l'utente admin", async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/users`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(res.body.data.some((u: { id: string }) => u.id === adminAUserId)).toBe(true);
  });

  it('14. GET /tariffe/roles con viewer (no gestisci) → 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/roles`)
      .set('Authorization', `Bearer ${viewerJwt}`);
    expect(res.status).toBe(403);
  });
});
