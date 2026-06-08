// =============================================================================
// aziende-crud.e2e-spec.ts (STOP-c1b) — E2E CRUD anagrafica clienti
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest.
// Coverage:
//   1.  POST   /aziende create OK 201
//   2.  GET    /aziende list contiene l'azienda creata
//   3.  GET    /aziende/:id getById OK 200
//   4.  GET    /aziende/:id 404 E_AZIENDA_NOT_FOUND (uuid inesistente)
//   5.  POST   /aziende dup codice → 409 E_AZIENDA_CODICE_EXISTS
//   6.  PATCH  /aziende/:id update nome → 200
//   7.  DELETE /aziende/:id soft-delete → 200 { id, deleted: true }
//   8.  GET    /aziende list post-delete non include l'azienda
//   9.  POST   /aziende ricrea stesso codice della soft-deleted → 201 (partial-unique)
//   10. DELETE /aziende/:id come viewer (solo visualizza) → 403
//   11. Isolamento applicativo: admin tenant B non vede le aziende di A
//
// NB TD-BS Sub-2: niente test validation 400 (ValidationPipe inattiva in e2e,
// coperto dagli unit DTO c1). Suite superuser (TD-BV): isolamento applicativo.
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
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedViewer,
} from './helpers/aziende-test-fixtures';

const BASE = '/api/v1/aziende';
const VALID = {
  codice: 'AZ001',
  nome: 'Rossi Srl',
  tipoCliente: 'azienda',
  partitaIva: '01234567890',
};

describe('Aziende CRUD E2E — /api/v1/aziende', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminJwt: string;
  let viewerJwt: string;
  let tenantBAdminJwt: string;

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

    // Tenant A (studio-demo) + admin con i 4 anagrafica.cliente.*
    const seedA = await seedMinimal(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
    });
    // Viewer su tenant A (solo visualizza) → 403 sul DELETE
    const viewer = await seedViewer(containers.databaseUrl, { tenantId: seedA.tenantId });

    // Tenant B (studio-acme) + admin con visualizza (per l'isolamento)
    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'studio-demo', viewer.email, viewer.password);
    tenantBAdminJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');
  });

  // Helper: crea un'azienda e ritorna l'id.
  async function createAzienda(
    jwt: string,
    body: Record<string, unknown> = VALID,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body)
      .expect(201);
    return res.body.data.id as string;
  }

  it('1. POST /aziende create OK 201 + body shape', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      codice: 'AZ001',
      nome: 'Rossi Srl',
      tipoCliente: 'azienda',
      attivo: true,
    });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]+$/);
    expect(res.body.data.tenantId).toBeTruthy();
  });

  it('2. GET /aziende list ritorna le aziende del tenant', async () => {
    await createAzienda(adminJwt, { ...VALID, codice: 'AZ001', nome: 'Rossi Srl' });
    await createAzienda(adminJwt, { codice: 'AZ002', nome: 'Bianchi Spa', tipoCliente: 'azienda' });

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    const codici = res.body.data.map((a: { codice: string }) => a.codice);
    expect(codici).toContain('AZ001');
    expect(codici).toContain('AZ002');
  });

  it('3. GET /aziende/:id getById OK', async () => {
    const id = await createAzienda(adminJwt);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.codice).toBe('AZ001');
  });

  it('4. GET /aziende/:id 404 E_AZIENDA_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/019ea000-0000-7000-8000-000000000000`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');
  });

  it('5. POST /aziende dup codice → 409 E_AZIENDA_CODICE_EXISTS', async () => {
    await createAzienda(adminJwt);

    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ codice: 'AZ001', nome: 'Altro', tipoCliente: 'azienda' });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_AZIENDA_CODICE_EXISTS');
  });

  it('6. PATCH /aziende/:id update nome → 200', async () => {
    const id = await createAzienda(adminJwt);

    const res = await request(app.getHttpServer())
      .patch(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ nome: 'Rossi Srl Aggiornata' });

    expect(res.status).toBe(200);
    expect(res.body.data.nome).toBe('Rossi Srl Aggiornata');
    expect(res.body.data.codice).toBe('AZ001');
  });

  it('7. DELETE /aziende/:id soft-delete → 200 { id, deleted: true }', async () => {
    const id = await createAzienda(adminJwt);

    const res = await request(app.getHttpServer())
      .delete(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, deleted: true });
  });

  it('8. GET /aziende post-delete non include la soft-deleted', async () => {
    const id = await createAzienda(adminJwt);
    await request(app.getHttpServer())
      .delete(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.find((a: { id: string }) => a.id === id)).toBeUndefined();
  });

  it('9. POST /aziende ricrea codice della soft-deleted → 201 (partial-unique soft-delete-aware)', async () => {
    const id = await createAzienda(adminJwt);
    await request(app.getHttpServer())
      .delete(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ codice: 'AZ001', nome: 'Rossi Srl Nuova', tipoCliente: 'azienda' });

    expect(res.status).toBe(201);
    expect(res.body.data.codice).toBe('AZ001');
    expect(res.body.data.id).not.toBe(id);
  });

  it('10. DELETE /aziende/:id come viewer (solo visualizza) → 403', async () => {
    const id = await createAzienda(adminJwt);

    const res = await request(app.getHttpServer())
      .delete(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${viewerJwt}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('11. Isolamento applicativo: admin tenant B non vede le aziende di A', async () => {
    await createAzienda(adminJwt, { codice: 'AZ001', nome: 'Rossi Srl', tipoCliente: 'azienda' });

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${tenantBAdminJwt}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });
});
