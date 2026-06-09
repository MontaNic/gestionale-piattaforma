// =============================================================================
// referenti-crud.e2e-spec.ts (STOP-c3a) — E2E CRUD referenti nested
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest.
// Satellite 1:N sotto azienda: /api/v1/aziende/:aziendaId/referenti.
// Coverage (mirror di aziende-crud, adattato al nested):
//   1.  POST   create OK 201 + body shape (ruolo/attivo)
//   2.  GET    list ritorna i referenti dell'azienda (ordinati per nome)
//   3.  GET    /:id getById OK 200
//   4.  PATCH  /:id update (ruolo) → 200
//   5.  DELETE /:id soft-delete → 200 { id, deleted: true }
//   6.  GET    list post-delete non include il soft-deleted
//   7.  parent 404: list/create su aziendaId inesistente → 404 E_AZIENDA_NOT_FOUND
//   8.  self 404: getById su referente inesistente → 404 E_REFERENTE_NOT_FOUND
//   9.  scoping nested: referente di azienda X non raggiungibile via azienda Y → 404
//   10. isolamento applicativo: admin tenant B non vede i referenti di A
//   11. RBAC-403: viewer (solo visualizza) → create/delete 403
//
// NB TD-BS Sub-2: niente test validation 400 (ValidationPipe inattiva in e2e,
// coperto dagli unit DTO). Suite superuser (TD-BV): isolamento applicativo.
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
  createAziendaViaApi,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedViewer,
} from './helpers/referenti-test-fixtures';

const VALID = {
  nome: 'Mario Rossi',
  ruolo: 'amministrativo',
  email: 'mario.rossi@example.com',
};

function base(aziendaId: string): string {
  return `/api/v1/aziende/${aziendaId}/referenti`;
}

describe('Referenti CRUD E2E — /api/v1/aziende/:aziendaId/referenti', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminJwt: string;
  let viewerJwt: string;
  let tenantBAdminJwt: string;
  let aziendaId: string;

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
    // Viewer su tenant A (solo visualizza) → 403 su create/delete
    const viewer = await seedViewer(containers.databaseUrl, { tenantId: seedA.tenantId });

    // Tenant B (studio-acme) + admin con i permessi (per l'isolamento)
    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'studio-demo', viewer.email, viewer.password);
    tenantBAdminJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');

    // Azienda parent (tenant A) per i test nested.
    aziendaId = await createAziendaViaApi(app, adminJwt);
  });

  // Helper: crea un referente sotto l'azienda parent e ritorna l'id.
  async function createReferente(
    jwt: string,
    azId: string = aziendaId,
    body: Record<string, unknown> = VALID,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(base(azId))
      .set('Authorization', `Bearer ${jwt}`)
      .send(body)
      .expect(201);
    return res.body.data.id as string;
  }

  it('1. POST create OK 201 + body shape', async () => {
    const res = await request(app.getHttpServer())
      .post(base(aziendaId))
      .set('Authorization', `Bearer ${adminJwt}`)
      .send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      nome: 'Mario Rossi',
      ruolo: 'amministrativo',
      attivo: true,
      aziendaId,
    });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]+$/);
    expect(res.body.data.tenantId).toBeTruthy();
  });

  it("2. GET list ritorna i referenti dell'azienda (ordinati per nome)", async () => {
    await createReferente(adminJwt, aziendaId, { nome: 'Zeta Uno', ruolo: 'altro' });
    await createReferente(adminJwt, aziendaId, { nome: 'Alfa Due', ruolo: 'tecnico' });

    const res = await request(app.getHttpServer())
      .get(base(aziendaId))
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    const nomi = res.body.data.map((r: { nome: string }) => r.nome);
    expect(nomi).toEqual(['Alfa Due', 'Zeta Uno']);
  });

  it('3. GET /:id getById OK', async () => {
    const id = await createReferente(adminJwt);

    const res = await request(app.getHttpServer())
      .get(`${base(aziendaId)}/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.nome).toBe('Mario Rossi');
  });

  it('4. PATCH /:id update ruolo → 200', async () => {
    const id = await createReferente(adminJwt);

    const res = await request(app.getHttpServer())
      .patch(`${base(aziendaId)}/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ruolo: 'legale_rappresentante' });

    expect(res.status).toBe(200);
    expect(res.body.data.ruolo).toBe('legale_rappresentante');
    expect(res.body.data.nome).toBe('Mario Rossi');
  });

  it('5. DELETE /:id soft-delete → 200 { id, deleted: true }', async () => {
    const id = await createReferente(adminJwt);

    const res = await request(app.getHttpServer())
      .delete(`${base(aziendaId)}/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, deleted: true });
  });

  it('6. GET list post-delete non include il soft-deleted', async () => {
    const id = await createReferente(adminJwt);
    await request(app.getHttpServer())
      .delete(`${base(aziendaId)}/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(base(aziendaId))
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.find((r: { id: string }) => r.id === id)).toBeUndefined();
  });

  it('7. parent 404: create/list su aziendaId inesistente → 404 E_AZIENDA_NOT_FOUND', async () => {
    const ghost = '019ea000-0000-7000-8000-000000000000';

    const listRes = await request(app.getHttpServer())
      .get(base(ghost))
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(listRes.status).toBe(404);
    expect(listRes.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');

    const createRes = await request(app.getHttpServer())
      .post(base(ghost))
      .set('Authorization', `Bearer ${adminJwt}`)
      .send(VALID);
    expect(createRes.status).toBe(404);
    expect(createRes.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');
  });

  it('8. self 404: getById su referente inesistente → 404 E_REFERENTE_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base(aziendaId)}/019ea000-0000-7000-8000-000000000001`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_REFERENTE_NOT_FOUND');
  });

  it('9. scoping nested: referente di azienda X non raggiungibile via azienda Y → 404', async () => {
    const refId = await createReferente(adminJwt);
    // Seconda azienda (stesso tenant) come parent "sbagliato".
    const altraAzienda = await createAziendaViaApi(app, adminJwt, {
      codice: 'AZ999',
      nome: 'Altra Srl',
      tipoCliente: 'azienda',
    });

    const res = await request(app.getHttpServer())
      .get(`${base(altraAzienda)}/${refId}`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_REFERENTE_NOT_FOUND');
  });

  it("10. isolamento applicativo: admin tenant B non raggiunge l'azienda/referenti di A", async () => {
    await createReferente(adminJwt);

    // L'azienda parent appartiene al tenant A → per il tenant B è inesistente.
    const res = await request(app.getHttpServer())
      .get(base(aziendaId))
      .set('Authorization', `Bearer ${tenantBAdminJwt}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');
  });

  it('11. RBAC-403: viewer (solo visualizza) → create/delete 403', async () => {
    const id = await createReferente(adminJwt);

    const createRes = await request(app.getHttpServer())
      .post(base(aziendaId))
      .set('Authorization', `Bearer ${viewerJwt}`)
      .send({ nome: 'Tentativo Viewer', ruolo: 'altro' });
    expect(createRes.status).toBe(403);
    expect(createRes.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');

    const deleteRes = await request(app.getHttpServer())
      .delete(`${base(aziendaId)}/${id}`)
      .set('Authorization', `Bearer ${viewerJwt}`);
    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });
});
