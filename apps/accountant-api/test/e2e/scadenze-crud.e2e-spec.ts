// =============================================================================
// scadenze-crud.e2e-spec.ts (STOP-scad1) — E2E CRUD scadenze + categorie
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest.
// Primo modulo del livello operatore-studio oltre anagrafica/preventivi/dashboard.
// Pattern di riferimento: aziende-crud (CRUD tenant-level + soft-delete) +
// preventivi-crud (viewer RBAC, isolamento).
// Coverage:
//   1.  GET /scadenze → 200 lista vuota (autenticato)
//   2.  POST /scadenze → 201 scadenza globale (visibilita=tutti default)
//   3.  POST /scadenze → 201 scadenza per azienda (visibilita=azienda + aziendaId)
//   4.  POST /scadenze → 400 visibilita=azienda senza aziendaId
//   5.  GET /scadenze/:id → 200
//   6.  PATCH /scadenze/:id → 200 (titolo + stato cambiati)
//   7.  DELETE /scadenze/:id → 200 {id,deleted:true}
//   8.  GET /scadenze/:id dopo delete → 404 E_SCADENZA_NOT_FOUND
//   9.  GET /scadenze?aziendaId=X → lista filtrata
//   10. RBAC: viewer (solo scadenze.visualizza) → GET 200, POST 403
//   11. Isolamento cross-tenant → GET lista tenant B = []
//   12. GET /scadenze/categorie → include categorie piattaforma (tenant_id NULL)
//   13. POST /scadenze/categorie → 201 categoria custom, appare in list
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
  SCADENZE_ADMIN_CODES,
  createAziendaViaApi,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedScadenzeCategoriePiattaforma,
  seedScadenzeViewer,
} from './helpers/scadenze-test-fixtures';

const BASE = '/api/v1/scadenze';

const VALID = {
  titolo: 'Versamento IVA Q2',
  descrizione: 'F24 saldo IVA secondo trimestre',
  dataScadenza: '2026-07-31',
};

describe('Scadenze CRUD E2E — /api/v1/scadenze', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminAJwt: string;
  let viewerJwt: string;
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

    // Categorie piattaforma (tenant_id NULL) — migrate deploy non le seeda.
    await seedScadenzeCategoriePiattaforma(containers.databaseUrl);

    // Tenant A (studio-demo) + admin con anagrafica.cliente.* + scadenze.*
    const seedA = await seedMinimal(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
      roleName: 'Scadenze Admin',
      codes: [...SCADENZE_ADMIN_CODES],
    });
    // Viewer su tenant A (solo scadenze.visualizza) → 403 sul create
    const viewer = await seedScadenzeViewer(containers.databaseUrl, { tenantId: seedA.tenantId });

    // Tenant B (studio-acme) + admin con gli stessi permessi (per l'isolamento)
    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      roleName: 'Scadenze Admin',
      codes: [...SCADENZE_ADMIN_CODES],
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'studio-demo', viewer.email, viewer.password);
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');

    // Azienda parent (tenant A) per i test visibilita='azienda' / filtro.
    aziendaId = await createAziendaViaApi(app, adminAJwt);
  });

  async function createScadenza(
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

  it('1. GET /scadenze → 200 lista vuota (autenticato)', async () => {
    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('2. POST /scadenze → 201 scadenza globale (visibilita=tutti default)', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.data.titolo).toBe('Versamento IVA Q2');
    expect(res.body.data.visibilita).toBe('tutti');
    expect(res.body.data.aziendaId).toBeNull();
    expect(res.body.data.attivo).toBe(true);
  });

  it('3. POST /scadenze → 201 scadenza per azienda (visibilita=azienda + aziendaId)', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ ...VALID, visibilita: 'azienda', aziendaId });

    expect(res.status).toBe(201);
    expect(res.body.data.visibilita).toBe('azienda');
    expect(res.body.data.aziendaId).toBe(aziendaId);
  });

  it('4. POST /scadenze → 400 visibilita=azienda senza aziendaId', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ ...VALID, visibilita: 'azienda' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_SCADENZA_AZIENDA_REQUIRED');
  });

  it('5. GET /scadenze/:id → 200', async () => {
    const id = await createScadenza(adminAJwt);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.titolo).toBe('Versamento IVA Q2');
  });

  it('6. PATCH /scadenze/:id → 200 (titolo + attivo cambiati)', async () => {
    const id = await createScadenza(adminAJwt);

    const res = await request(app.getHttpServer())
      .patch(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ titolo: 'Versamento IVA Q2 (rettifica)', attivo: false });

    expect(res.status).toBe(200);
    expect(res.body.data.titolo).toBe('Versamento IVA Q2 (rettifica)');
    expect(res.body.data.attivo).toBe(false);
  });

  it('7. DELETE /scadenze/:id → 200 {id,deleted:true} → list non lo include', async () => {
    const id = await createScadenza(adminAJwt);

    const del = await request(app.getHttpServer())
      .delete(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ id, deleted: true });

    const list = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(list.body.data.find((s: { id: string }) => s.id === id)).toBeUndefined();
  });

  it('8. GET /scadenze/:id dopo delete → 404 E_SCADENZA_NOT_FOUND', async () => {
    const id = await createScadenza(adminAJwt);
    await request(app.getHttpServer())
      .delete(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_SCADENZA_NOT_FOUND');
  });

  it('9. GET /scadenze?aziendaId=X → lista filtrata', async () => {
    // Una scadenza globale + una per azienda; il filtro aziendaId isola la seconda.
    await createScadenza(adminAJwt, { ...VALID, titolo: 'Globale' });
    const idAzienda = await createScadenza(adminAJwt, {
      ...VALID,
      titolo: 'Per azienda',
      visibilita: 'azienda',
      aziendaId,
    });

    const res = await request(app.getHttpServer())
      .get(`${BASE}?aziendaId=${aziendaId}`)
      .set('Authorization', `Bearer ${adminAJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(idAzienda);
  });

  it('10. RBAC: viewer (solo scadenze.visualizza) → GET 200, POST 403', async () => {
    const getRes = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${viewerJwt}`);
    expect(getRes.status).toBe(200);

    const postRes = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${viewerJwt}`)
      .send(VALID);
    expect(postRes.status).toBe(403);
    expect(postRes.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('11. isolamento: scadenza di tenant A non visibile a tenant B (lista vuota)', async () => {
    await createScadenza(adminAJwt);

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', `Bearer ${adminBJwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('12. GET /scadenze/categorie → include categorie piattaforma (tenant_id NULL)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/categorie`)
      .set('Authorization', `Bearer ${adminAJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(7);
    const nomi = res.body.data.map((c: { nome: string }) => c.nome);
    expect(nomi).toContain('Dichiarativi');
    expect(nomi).toContain('Altro');
    // Le piattaforma hanno tenant_id NULL.
    const dich = res.body.data.find((c: { nome: string }) => c.nome === 'Dichiarativi');
    expect(dich.tenantId).toBeNull();
  });

  it('13. POST /scadenze/categorie → 201 categoria custom, appare in list', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/categorie`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ nome: 'Categoria Studio', colore: '#123456' });

    expect(res.status).toBe(201);
    expect(res.body.data.nome).toBe('Categoria Studio');
    expect(res.body.data.tenantId).not.toBeNull();

    const list = await request(app.getHttpServer())
      .get(`${BASE}/categorie`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    const nomi = list.body.data.map((c: { nome: string }) => c.nome);
    expect(nomi).toContain('Categoria Studio');
    expect(nomi).toContain('Dichiarativi'); // piattaforma ancora presente
  });
});
