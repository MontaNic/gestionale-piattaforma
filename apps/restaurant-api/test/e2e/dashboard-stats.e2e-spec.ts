// =============================================================================
// dashboard-stats.e2e-spec.ts — E2E GET /dashboard/stats (ADR-0084)
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest. I dati
// sono creati ATTRAVERSO L'API (conti → righe → invia → pagamenti), non con
// INSERT diretti: così i KPI sono verificati contro lo stato che l'applicazione
// produce davvero, comprese le comande generate da `invia` e gli importi
// risolti dal listino. Copertura:
//   1. tenant vuoto → zeri, non errore
//   2. valori corretti sui 4 KPI con dati noti
//   3. `contiAperti` è una fotografia: la chiusura lo abbassa, i coperti restano
//   4. `comandeInCorso` esclude `pronta`
//   5. `incassoOggi` esclude i pagamenti stornati
//   6. RBAC: `comande.*` pieni ma niente `report.operativo.visualizza` → 403
//   7. RBAC: utente senza alcun ruolo → 403
//   8. isolamento: i dati del tenant B non entrano nei numeri del tenant A
//
// Suite superuser (TD-BV): l'isolamento qui è applicativo. L'isolamento RLS al
// layer DB (policy come `gestionale_app` non-superuser) vive in
// conti-rls-isolation / comande-rls-isolation: questo spec gira come `postgres`
// e la policy sarebbe bypassata.
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
import { flushTenantSlugCache, loginAs, seedLimitedUser } from './helpers/menu-test-fixtures';
import {
  seedComandeData,
  seedComandePermissions,
  type ComandeData,
} from './helpers/comande-test-fixtures';
import { seedDashboardPermission } from './helpers/dashboard-test-fixtures';

const STATS = '/api/v1/dashboard/stats';
const CONTI = '/api/v1/conti';
const COMANDE = '/api/v1/comande';

interface Stats {
  contiAperti: number;
  comandeInCorso: number;
  incassoOggi: string;
  copertiOggi: number;
}

