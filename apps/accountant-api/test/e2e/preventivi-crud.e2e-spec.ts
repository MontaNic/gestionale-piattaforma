// =============================================================================
// preventivi-crud.e2e-spec.ts (STOP-e1) — E2E CRUD preventivi (testata + voci)
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest.
// Prima entità con business logic del verticale: ricalcolo totali server-side
// in tx atomica. Le voci viaggiano nel payload della testata (DP-e1-1).
// Coverage:
//   1.  create con 2 voci → 201, totali testata corretti (server-calc)
//   2.  create → totaleRiga per voce corretto
//   3.  list → preventivi dell'azienda (createdAt desc)
//   4.  getById → include voci ordinate per `ordine`
//   5.  update testata-only (no voci) → totali invariati, stato cambiato
//   6.  update con `voci` → replace integrale + ricalcolo totali
//   7.  softDelete → 200 {id,deleted:true} → list non lo include
//   8.  parent 404: create/list su aziendaId inesistente → E_AZIENDA_NOT_FOUND
//   9.  self 404: getById preventivo inesistente → E_PREVENTIVO_NOT_FOUND
//   10. codice duplicato → 409 E_PREVENTIVO_CODICE_EXISTS
//   11. isolamento: preventivo di tenant A non raggiungibile da tenant B
//   12. RBAC: viewer (solo preventivi.visualizza) → create 403
//
// NB TD-BS Sub-2: niente test validation 400 (ValidationPipe inattiva in e2e).
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
  PREVENTIVI_ADMIN_CODES,
  createAziendaViaApi,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedPreventiviViewer,
} from './helpers/preventivi-test-fixtures';

// 2 voci con numeri verificabili:
//   voce 1: 2 × 100, -10% → riga 180, iva 22% → 39.6
//   voce 2: 1 × 50,  -0%  → riga 50,  iva 22% → 11.0
//   imponibile 230 · iva 50.6 · totale 280.6
const VALID = {
  codice: 'PREV-001',
  oggetto: 'Consulenza fiscale 2026',
  voci: [
    {
      nome: 'Consulenza',
      unitaMisura: 'ora',
      quantita: 2,
      prezzoUnitario: 100,
      scontoPct: 10,
      ivaAliquota: 22,
    },
    {
      nome: 'Setup pratica',
      unitaMisura: 'forfait',
      quantita: 1,
      prezzoUnitario: 50,
      scontoPct: 0,
      ivaAliquota: 22,
    },
  ],
};

function base(aziendaId: string): string {
  return `/api/v1/aziende/${aziendaId}/preventivi`;
}

