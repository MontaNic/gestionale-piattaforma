// =============================================================================
// circolari-crud.e2e-spec.ts (ADR-0045) — E2E CRUD + macchina di stato circolari
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest.
// Verticale accountant livello 1 (operatore-studio). Pattern di riferimento:
// scadenze-crud (CRUD tenant-level + soft-delete + viewer RBAC + isolamento).
// Coverage:
//   1.  GET /circolari → 200 lista vuota
//   2.  POST /circolari → 201 bozza (destinatari tutti) — stato=bozza, pubblicataIl null
//   3.  POST /circolari → 201 con destinatario azienda
//   4.  POST /circolari → 400 destinatario azienda senza aziendaId (business rule)
//   5.  GET /circolari/:id → 200 (+ destinatari)
//   6.  PATCH /circolari/:id → 200 (titolo cambiato, su bozza)
//   7.  POST /circolari/:id/publish → 200 stato=pubblicata + pubblicataIl
//   8.  PATCH /circolari/:id dopo publish → 422 E_CIRCOLARE_NOT_EDITABLE
//   9.  POST /circolari/:id/archive → 200 stato=archiviata
//   10. POST /circolari/:id/publish su già pubblicata → 422 E_CIRCOLARE_NOT_BOZZA
//   11. DELETE /circolari/:id (bozza) → 200 {id,deleted:true} → non in list
//   12. DELETE /circolari/:id (pubblicata) → 422 E_CIRCOLARE_NOT_BOZZA
//   13. GET /circolari/:id dopo delete → 404 E_CIRCOLARE_NOT_FOUND
//   14. GET /circolari?stato=bozza → lista filtrata
//   15. RBAC: redattore (solo circolari.create) → POST create 201, POST publish 403
//   16. isolamento cross-tenant → lista tenant B = []
//
// NB TD-BS Sub-2: niente test validation 400 da DTO (ValidationPipe inattiva in
// e2e). Il 400 di #4 viene dal service (business rule), non dalla pipe.
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
  CIRCOLARI_ADMIN_CODES,
  createAziendaViaApi,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedCircolariRedattore,
} from './helpers/circolari-test-fixtures';

const BASE = '/api/v1/circolari';

const VALID = {
  titolo: 'Aggiornamento normativo Q3',
  oggettoEmail: 'Novità fiscali del terzo trimestre',
  bodyHtml: '<p>Gentili clienti, ecco gli aggiornamenti.</p>',
  destinatari: [{ tipo: 'tutti' }],
};

