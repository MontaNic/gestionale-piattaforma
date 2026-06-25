// =============================================================================
// prestazioni-crud.e2e-spec.ts (ADR-0053) — E2E timesheet/prestazioni
// =============================================================================
// Full AppModule bootstrap (Testcontainers) + supertest. Le prestazioni vivono
// sotto /mandati/:id/prestazioni; il mandato nasce da preventivo accettato.
// Coverage (ADR-0052 CHECK-BE-1 RBAC + CHECK-BE-2 soft-delete):
//   1.  POST prestazione su mandato in_corso → 201, userId = autore
//   2.  POST con viewer (prestazioni.visualizza) → 403            [CHECK-BE-1]
//   3.  POST su mandato non-in_corso (concluso) → 400 E_MANDATO_NOT_IN_CORSO
//   4.  GET lista prestazioni del mandato
//   5.  GET cross-tenant (mandato di A da B) → 404               [CHECK-BE-1]
//   6.  PATCH prestazione → 200
//   7.  DELETE → soft-delete: lista non la mostra + GET 404      [CHECK-BE-2]
//   8.  POST senza importo → 201 (importo null)
//   9.  POST con voceId di un altro preventivo → 400 E_PRESTAZIONE_VOCE_INVALID
//   10. update senza guard in_corso: PATCH su mandato concluso → 200
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
  PRESTAZIONI_ADMIN_CODES,
  createAziendaViaApi,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedPrestazioniViewer,
} from './helpers/prestazioni-test-fixtures';

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
const VALID_PREST = { data: '2026-06-26', ore: 3.5, descrizione: 'Analisi bilancio' };

describe('Prestazioni CRUD E2E — /api/v1/mandati/:id/prestazioni', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminAJwt: string;
  let viewerJwt: string;
  let adminBJwt: string;
  let aziendaId: string;
  let mandatoId: string;

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
      roleName: 'Prestazioni Admin',
      codes: [...PRESTAZIONI_ADMIN_CODES],
    });
    const viewer = await seedPrestazioniViewer(containers.databaseUrl, {
      tenantId: seedA.tenantId,
    });

    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      roleName: 'Prestazioni Admin',
      codes: [...PRESTAZIONI_ADMIN_CODES],
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'studio-demo', viewer.email, viewer.password);
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');

    aziendaId = await createAziendaViaApi(app, adminAJwt);
    mandatoId = await createMandato(adminAJwt, aziendaId, 'PREV-001');
  });

  /** Preventivo → accettato → mandato. Ritorna mandatoId. */
  async function createMandato(jwt: string, azId: string, codice: string): Promise<string> {
    const prev = await request(app.getHttpServer())
      .post(`/api/v1/aziende/${azId}/preventivi`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ codice, oggetto: 'Incarico', voci: PREV_VOCI })
      .expect(201);
    const prevId = prev.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/aziende/${azId}/preventivi/${prevId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ stato: 'accettato' })
      .expect(200);
    const mand = await request(app.getHttpServer())
      .post(`/api/v1/preventivi/${prevId}/mandato`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(201);
    return mand.body.data.id as string;
  }

  function base(mid: string = mandatoId): string {
    return `/api/v1/mandati/${mid}/prestazioni`;
  }
  function post(jwt: string, body: Record<string, unknown> = VALID_PREST, mid?: string) {
    return request(app.getHttpServer())
      .post(base(mid))
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);
  }
  function concludiMandato(jwt: string, mid: string) {
    return request(app.getHttpServer())
      .patch(`/api/v1/mandati/${mid}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ stato: 'concluso' })
      .expect(200);
  }

  it('1. POST prestazione su mandato in_corso → 201, userId autore', async () => {
    const res = await post(adminAJwt);
    expect(res.status).toBe(201);
    expect(Number(res.body.data.ore)).toBe(3.5);
    expect(res.body.data.userId).not.toBeNull();
    expect(res.body.data.mandatoId).toBe(mandatoId);
  });

  it('2. POST con viewer (prestazioni.visualizza) → 403', async () => {
    const res = await post(viewerJwt);
    expect(res.status).toBe(403);
  });

  it('3. POST su mandato non-in_corso (concluso) → 400', async () => {
    await concludiMandato(adminAJwt, mandatoId);
    const res = await post(adminAJwt);
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_MANDATO_NOT_IN_CORSO');
  });

  it('4. GET lista prestazioni del mandato', async () => {
    await post(adminAJwt).expect(201);
    await post(adminAJwt, { ...VALID_PREST, ore: 1 }).expect(201);
    const res = await request(app.getHttpServer())
      .get(base())
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(res.body.data.length).toBe(2);
  });

  it('5. GET cross-tenant (mandato di A da B) → 404', async () => {
    const res = await request(app.getHttpServer())
      .get(base())
      .set('Authorization', `Bearer ${adminBJwt}`);
    expect(res.status).toBe(404);
  });

  it('6. PATCH prestazione → 200', async () => {
    const id = (await post(adminAJwt).expect(201)).body.data.id;
    const res = await request(app.getHttpServer())
      .patch(`${base()}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ ore: 5, importo: 250 })
      .expect(200);
    expect(Number(res.body.data.ore)).toBe(5);
    expect(Number(res.body.data.importo)).toBe(250);
  });

  it('7. DELETE → soft-delete invisibility', async () => {
    const id = (await post(adminAJwt).expect(201)).body.data.id;
    await request(app.getHttpServer())
      .delete(`${base()}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    const list = await request(app.getHttpServer())
      .get(base())
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(list.body.data.find((p: { id: string }) => p.id === id)).toBeUndefined();
    await request(app.getHttpServer())
      .get(`${base()}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(404);
  });

  it('8. POST senza importo → 201 (importo null)', async () => {
    const res = await post(adminAJwt, { data: '2026-06-26', ore: 2, descrizione: 'Senza importo' });
    expect(res.status).toBe(201);
    expect(res.body.data.importo).toBeNull();
  });

  it('9. POST con voceId di un altro preventivo → 400 E_PRESTAZIONE_VOCE_INVALID', async () => {
    // crea un secondo preventivo (diverso) e prendi una sua voce
    const prev2 = await request(app.getHttpServer())
      .post(`/api/v1/aziende/${aziendaId}/preventivi`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ codice: 'PREV-OTHER', oggetto: 'Altro', voci: PREV_VOCI })
      .expect(201);
    const voceAltrui = prev2.body.data.voci[0].id as string;
    const res = await post(adminAJwt, { ...VALID_PREST, voceId: voceAltrui });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_PRESTAZIONE_VOCE_INVALID');
  });

  it('10. update senza guard in_corso: PATCH su mandato concluso → 200', async () => {
    const id = (await post(adminAJwt).expect(201)).body.data.id;
    await concludiMandato(adminAJwt, mandatoId);
    const res = await request(app.getHttpServer())
      .patch(`${base()}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ descrizione: 'Corretta a posteriori' })
      .expect(200);
    expect(res.body.data.descrizione).toBe('Corretta a posteriori');
  });
});