describe('Preventivi CRUD E2E — /api/v1/aziende/:aziendaId/preventivi', () => {
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

    // Tenant A (studio-demo) + admin con anagrafica.* + preventivi.*
    const seedA = await seedMinimal(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
      roleName: 'Preventivi Admin',
      codes: [...PREVENTIVI_ADMIN_CODES],
    });
    // Viewer su tenant A (solo preventivi.visualizza) → 403 sul create
    const viewer = await seedPreventiviViewer(containers.databaseUrl, { tenantId: seedA.tenantId });

    // Tenant B (studio-acme) + admin con gli stessi permessi (per l'isolamento)
    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      roleName: 'Preventivi Admin',
      codes: [...PREVENTIVI_ADMIN_CODES],
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'studio-demo', viewer.email, viewer.password);
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');

    // Azienda parent (tenant A) per i test nested.
    aziendaId = await createAziendaViaApi(app, adminAJwt);
  });

  async function createPreventivo(
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

  it('1. create con 2 voci → 201 + totali testata server-calc', async () => {
    const res = await request(app.getHttpServer())
      .post(base(aziendaId))
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.data.codice).toBe('PREV-001');
    expect(res.body.data.aziendaId).toBe(aziendaId);
    expect(res.body.data.stato).toBe('bozza');
    expect(Number(res.body.data.totaleImponibile)).toBeCloseTo(230, 2);
    expect(Number(res.body.data.totaleIva)).toBeCloseTo(50.6, 2);
    expect(Number(res.body.data.totale)).toBeCloseTo(280.6, 2);
    expect(res.body.data.voci).toHaveLength(2);
  });

  it('2. create → totaleRiga per voce corretto', async () => {
    const res = await request(app.getHttpServer())
      .post(base(aziendaId))
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send(VALID)
      .expect(201);

    const voci = res.body.data.voci as Array<{ nome: string; totaleRiga: string; ordine: number }>;
    const byOrdine = [...voci].sort((a, b) => a.ordine - b.ordine);
    expect(Number(byOrdine[0].totaleRiga)).toBeCloseTo(180, 2);
    expect(Number(byOrdine[1].totaleRiga)).toBeCloseTo(50, 2);
  });

  it("3. list → preventivi dell'azienda (createdAt desc)", async () => {
    await createPreventivo(adminAJwt, aziendaId, { ...VALID, codice: 'PREV-001' });
    await createPreventivo(adminAJwt, aziendaId, { ...VALID, codice: 'PREV-002' });

    const res = await request(app.getHttpServer())
      .get(base(aziendaId))
      .set('Authorization', `Bearer ${adminAJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const codici = res.body.data.map((p: { codice: string }) => p.codice);
    expect(codici).toContain('PREV-001');
    expect(codici).toContain('PREV-002');
  });

  it('4. getById → include voci ordinate per ordine', async () => {
    const id = await createPreventivo(adminAJwt);

    const res = await request(app.getHttpServer())
      .get(`${base(aziendaId)}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.voci).toHaveLength(2);
    const ordini = res.body.data.voci.map((v: { ordine: number }) => v.ordine);
    expect(ordini).toEqual([...ordini].sort((a, b) => a - b));
  });

  it('5. update testata-only (no voci) → totali invariati, stato cambiato', async () => {
    const id = await createPreventivo(adminAJwt);

    const res = await request(app.getHttpServer())
      .patch(`${base(aziendaId)}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ stato: 'inviato' });

    expect(res.status).toBe(200);
    expect(res.body.data.stato).toBe('inviato');
    expect(Number(res.body.data.totaleImponibile)).toBeCloseTo(230, 2);
    expect(Number(res.body.data.totale)).toBeCloseTo(280.6, 2);
    expect(res.body.data.voci).toHaveLength(2);
  });

  it('6. update con voci → replace integrale + ricalcolo totali', async () => {
    const id = await createPreventivo(adminAJwt);

    const res = await request(app.getHttpServer())
      .patch(`${base(aziendaId)}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({
        voci: [
          {
            nome: 'Pacchetto annuale',
            unitaMisura: 'anno',
            quantita: 1,
            prezzoUnitario: 1000,
            scontoPct: 0,
            ivaAliquota: 22,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.voci).toHaveLength(1);
    expect(res.body.data.voci[0].nome).toBe('Pacchetto annuale');
    expect(Number(res.body.data.totaleImponibile)).toBeCloseTo(1000, 2);
    expect(Number(res.body.data.totaleIva)).toBeCloseTo(220, 2);
    expect(Number(res.body.data.totale)).toBeCloseTo(1220, 2);
  });

  it('7. softDelete → 200 {id,deleted:true} → list non lo include', async () => {
    const id = await createPreventivo(adminAJwt);

    const del = await request(app.getHttpServer())
      .delete(`${base(aziendaId)}/${id}`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ id, deleted: true });

    const list = await request(app.getHttpServer())
      .get(base(aziendaId))
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    expect(list.body.data.find((p: { id: string }) => p.id === id)).toBeUndefined();
  });

  it('8. parent 404: create/list su aziendaId inesistente → E_AZIENDA_NOT_FOUND', async () => {
    const ghost = '019ea000-0000-7000-8000-000000000000';

    const listRes = await request(app.getHttpServer())
      .get(base(ghost))
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(listRes.status).toBe(404);
    expect(listRes.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');

    const createRes = await request(app.getHttpServer())
      .post(base(ghost))
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send(VALID);
    expect(createRes.status).toBe(404);
    expect(createRes.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');
  });

  it('9. self 404: getById preventivo inesistente → E_PREVENTIVO_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base(aziendaId)}/019ea000-0000-7000-8000-000000000001`)
      .set('Authorization', `Bearer ${adminAJwt}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_PREVENTIVO_NOT_FOUND');
  });

  it('10. codice duplicato → 409 E_PREVENTIVO_CODICE_EXISTS', async () => {
    await createPreventivo(adminAJwt);

    const res = await request(app.getHttpServer())
      .post(base(aziendaId))
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ ...VALID, oggetto: 'Altro oggetto' });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_PREVENTIVO_CODICE_EXISTS');
  });

  it('11. isolamento: preventivo di tenant A non raggiungibile da tenant B', async () => {
    await createPreventivo(adminAJwt);

    // L'azienda parent è del tenant A → per il tenant B è inesistente.
    const res = await request(app.getHttpServer())
      .get(base(aziendaId))
      .set('Authorization', `Bearer ${adminBJwt}`);
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');
  });

  it('12. RBAC: viewer (solo preventivi.visualizza) → create 403', async () => {
    const res = await request(app.getHttpServer())
      .post(base(aziendaId))
      .set('Authorization', `Bearer ${viewerJwt}`)
      .send(VALID);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });
});