describe('Dashboard stats E2E — GET /api/v1/dashboard/stats (ADR-0084)', () => {
  let containers: TestContainers;
  let app: INestApplication;

  let demoJwt: string; // comande full + report.operativo.visualizza
  let comandeOnlyJwt: string; // comande full, NIENTE report.* → 403 atteso
  let noRoleJwt: string; // nessun ruolo → 403 atteso
  let acmeJwt: string; // tenant B
  let data: ComandeData;
  let dataB: ComandeData;

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

    // ── Tenant A (demo) ──────────────────────────────────────────────────────
    const demo = await seedMinimal(containers.databaseUrl);
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: demo.tenantId,
      userId: demo.adminUserId,
      grant: 'full',
    });
    await seedDashboardPermission(containers.databaseUrl, {
      tenantId: demo.tenantId,
      userId: demo.adminUserId,
    });
    data = await seedComandeData(containers.databaseUrl, { tenantId: demo.tenantId });

    // Utente con tutti i comande.*/cassa.* ma SENZA report.operativo.visualizza.
    const comandeOnly = await seedLimitedUser(containers.databaseUrl, {
      tenantId: demo.tenantId,
      email: 'comande-only@demo.local',
    });
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: demo.tenantId,
      userId: comandeOnly.userId,
      grant: 'full',
    });

    // Utente senza alcun ruolo.
    const noRole = await seedLimitedUser(containers.databaseUrl, {
      tenantId: demo.tenantId,
      email: 'norole@demo.local',
    });

    // ── Tenant B (acme) ──────────────────────────────────────────────────────
    const acme = await seedSecondTenant(containers.databaseUrl);
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: acme.tenantId,
      userId: acme.adminUserId,
      grant: 'full',
    });
    await seedDashboardPermission(containers.databaseUrl, {
      tenantId: acme.tenantId,
      userId: acme.adminUserId,
    });
    dataB = await seedComandeData(containers.databaseUrl, { tenantId: acme.tenantId });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    demoJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
    comandeOnlyJwt = await loginAs(app, 'demo', comandeOnly.email, comandeOnly.password);
    noRoleJwt = await loginAs(app, 'demo', noRole.email, noRole.password);
    acmeJwt = await loginAs(app, 'acme', 'admin@acme.local', 'Admin123!');
  });

  const auth = (jwt: string, slug = 'demo') => ({
    Authorization: `Bearer ${jwt}`,
    'X-Tenant-Slug': slug,
  });

  async function getStats(jwt = demoJwt, slug = 'demo'): Promise<Stats> {
    const res = await request(app.getHttpServer()).get(STATS).set(auth(jwt, slug)).expect(200);
    return res.body.data as Stats;
  }

  /** Conto cassa sul tavolo seedato (un tavolo → un solo conto aperto). */
  async function apriCassa(
    coperti: number,
    jwt = demoJwt,
    slug = 'demo',
    tavoloId = data.tavoloId,
  ) {
    const res = await request(app.getHttpServer())
      .post(CONTI)
      .set(auth(jwt, slug))
      .send({ channel: 'cassa', coperti, tavoloId })
      .expect(201);
    return res.body.data.id as string;
  }

  /** Conto asporto (senza tavolo): evita il partial-unique un-tavolo-un-conto. */
  async function apriAsporto(coperti?: number, jwt = demoJwt, slug = 'demo') {
    const res = await request(app.getHttpServer())
      .post(CONTI)
      .set(auth(jwt, slug))
      .send(coperti == null ? { channel: 'asporto' } : { channel: 'asporto', coperti })
      .expect(201);
    return res.body.data.id as string;
  }

  async function addRiga(
    contoId: string,
    articleId: string,
    quantita = 1,
    jwt = demoJwt,
    slug = 'demo',
  ) {
    await request(app.getHttpServer())
      .post(`${CONTI}/${contoId}/righe`)
      .set(auth(jwt, slug))
      .send({ articleId, quantita })
      .expect(201);
  }

  /** `invia` genera una comanda per reparto → ritorna le comande create. */
  async function invia(contoId: string, jwt = demoJwt, slug = 'demo') {
    const res = await request(app.getHttpServer())
      .post(`${CONTI}/${contoId}/invia`)
      .set(auth(jwt, slug))
      .expect(201);
    return res.body.data as Array<{ id: string; stato: string }>;
  }

  async function paga(contoId: string, importo: number, jwt = demoJwt, slug = 'demo') {
    const res = await request(app.getHttpServer())
      .post(`${CONTI}/${contoId}/pagamenti`)
      .set(auth(jwt, slug))
      .send({ metodo: 'contanti', importo })
      .expect(201);
    return res.body.data.id as string;
  }

  // ===========================================================================
  // 1. Tenant vuoto
  // ===========================================================================
  it('tenant senza alcun dato → zeri (non errore, non null)', async () => {
    const stats = await getStats();
    expect(stats).toEqual({
      contiAperti: 0,
      comandeInCorso: 0,
      incassoOggi: '0.00',
      copertiOggi: 0,
    });
  });

  // ===========================================================================
  // 2. Valori corretti sui 4 KPI
  // ===========================================================================
  it('dati noti → i 4 KPI sono esatti', async () => {
    // Conto 1: tavolo, 4 coperti, articleA ×1 → 8.00 (override listino Base),
    // reparto cucina. Pagato interamente.
    const conto1 = await apriCassa(4);
    await addRiga(conto1, data.articleAId, 1);
    await invia(conto1); // → 1 comanda cucina, stato `inviata`
    await paga(conto1, 8);

    // Conto 2: asporto, 2 coperti, articleB ×2 → 10.00 (basePrice 5.00),
    // reparto bar. Non pagato.
    const conto2 = await apriAsporto(2);
    await addRiga(conto2, data.articleBId, 2);
    await invia(conto2); // → 1 comanda bar, stato `inviata`

    const stats = await getStats();
    expect(stats.contiAperti).toBe(2);
    expect(stats.comandeInCorso).toBe(2);
    expect(stats.incassoOggi).toBe('8.00');
    expect(stats.copertiOggi).toBe(6);
  });

  it('i conti senza coperti (asporto) non sporcano la somma', async () => {
    await apriCassa(4);
    await apriAsporto(); // coperti = null

    const stats = await getStats();
    expect(stats.contiAperti).toBe(2);
    expect(stats.copertiOggi).toBe(4);
  });

  // ===========================================================================
  // 3. `contiAperti` è una fotografia, `copertiOggi` è di giornata
  // ===========================================================================
  it('chiudere un conto abbassa contiAperti ma NON copertiOggi', async () => {
    const contoId = await apriCassa(4);
    await addRiga(contoId, data.articleAId, 1);
    await paga(contoId, 8); // saldo richiesto dalla guardia D3

    const before = await getStats();
    expect(before.contiAperti).toBe(1);
    expect(before.copertiOggi).toBe(4);

    await request(app.getHttpServer())
      .post(`${CONTI}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);

    const after = await getStats();
    expect(after.contiAperti).toBe(0);
    // Il conto è stato APERTO oggi: i suoi coperti restano nel dato di giornata.
    expect(after.copertiOggi).toBe(4);
    // E l'incasso resta incassato.
    expect(after.incassoOggi).toBe('8.00');
  });

  // ===========================================================================
  // 4. `comandeInCorso` esclude `pronta`
  // ===========================================================================
  it('una comanda portata a `pronta` esce da comandeInCorso', async () => {
    const contoId = await apriCassa(2);
    await addRiga(contoId, data.articleAId, 1);
    const comande = await invia(contoId);
    const comandaId = comande[0]?.id;
    expect(comandaId).toBeTruthy();

    expect((await getStats()).comandeInCorso).toBe(1);

    await request(app.getHttpServer())
      .patch(`${COMANDE}/${comandaId}/stato`)
      .set(auth(demoJwt))
      .send({ stato: 'in_preparazione' })
      .expect(200);

    // `in_preparazione` è ancora "in corso".
    expect((await getStats()).comandeInCorso).toBe(1);

    await request(app.getHttpServer())
      .patch(`${COMANDE}/${comandaId}/stato`)
      .set(auth(demoJwt))
      .send({ stato: 'pronta' })
      .expect(200);

    expect((await getStats()).comandeInCorso).toBe(0);
  });

  // ===========================================================================
  // 5. Storno
  // ===========================================================================
  it('un pagamento stornato esce da incassoOggi', async () => {
    const contoId = await apriCassa(2);
    await addRiga(contoId, data.articleAId, 1);
    const pagamentoId = await paga(contoId, 8);

    expect((await getStats()).incassoOggi).toBe('8.00');

    await request(app.getHttpServer())
      .post(`${CONTI}/${contoId}/pagamenti/${pagamentoId}/storna`)
      .set(auth(demoJwt))
      .expect(200);

    expect((await getStats()).incassoOggi).toBe('0.00');
  });

  it('split payment: la somma è di tutti i pagamenti non stornati', async () => {
    const contoId = await apriCassa(2);
    await addRiga(contoId, data.articleAId, 1); // 8.00
    await paga(contoId, 3);
    await paga(contoId, 5);

    expect((await getStats()).incassoOggi).toBe('8.00');
  });

  // ===========================================================================
  // 6-7. RBAC
  // ===========================================================================
  it('RBAC: utente con tutti i comande.*/cassa.* ma senza report.operativo.visualizza → 403', async () => {
    await request(app.getHttpServer()).get(STATS).set(auth(comandeOnlyJwt)).expect(403);
  });

  it('RBAC: utente senza alcun ruolo → 403', async () => {
    await request(app.getHttpServer()).get(STATS).set(auth(noRoleJwt)).expect(403);
  });

  it('RBAC: utente con report.operativo.visualizza → 200', async () => {
    await request(app.getHttpServer()).get(STATS).set(auth(demoJwt)).expect(200);
  });

  // ===========================================================================
  // 8. Isolamento tenant
  // ===========================================================================
  it('isolamento: i dati del tenant B non entrano nei numeri del tenant A', async () => {
    // Tenant A: 1 conto, 4 coperti, incasso 8.00, 1 comanda in corso.
    const contoA = await apriCassa(4);
    await addRiga(contoA, data.articleAId, 1);
    await invia(contoA);
    await paga(contoA, 8);

    // Tenant B: numeri deliberatamente DIVERSI (2 conti, 9 coperti, 10.00).
    const contoB1 = await apriCassa(5, acmeJwt, 'acme', dataB.tavoloId);
    await addRiga(contoB1, dataB.articleBId, 2, acmeJwt, 'acme'); // 10.00
    await invia(contoB1, acmeJwt, 'acme');
    await paga(contoB1, 10, acmeJwt, 'acme');
    const contoB2 = await apriAsporto(4, acmeJwt, 'acme');
    await addRiga(contoB2, dataB.articleAId, 1, acmeJwt, 'acme');
    await invia(contoB2, acmeJwt, 'acme');

    const statsA = await getStats();
    expect(statsA).toEqual({
      contiAperti: 1,
      comandeInCorso: 1,
      incassoOggi: '8.00',
      copertiOggi: 4,
    });

    const statsB = await getStats(acmeJwt, 'acme');
    expect(statsB).toEqual({
      contiAperti: 2,
      comandeInCorso: 2,
      incassoOggi: '10.00',
      copertiOggi: 9,
    });
  });
});
