// =============================================================================
// tariffario-derivazione.e2e-spec.ts (ADR-0055) — E2E derivazione importo
// =============================================================================
// Verifica che Prestazione.importo sia derivato dal tariffario (ore × tariffa
// risolta per l'autore), con precedenza: importo manuale > derivato > null.
// Catena: azienda → preventivo accettato → mandato in_corso → prestazione.
// Coverage:
//   1. role-scoped: tariffa 50, ore 2, no importo → importo 100
//   2. importo manuale vince: tariffa 50, ore 2, importo 999 → 999
//   3. override utente vince sul ruolo: ruolo 50 + utente 80 → ore 2 → 160
//   4. nessuna tariffa → importo null
//   5. tie-break multi-ruolo: due ruoli (50, 70) → usa la più alta → ore 2 → 140
//   6. update: ore cambia senza importo → ricalcolo (ore 4 × 50 = 200)
//   7. update: importo esplicito vince sul ricalcolo
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
import {
  TARIFFE_DERIV_ADMIN_CODES,
  createAziendaViaApi,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
} from './helpers/tariffe-test-fixtures';

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
const PREST = { data: '2026-06-26', ore: 2, descrizione: 'Analisi' };

describe('Tariffario → derivazione importo prestazioni E2E', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminJwt: string;
  let roleId: string;
  let adminUserId: string;
  let tenantId: string;
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
    const seed = await seedMinimal(containers.databaseUrl);
    const perms = await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seed.tenantId,
      userId: seed.adminUserId,
      roleName: 'Tariffe Deriv Admin',
      codes: [...TARIFFE_DERIV_ADMIN_CODES],
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    roleId = perms.roleId;
    adminUserId = seed.adminUserId;
    tenantId = seed.tenantId;

    const aziendaId = await createAziendaViaApi(app, adminJwt);
    mandatoId = await createMandato(adminJwt, aziendaId, 'PREV-001');
  });

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

  function postTariffa(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/tariffe')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send(body);
  }
  function postPrestazione(body: Record<string, unknown> = PREST) {
    return request(app.getHttpServer())
      .post(`/api/v1/mandati/${mandatoId}/prestazioni`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send(body);
  }

  it('1. role-scoped: tariffa 50, ore 2, no importo → importo 100', async () => {
    await postTariffa({ roleId, tariffaOraria: 50 }).expect(201);
    const res = await postPrestazione().expect(201);
    expect(Number(res.body.data.importo)).toBe(100);
  });

  it('2. importo manuale vince sul tariffario', async () => {
    await postTariffa({ roleId, tariffaOraria: 50 }).expect(201);
    const res = await postPrestazione({ ...PREST, importo: 999 }).expect(201);
    expect(Number(res.body.data.importo)).toBe(999);
  });

  it('3. override utente vince sul ruolo', async () => {
    await postTariffa({ roleId, tariffaOraria: 50 }).expect(201);
    await postTariffa({ userId: adminUserId, tariffaOraria: 80 }).expect(201);
    const res = await postPrestazione().expect(201);
    expect(Number(res.body.data.importo)).toBe(160);
  });

  it('4. nessuna tariffa → importo null', async () => {
    const res = await postPrestazione().expect(201);
    expect(res.body.data.importo).toBeNull();
  });

  it('5. tie-break multi-ruolo → usa la tariffa più alta', async () => {
    // Secondo ruolo assegnato all'admin, con tariffa più alta.
    const perms2 = await seedAziendePermissions(containers.databaseUrl, {
      tenantId,
      userId: adminUserId,
      roleName: 'Secondo Ruolo',
      codes: ['prestazioni.visualizza'],
    });
    await postTariffa({ roleId, tariffaOraria: 50 }).expect(201);
    await postTariffa({ roleId: perms2.roleId, tariffaOraria: 70 }).expect(201);
    const res = await postPrestazione().expect(201);
    expect(Number(res.body.data.importo)).toBe(140); // 2 × max(50,70)
  });

  it('6. update: ore cambia senza importo → ricalcolo', async () => {
    await postTariffa({ roleId, tariffaOraria: 50 }).expect(201);
    const id = (await postPrestazione().expect(201)).body.data.id;
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/mandati/${mandatoId}/prestazioni/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ore: 4 })
      .expect(200);
    expect(Number(res.body.data.importo)).toBe(200); // 4 × 50
  });

  it('7. update: importo esplicito vince sul ricalcolo', async () => {
    await postTariffa({ roleId, tariffaOraria: 50 }).expect(201);
    const id = (await postPrestazione().expect(201)).body.data.id;
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/mandati/${mandatoId}/prestazioni/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ore: 4, importo: 5 })
      .expect(200);
    expect(Number(res.body.data.importo)).toBe(5);
  });
});