describe('Circolari CRUD E2E — /api/v1/circolari', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminAJwt: string;
  let redattoreJwt: string;
  let adminBJwt: string;
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

    // Tenant A (studio-demo) + admin con anagrafica.cliente.* + circolari.*
    const seedA = await seedMinimal(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
      roleName: 'Circolari Admin',
      codes: [...CIRCOLARI_ADMIN_CODES],
    });
    // Redattore su tenant A (solo circolari.create) → 403 sul publish
    const redattore = await seedCircolariRedattore(containers.databaseUrl, {
      tenantId: seedA.tenantId,
    });

    // Tenant B (studio-acme) + admin con gli stessi permessi (per l'isolamento)
    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      roleName: 'Circolari Admin',
      codes: [...CIRCOLARI_ADMIN_CODES],
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    redattoreJwt = await loginAs(app, 'studio-demo', redattore.email, redattore.password);
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');

    // Azienda parent (tenant A) per il destinatario tipo='azienda'.
    aziendaId = await createAziendaViaApi(app, adminAJwt);
  });

  async function createCircolare(
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

  // Non-async: ritorna il supertest Test (thenable + chainable .expect()).
  function publish(jwt: string, id: string) {
    return request(app.getHttpServer())
      .post(`${BASE}/${id}/publish`)
      .set('Authorization', `Bearer ${jwt}`);
  }

  it('1. GET /circolari → 200 lista vuota', async () => {
    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('2. POST /circolari → 201 bozza (destinatari tutti), pubblicataIl null', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send(VALID);
    expect(res.status).toBe(201);
    expect(res.body.data.titolo).toBe('Aggiornamento normativo Q3');
    expect(res.body.data.stato).toBe('bozza');
    expect(res.body.data.pubblicataIl).toBeNull();
    expect(res.body.data.destinatari).toHaveLength(1);
    expect(res.body.data.destinatari[0].tipo).toBe('tutti');
  });

  it('3. POST /circolari → 201 con destinatario azienda', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ ...VALID, destinatari: [{ tipo: 'azienda', aziendaId }] });
    expect(res.status).toBe(201);
    expect(res.body.data.destinatari[0].tipo).toBe('azienda');
    expect(res.body.data.destinatari[0].aziendaId).toBe(aziendaId);
  });

  it('4. POST /circolari → 400 destinatario azienda senza aziendaId', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ ...VALID, destinatari: [{ tipo: 'azienda' }] });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_CIRCOLARE_DESTINATARIO_AZIENDA_REQUIRED');
  });

  it('5. GET /circolari/:id → 200 (+ destinatari)', async () => {
    const id = await createCircolare(adminAJwt);
    const res = await request(app.getHttpServer())
      .get(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.destinatari).toHaveLength(1);
  });

  it('6. PATCH /circolari/:id → 200 (titolo cambiato, su bozza)', async () => {
    const id = await createCircolare(adminAJwt);
    const res = await request(app.getHttpServer())
      .patch(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ titolo: 'Aggiornamento normativo Q3 (rev)' });
    expect(res.status).toBe(200);
    expect(res.body.data.titolo).toBe('Aggiornamento normativo Q3 (rev)');
    expect(res.body.data.stato).toBe('bozza');
  });

  it('7. POST /circolari/:id/publish → 200 stato=pubblicata + pubblicataIl', async () => {
    const id = await createCircolare(adminAJwt);
    const res = await publish(adminAJwt, id);
    expect(res.status).toBe(200);
    expect(res.body.data.stato).toBe('pubblicata');
    expect(res.body.data.pubblicataIl).not.toBeNull();
  });

  it('8. PATCH /circolari/:id dopo publish → 422 E_CIRCOLARE_NOT_EDITABLE', async () => {
    const id = await createCircolare(adminAJwt);
    await publish(adminAJwt, id).expect(200);

    const res = await request(app.getHttpServer())
      .patch(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ titolo: 'tardi' });
    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('E_CIRCOLARE_NOT_EDITABLE');
  });

  it('9. POST /circolari/:id/archive → 200 stato=archiviata', async () => {
    const id = await createCircolare(adminAJwt);
    await publish(adminAJwt, id).expect(200);

    const res = await request(app.getHttpServer())
      .post(`${BASE}/${id}/archive`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data.stato).toBe('archiviata');
  });

  it('10. POST /circolari/:id/publish su già pubblicata → 422 E_CIRCOLARE_NOT_BOZZA', async () => {
    const id = await createCircolare(adminAJwt);
    await publish(adminAJwt, id).expect(200);

    const res = await publish(adminAJwt, id);
    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('E_CIRCOLARE_NOT_BOZZA');
  });

  it('11. DELETE /circolari/:id (bozza) → 200 {id,deleted:true} → non in list', async () => {
    const id = await createCircolare(adminAJwt);
    const del = await request(app.getHttpServer())
      .delete(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ id, deleted: true });

    const list = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(list.body.data.find((c: { id: string }) => c.id === id)).toBeUndefined();
  });

  it('12. DELETE /circolari/:id (pubblicata) → 422 E_CIRCOLARE_NOT_BOZZA', async () => {
    const id = await createCircolare(adminAJwt);
    await publish(adminAJwt, id).expect(200);

    const res = await request(app.getHttpServer())
      .delete(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('E_CIRCOLARE_NOT_BOZZA');
  });

  it('13. GET /circolari/:id dopo delete → 404 E_CIRCOLARE_NOT_FOUND', async () => {
    const id = await createCircolare(adminAJwt);
    await request(app.getHttpServer())
      .delete(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_CIRCOLARE_NOT_FOUND');
  });

  it('14. GET /circolari?stato=bozza → lista filtrata', async () => {
    const bozzaId = await createCircolare(adminAJwt, { ...VALID, titolo: 'Resta bozza' });
    const pubId = await createCircolare(adminAJwt, { ...VALID, titolo: 'Da pubblicare' });
    await publish(adminAJwt, pubId).expect(200);

    const res = await request(app.getHttpServer())
      .get(`${BASE}?stato=bozza`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(bozzaId);
  });

  it('15. RBAC: redattore (solo circolari.create) → create 201, publish 403', async () => {
    const id = await createCircolare(redattoreJwt);

    const pubRes = await publish(redattoreJwt, id);
    expect(pubRes.status).toBe(403);
    expect(pubRes.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('16. isolamento: circolare di tenant A non visibile a tenant B (lista vuota)', async () => {
    await createCircolare(adminAJwt);

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${adminBJwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
