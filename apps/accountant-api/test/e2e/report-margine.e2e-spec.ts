// =============================================================================
// report-margine.e2e-spec.ts (ADR-0054) — E2E report margine
// =============================================================================
// Full AppModule bootstrap (Testcontainers) + supertest. Read-only aggregazione.
// Coverage (ADR-0052 CHECK-BE-1 RBAC adattato a endpoint read-only):
//   1.  Aggregazione corretta: oreTotali, importoPrestazioni, margine + caso null
//   2.  RBAC: con report.operativo.visualizza → 200; senza → 403
//   3.  Isolamento cross-tenant: B non vede i mandati di A
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
  REPORT_ADMIN_CODES,
  createAziendaViaApi,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedReportNoAccessUser,
} from './helpers/report-test-fixtures';

const PREV_VOCI = [
  // 2h × 100, sconto 0, iva 22% → imponibile 200, iva 44, totale 244 = importoConcordato
  {
    nome: 'Consulenza',
    unitaMisura: 'ora',
    quantita: 2,
    prezzoUnitario: 100,
    scontoPct: 0,
    ivaAliquota: 22,
  },
];
const MARGINE = '/api/v1/report/margine';

interface MargineRow {
  mandatoId: string;
  importoConcordato: number;
  oreTotali: number;
  importoPrestazioni: number | null;
  margine: number | null;
}

describe('Report margine E2E — /api/v1/report/margine', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminAJwt: string;
  let noAccessJwt: string;
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
      roleName: 'Report Admin',
      codes: [...REPORT_ADMIN_CODES],
    });
    const noAccess = await seedReportNoAccessUser(containers.databaseUrl, {
      tenantId: seedA.tenantId,
    });

    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      roleName: 'Report Admin',
      codes: [...REPORT_ADMIN_CODES],
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    noAccessJwt = await loginAs(app, 'studio-demo', noAccess.email, noAccess.password);
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');

    aziendaId = await createAziendaViaApi(app, adminAJwt);
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

  function addPrestazione(
    jwt: string,
    mandatoId: string,
    body: Record<string, unknown>,
  ): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/mandati/${mandatoId}/prestazioni`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body)
      .expect(201);
  }

  it('1. aggregazione corretta (oreTotali, importoPrestazioni, margine + caso null)', async () => {
    const m1 = await createMandato(adminAJwt, aziendaId, 'PREV-1');
    await addPrestazione(adminAJwt, m1, {
      data: '2026-06-26',
      ore: 3,
      descrizione: 'a',
      importo: 100,
    });
    await addPrestazione(adminAJwt, m1, {
      data: '2026-06-26',
      ore: 2,
      descrizione: 'b',
      importo: 50,
    });
    await addPrestazione(adminAJwt, m1, { data: '2026-06-26', ore: 1, descrizione: 'c' }); // senza importo

    const m2 = await createMandato(adminAJwt, aziendaId, 'PREV-2');
    await addPrestazione(adminAJwt, m2, { data: '2026-06-26', ore: 4, descrizione: 'd' }); // nessun importo

    const res = await request(app.getHttpServer())
      .get(MARGINE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    const rows = res.body.data as MargineRow[];
    expect(rows.length).toBe(2);

    const r1 = rows.find((r) => r.mandatoId === m1)!;
    expect(r1.oreTotali).toBe(6); // 3+2+1
    expect(r1.importoPrestazioni).toBe(150); // 100+50 (la terza è null)
    expect(r1.importoConcordato).toBe(244); // snapshot preventivo.totale
    expect(r1.margine).toBe(94); // 244 - 150

    const r2 = rows.find((r) => r.mandatoId === m2)!;
    expect(r2.oreTotali).toBe(4);
    expect(r2.importoPrestazioni).toBeNull();
    expect(r2.margine).toBeNull();

    // ordinamento: margine non-null prima, null in coda
    expect(rows[0].mandatoId).toBe(m1);
    expect(rows[rows.length - 1].margine).toBeNull();
  });

  it('2. RBAC: con report.operativo.visualizza → 200; senza → 403', async () => {
    await request(app.getHttpServer())
      .get(MARGINE)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(MARGINE)
      .set('Authorization', `Bearer ${noAccessJwt}`)
      .expect(403);
  });

  it('3. isolamento cross-tenant: B non vede i mandati di A', async () => {
    await createMandato(adminAJwt, aziendaId, 'PREV-A');
    const res = await request(app.getHttpServer())
      .get(MARGINE)
      .set('Authorization', `Bearer ${adminBJwt}`)
      .expect(200);
    expect(res.body.data.length).toBe(0);
  });
});
