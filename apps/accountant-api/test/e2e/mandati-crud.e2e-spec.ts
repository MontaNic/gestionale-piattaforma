// =============================================================================
// mandati-crud.e2e-spec.ts (ADR-0051) — E2E mandati/incarichi
// =============================================================================
// Full AppModule bootstrap (Testcontainers) + supertest. Il mandato nasce da un
// preventivo ACCETTATO (POST /preventivi/:id/mandato).
// Coverage:
//   1.  POST mandato da preventivo accettato → 201, codice RDL-<anno>-0001, preventivo→convertito
//   2.  POST da preventivo non-accettato (bozza) → 400 E_MANDATO_PREVENTIVO_NOT_ACCEPTED
//   3.  doppio POST stesso preventivo → 400 (ora è convertito, non più accettato)
//   4.  counter per-anno incrementa → secondo mandato RDL-<anno>-0002
//   5.  GET /mandati → lista
//   6.  GET /mandati/:id cross-tenant → 404 (isolamento)
//   7.  PATCH /mandati/:id → stato aggiornato
//   8.  DELETE /mandati/:id → soft-delete
//   9.  RBAC: viewer (mandati.visualizza) → POST 403
//   10. isolamento: tenant B non vede i mandati di A
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
  MANDATI_ADMIN_CODES,
  createAziendaViaApi,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedMandatiViewer,
} from './helpers/mandati-test-fixtures';

const PREV_VOCI = [
  {
    nome: 'Consulenza',
    unitaMisura: 'ora',
    quantita: 2,
    prezzoUnitario: 100,
    scontoPct: 0,
    ivaAliquota: 22,
  },
];
const ANNO = new Date().getFullYear();

describe('Mandati CRUD E2E — /api/v1/mandati', () => {
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

    const seedA = await seedMinimal(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
      roleName: 'Mandati Admin',
      codes: [...MANDATI_ADMIN_CODES],
    });
    const viewer = await seedMandatiViewer(containers.databaseUrl, { tenantId: seedA.tenantId });

    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      roleName: 'Mandati Admin',
      codes: [...MANDATI_ADMIN_CODES],
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'studio-demo', viewer.email, viewer.password);
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');

    aziendaId = await createAziendaViaApi(app, adminAJwt);
  });

  /** Crea un preventivo e lo porta a stato `accettato`. Ritorna l'id. */
  async function createAcceptedPreventivo(
    jwt: string,
    azId: string,
    codice: string,
  ): Promise<string> {
    const create = await request(app.getHttpServer())
      .post(`/api/v1/aziende/${azId}/preventivi`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ codice, oggetto: 'Incarico test', voci: PREV_VOCI })
      .expect(201);
    const id = create.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/aziende/${azId}/preventivi/${id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ stato: 'accettato' })
      .expect(200);
    return id;
  }

  function createMandato(jwt: string, preventivoId: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/preventivi/${preventivoId}/mandato`)
      .set('Authorization', `Bearer ${jwt}`);
  }

  it('1. POST mandato da preventivo accettato → 201, codice RDL, preventivo→convertito', async () => {
    const prevId = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-001');
    const res = await createMandato(adminAJwt, prevId);
    expect(res.status).toBe(201);
    expect(res.body.data.codice).toBe(`RDL-${ANNO}-0001`);
    expect(res.body.data.stato).toBe('in_corso');
    expect(Number(res.body.data.importoConcordato)).toBeGreaterThan(0);

    // preventivo ora convertito
    const prev = await request(app.getHttpServer())
      .get(`/api/v1/aziende/${aziendaId}/preventivi/${prevId}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(prev.body.data.stato).toBe('convertito');
  });

  it('2. POST da preventivo non-accettato (bozza) → 400', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/v1/aziende/${aziendaId}/preventivi`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ codice: 'PREV-BOZZA', oggetto: 'Bozza', voci: PREV_VOCI })
      .expect(201);
    const res = await createMandato(adminAJwt, create.body.data.id);
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_MANDATO_PREVENTIVO_NOT_ACCEPTED');
  });

  it('3. doppio POST stesso preventivo → 400 (già convertito)', async () => {
    const prevId = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-DUP');
    await createMandato(adminAJwt, prevId).expect(201);
    const res = await createMandato(adminAJwt, prevId);
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_MANDATO_PREVENTIVO_NOT_ACCEPTED');
  });

  it('4. counter per-anno incrementa → secondo mandato RDL-<anno>-0002', async () => {
    const p1 = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-C1');
    const p2 = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-C2');
    const r1 = await createMandato(adminAJwt, p1).expect(201);
    const r2 = await createMandato(adminAJwt, p2).expect(201);
    expect(r1.body.data.codice).toBe(`RDL-${ANNO}-0001`);
    expect(r2.body.data.codice).toBe(`RDL-${ANNO}-0002`);
  });

  it('5. GET /mandati → lista', async () => {
    const prevId = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-L');
    await createMandato(adminAJwt, prevId).expect(201);
    const res = await request(app.getHttpServer())
      .get('/api/v1/mandati')
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(res.body.data.length).toBe(1);
  });

  it('6. GET /mandati/:id cross-tenant → 404 (isolamento)', async () => {
    const prevId = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-ISO');
    const mandatoId = (await createMandato(adminAJwt, prevId).expect(201)).body.data.id;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/mandati/${mandatoId}`)
      .set('Authorization', `Bearer ${adminBJwt}`);
    expect(res.status).toBe(404);
  });

  it('7. PATCH /mandati/:id → stato aggiornato', async () => {
    const prevId = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-PATCH');
    const mandatoId = (await createMandato(adminAJwt, prevId).expect(201)).body.data.id;
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/mandati/${mandatoId}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ stato: 'concluso', note: 'Chiuso' })
      .expect(200);
    expect(res.body.data.stato).toBe('concluso');
    expect(res.body.data.note).toBe('Chiuso');
  });

  it('8. DELETE /mandati/:id → soft-delete', async () => {
    const prevId = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-DEL');
    const mandatoId = (await createMandato(adminAJwt, prevId).expect(201)).body.data.id;
    await request(app.getHttpServer())
      .delete(`/api/v1/mandati/${mandatoId}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/mandati/${mandatoId}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(404);
  });

  it('9. RBAC: viewer (mandati.visualizza) → POST 403', async () => {
    const prevId = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-RBAC');
    const res = await createMandato(viewerJwt, prevId);
    expect(res.status).toBe(403);
  });

  it('10. isolamento: tenant B non vede i mandati di A', async () => {
    const prevId = await createAcceptedPreventivo(adminAJwt, aziendaId, 'PREV-B');
    await createMandato(adminAJwt, prevId).expect(201);
    const res = await request(app.getHttpServer())
      .get('/api/v1/mandati')
      .set('Authorization', `Bearer ${adminBJwt}`)
      .expect(200);
    expect(res.body.data.length).toBe(0);
  });
});
