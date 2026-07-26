// =============================================================================
// comande.e2e-spec.ts — Operatività COMANDE E2E (PR-2, ADR-0068)
// =============================================================================
// Esercita gli endpoint /conti attraverso HTTP con RBAC reale. Copertura GATE-1:
//   - Resolver pricing: override / basePrice / ambiguità (E_PRICE_AMBIGUOUS) / snapshot
//   - RBAC (CHECK-BE-1): viewer→403, full→201/200, cross-tenant→404
//   - Coerenza canale↔tavolo (E_CONTO_CHANNEL_TAVOLO_MISMATCH)
//   - State machine (E_CONTO_NOT_OPEN)
//   - Soft-delete storno (CHECK-BE-2): invisibile in GET, fisicamente presente
//   - Isolamento tenant (404)
//   - Audit-in-tx (conto.aperto|chiuso, conto_riga.stornata)
//
// ⚠️ Dipendenza dalla Cassa pre-fiscale (ADR-0081 D3): `chiudi` esige ora un conto
// saldato. I test che chiudono un conto CON righe passano da `pagaSaldo()` prima
// della chiusura; quelli che chiudono un conto vuoto (o con le sole righe
// soft-deleted) restano invariati — totale 0 ⇒ guardia soddisfatta. La copertura
// della cassa vera vive in `cassa.e2e-spec.ts`.
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
  insertActivePriceList,
  seedComandeData,
  seedComandePermissions,
  type ComandeData,
} from './helpers/comande-test-fixtures';

const API = '/api/v1/conti';

async function pgRows(
  databaseUrl: string,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    await client.end();
  }
}

describe('Comande E2E — /api/v1/conti (PR-2, ADR-0068)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let demoJwt: string;
  let demoTenantId: string;
  let data: ComandeData;

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
    const demo = await seedMinimal(containers.databaseUrl);
    demoTenantId = demo.tenantId;
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: demo.tenantId,
      userId: demo.adminUserId,
      grant: 'full',
    });
    data = await seedComandeData(containers.databaseUrl, { tenantId: demo.tenantId });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    demoJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
  });

  const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}`, 'X-Tenant-Slug': 'demo' });

  async function apriCassa(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'cassa', coperti: 4, tavoloId: data.tavoloId })
      .expect(201);
    return res.body.data.id as string;
  }

  /**
   * Salda il conto registrando UN pagamento pari al residuo corrente.
   * Necessario prima di `chiudi` da quando esiste la guardia di saldo
   * (ADR-0081 D3): un conto con righe non si chiude più senza incasso.
   * No-op se il residuo è già 0 (conto senza righe) → chiamabile sempre.
   */
  async function pagaSaldo(contoId: string, metodo = 'contanti'): Promise<void> {
    const conto = await request(app.getHttpServer())
      .get(`${API}/${contoId}`)
      .set(auth(demoJwt))
      .expect(200);
    const residuo = Number(conto.body.data.residuo);
    if (residuo <= 0) return;
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti`)
      .set(auth(demoJwt))
      .send({ metodo, importo: residuo })
      .expect(201);
  }

  // ===========================================================================
  // Resolver pricing
  // ===========================================================================
  it('pricing: riga articleA usa l override del listino (8.00, non basePrice 10.00)', async () => {
    const contoId = await apriCassa();
    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId: data.articleAId, quantita: 2 })
      .expect(201);
    expect(Number(res.body.data.prezzoUnitario)).toBe(8);
    expect(res.body.data.nomeArticolo).toBe('Spaghetti');
    expect(res.body.data.reparto).toBe('cucina');
  });

  it('pricing: riga articleB senza override → basePrice 5.00', async () => {
    const contoId = await apriCassa();
    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId: data.articleBId, quantita: 1 })
      .expect(201);
    expect(Number(res.body.data.prezzoUnitario)).toBe(5);
    expect(res.body.data.reparto).toBe('bar');
  });

  it('pricing: 2 listini attivi collidenti su cassa → 409 E_PRICE_AMBIGUOUS', async () => {
    await insertActivePriceList(containers.databaseUrl, {
      tenantId: demoTenantId,
      name: 'Extra Cassa',
      channels: ['cassa'],
    });
    const contoId = await apriCassa();
    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId: data.articleAId, quantita: 1 });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_PRICE_AMBIGUOUS');
  });

  it('pricing: snapshot congelato — modificare l Article dopo l aggiunta non muove la riga', async () => {
    const contoId = await apriCassa();
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId: data.articleAId, quantita: 1 })
      .expect(201);

    // muta sorgente: nome articolo, basePrice, e il prezzo override
    await pgRows(
      containers.databaseUrl,
      `UPDATE articles SET name = $1, base_price = 99.00 WHERE id = $2`,
      ['RINOMINATO', data.articleAId],
    );
    await pgRows(
      containers.databaseUrl,
      `UPDATE article_prices SET price = 77.00 WHERE article_id = $1`,
      [data.articleAId],
    );

    const get = await request(app.getHttpServer())
      .get(`${API}/${contoId}`)
      .set(auth(demoJwt))
      .expect(200);
    const riga = get.body.data.righe[0];
    expect(riga.nomeArticolo).toBe('Spaghetti'); // congelato
    expect(Number(riga.prezzoUnitario)).toBe(8); // congelato
    expect(Number(get.body.data.totale)).toBe(8);
  });

  // ===========================================================================
  // RBAC (CHECK-BE-1)
  // ===========================================================================
  it('rbac: viewer (comande.visualizza) → 403 su POST /conti', async () => {
    const limited = await seedLimitedUser(containers.databaseUrl, {
      tenantId: demoTenantId,
      email: 'viewer@demo.local',
    });
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: demoTenantId,
      userId: limited.userId,
      grant: 'viewer',
      roleName: 'Comande Viewer',
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    const viewerJwt = await loginAs(app, 'demo', limited.email, limited.password);

    const res = await request(app.getHttpServer())
      .post(API)
      .set(auth(viewerJwt))
      .send({ channel: 'asporto' });
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('rbac: viewer può leggere GET /conti (200)', async () => {
    const limited = await seedLimitedUser(containers.databaseUrl, {
      tenantId: demoTenantId,
      email: 'viewer2@demo.local',
    });
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: demoTenantId,
      userId: limited.userId,
      grant: 'viewer',
      roleName: 'Comande Viewer',
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    const viewerJwt = await loginAs(app, 'demo', limited.email, limited.password);

    await request(app.getHttpServer()).get(API).set(auth(viewerJwt)).expect(200);
  });

  // ===========================================================================
  // Filtri GET /conti — ?stato= &tavoloId= (PR-1 FE, backward-compat)
  // ===========================================================================
  it('filtro: senza param ritorna tutti i conti (backward-compat)', async () => {
    // aperto+cassa su tavolo, un asporto, poi chiudo il cassa → 2 conti totali
    const cassaId = await apriCassa();
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'asporto' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${API}/${cassaId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);

    const res = await request(app.getHttpServer()).get(API).set(auth(demoJwt)).expect(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('filtro: ?stato=aperto esclude i conti chiusi', async () => {
    const cassaId = await apriCassa();
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'asporto' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${API}/${cassaId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(API)
      .query({ stato: 'aperto' })
      .set(auth(demoJwt))
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].stato).toBe('aperto');
    expect(res.body.data[0].channel).toBe('asporto');
  });

  it('filtro: ?tavoloId= ritorna solo i conti di quel tavolo', async () => {
    await apriCassa(); // conto su data.tavoloId
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'asporto' })
      .expect(201); // senza tavolo

    const res = await request(app.getHttpServer())
      .get(API)
      .query({ tavoloId: data.tavoloId })
      .set(auth(demoJwt))
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].tavoloId).toBe(data.tavoloId);
  });

  it('filtro: ?stato=aperto&tavoloId= combinati', async () => {
    const cassaId = await apriCassa(); // aperto su data.tavoloId
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'asporto' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${API}/${cassaId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);

    // il solo conto sul tavolo ora è chiuso → aperto+tavolo = 0
    const res = await request(app.getHttpServer())
      .get(API)
      .query({ stato: 'aperto', tavoloId: data.tavoloId })
      .set(auth(demoJwt))
      .expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  // SKIP TD-BS Sub-2 (ADR-0019): nel harness E2E ValidationPipe non riceve
  // design:paramtypes runtime → il DTO @Query non viene validato (stessa
  // limitazione di articles/menus). In prod (nest build --builder swc, .swcrc
  // decoratorMetadata) la validazione produce 400 E_VALIDATION. Constraint del
  // DTO coperti da list-conti.query.dto.spec.ts (unit).
  it.skip('filtro: ?stato= invalido → 400 E_VALIDATION — BLOCKED TD-BS Sub-2', async () => {
    const res = await request(app.getHttpServer())
      .get(API)
      .query({ stato: 'inesistente' })
      .set(auth(demoJwt));
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_VALIDATION');
    expect(res.body.message).toContain('E_CONTO_STATO_INVALID');
  });

  // ===========================================================================
  // Coerenza canale↔tavolo (D3)
  // ===========================================================================
  it('coerenza: cassa SENZA tavolo → 400 E_CONTO_CHANNEL_TAVOLO_MISMATCH', async () => {
    const res = await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'cassa', coperti: 2 });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_CONTO_CHANNEL_TAVOLO_MISMATCH');
  });

  it('coerenza: asporto CON tavolo → 400 E_CONTO_CHANNEL_TAVOLO_MISMATCH', async () => {
    const res = await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'asporto', tavoloId: data.tavoloId });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_CONTO_CHANNEL_TAVOLO_MISMATCH');
  });

  it('coerenza: asporto SENZA tavolo → 201 (valido)', async () => {
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'asporto' })
      .expect(201);
  });

  it('coerenza: tavoloId inesistente su cassa → 404 E_TAVOLO_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'cassa', tavoloId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_TAVOLO_NOT_FOUND');
  });

  // ===========================================================================
  // State machine (D5)
  // ===========================================================================
  it('state: addRiga su conto chiuso → 409 E_CONTO_NOT_OPEN', async () => {
    const contoId = await apriCassa();
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId: data.articleAId, quantita: 1 });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_NOT_OPEN');
  });

  it('state: chiudere un conto già chiuso → 409 E_CONTO_NOT_OPEN', async () => {
    const contoId = await apriCassa();
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt));
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_NOT_OPEN');
  });

  it('state: annulla poi addRiga → 409 E_CONTO_NOT_OPEN', async () => {
    const contoId = await apriCassa();
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/annulla`)
      .set(auth(demoJwt))
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId: data.articleAId, quantita: 1 });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_NOT_OPEN');
  });

  // ===========================================================================
  // Soft-delete storno (CHECK-BE-2)
  // ===========================================================================
  it('storno: riga stornata invisibile in GET + esclusa dal totale, ma fisicamente presente', async () => {
    const contoId = await apriCassa();
    const add = await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId: data.articleAId, quantita: 2 })
      .expect(201);
    const rigaId = add.body.data.id as string;

    await request(app.getHttpServer())
      .delete(`${API}/${contoId}/righe/${rigaId}`)
      .set(auth(demoJwt))
      .expect(200);

    const get = await request(app.getHttpServer())
      .get(`${API}/${contoId}`)
      .set(auth(demoJwt))
      .expect(200);
    expect(get.body.data.righe.find((r: { id: string }) => r.id === rigaId)).toBeUndefined();
    expect(Number(get.body.data.totale)).toBe(0);

    const rows = await pgRows(
      containers.databaseUrl,
      `SELECT count(*)::int AS n FROM conti_righe WHERE id = $1 AND deleted_at IS NOT NULL`,
      [rigaId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  // ===========================================================================
  // Isolamento tenant
  // ===========================================================================
  it('isolamento: demo non opera sui conti di acme (404 su GET e addRiga)', async () => {
    const acme = await seedSecondTenant(containers.databaseUrl);
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: acme.tenantId,
      userId: acme.adminUserId,
      grant: 'full',
    });
    const acmeData = await seedComandeData(containers.databaseUrl, { tenantId: acme.tenantId });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    const acmeJwt = await loginAs(app, 'acme', 'admin@acme.local', 'Admin123!');

    const acmeConto = await request(app.getHttpServer())
      .post(API)
      .set({ Authorization: `Bearer ${acmeJwt}`, 'X-Tenant-Slug': 'acme' })
      .send({ channel: 'cassa', coperti: 2, tavoloId: acmeData.tavoloId })
      .expect(201);
    const acmeContoId = acmeConto.body.data.id as string;

    // demo (altro tenant) non vede/opera
    await request(app.getHttpServer()).get(`${API}/${acmeContoId}`).set(auth(demoJwt)).expect(404);
    const addRes = await request(app.getHttpServer())
      .post(`${API}/${acmeContoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId: data.articleAId, quantita: 1 });
    expect(addRes.status).toBe(404);
  });

  // ===========================================================================
  // DP-2 "un tavolo, un conto aperto" — partial unique index
  // conti_tenant_tavolo_aperto_uq (PR-2, migration 20260702090000)
  // ===========================================================================
  it('unico: crea conto cassa su tavolo libero → 201', async () => {
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'cassa', coperti: 2, tavoloId: data.tavoloId })
      .expect(201);
  });

  it('unico: 2° conto cassa sullo stesso tavolo con conto aperto → 409 E_CONTO_TAVOLO_ALREADY_OPEN', async () => {
    await apriCassa(); // primo conto aperto su data.tavoloId
    const res = await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'cassa', coperti: 3, tavoloId: data.tavoloId });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_TAVOLO_ALREADY_OPEN');
  });

  it('unico: chiudi il primo → nuovo conto sullo stesso tavolo → 201 (l index vincola solo aperto)', async () => {
    const primo = await apriCassa();
    await request(app.getHttpServer())
      .post(`${API}/${primo}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
    // stato aperto liberato → nuova apertura sullo stesso tavolo consentita
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'cassa', coperti: 2, tavoloId: data.tavoloId })
      .expect(201);
  });

  it('unico: N conti aperti SENZA tavolo (asporto/delivery) → tutti 201 (NULL non collide)', async () => {
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'asporto' })
      .expect(201);
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'delivery' })
      .expect(201);
    await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'menu_online' })
      .expect(201);
  });

  it('unico: stesso stato aperto su tavoli di due tenant diversi → entrambi 201 (index tenant-scoped)', async () => {
    // demo apre sul proprio tavolo
    await apriCassa();

    // acme apre sul PROPRIO tavolo (tavolo_id distinto: FK a un tavolo acme-owned)
    const acme = await seedSecondTenant(containers.databaseUrl);
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: acme.tenantId,
      userId: acme.adminUserId,
      grant: 'full',
    });
    const acmeData = await seedComandeData(containers.databaseUrl, { tenantId: acme.tenantId });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    const acmeJwt = await loginAs(app, 'acme', 'admin@acme.local', 'Admin123!');

    await request(app.getHttpServer())
      .post(API)
      .set({ Authorization: `Bearer ${acmeJwt}`, 'X-Tenant-Slug': 'acme' })
      .send({ channel: 'cassa', coperti: 2, tavoloId: acmeData.tavoloId })
      .expect(201);
  });

  // ===========================================================================
  // Audit-in-tx
  // ===========================================================================
  it('audit: apertura/chiusura/storno scrivono AuditLog atomico', async () => {
    const contoId = await apriCassa();
    const add = await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId: data.articleAId, quantita: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`${API}/${contoId}/righe/${add.body.data.id}`)
      .set(auth(demoJwt))
      .expect(200);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);

    const audits = await pgRows(
      containers.databaseUrl,
      `SELECT action FROM audit_logs WHERE tenant_id = $1 AND (entity_id = $2 OR entity_id = $3) ORDER BY timestamp ASC`,
      [demoTenantId, contoId, add.body.data.id],
    );
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('conto.aperto');
    expect(actions).toContain('conto_riga.aggiunta');
    expect(actions).toContain('conto_riga.stornata');
    expect(actions).toContain('conto.chiuso');
  });

  // ===========================================================================
  // KDS — layer Comanda (invio per reparto, feed, transizioni, immutabilità)
  // ADR-attivazione-layer-comanda
  // ===========================================================================
  describe('KDS layer Comanda', () => {
    const KDS = '/api/v1/comande';

    async function addRigaTo(contoId: string, articleId: string, quantita = 1): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/righe`)
        .set(auth(demoJwt))
        .send({ articleId, quantita })
        .expect(201);
      return res.body.data.id as string;
    }

    async function invia(contoId: string): Promise<Array<Record<string, unknown>>> {
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/invia`)
        .set(auth(demoJwt))
        .expect(201);
      return res.body.data as Array<Record<string, unknown>>;
    }

    // Conto asporto (SENZA tavolo): evita il partial-unique-index un-tavolo-un-conto
    // (PR-2) quando servono più conti aperti contemporaneamente nello stesso test.
    async function apriAsporto(): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(API)
        .set(auth(demoJwt))
        .send({ channel: 'asporto' })
        .expect(201);
      return res.body.data.id as string;
    }

    // ── Invio: split per reparto ─────────────────────────────────────────────
    it('invio: righe cucina+bar → 2 comande (una per reparto), righeCount corretto', async () => {
      const contoId = await apriCassa();
      await addRigaTo(contoId, data.articleAId, 2); // cucina
      await addRigaTo(contoId, data.articleBId, 1); // bar
      const comande = await invia(contoId);
      expect(comande).toHaveLength(2);
      const byReparto = Object.fromEntries(comande.map((c) => [c.reparto, c]));
      expect(byReparto.cucina).toBeDefined();
      expect(byReparto.bar).toBeDefined();
      expect(byReparto.cucina.stato).toBe('inviata');
      expect(byReparto.cucina.righeCount).toBe(1);
      expect(byReparto.bar.righeCount).toBe(1);
    });

    it('invio: conto non-aperto → 409 E_CONTO_NOT_OPEN', async () => {
      const contoId = await apriCassa();
      await addRigaTo(contoId, data.articleAId);
      await pagaSaldo(contoId); // guardia di saldo D3: il conto ha righe → serve incasso
      await request(app.getHttpServer())
        .post(`${API}/${contoId}/chiudi`)
        .set(auth(demoJwt))
        .expect(200);
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/invia`)
        .set(auth(demoJwt));
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('E_CONTO_NOT_OPEN');
    });

    it('invio: nessuna riga pending → 409 E_COMANDA_NO_RIGHE_PENDING', async () => {
      const contoId = await apriCassa();
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/invia`)
        .set(auth(demoJwt));
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('E_COMANDA_NO_RIGHE_PENDING');
    });

    it('invio: secondo invio con nuove righe pending → nuova comanda; senza pending → 409', async () => {
      const contoId = await apriCassa();
      await addRigaTo(contoId, data.articleAId); // cucina
      const first = await invia(contoId);
      expect(first).toHaveLength(1);

      // re-invio senza nuove pending → 409
      const reInvioVuoto = await request(app.getHttpServer())
        .post(`${API}/${contoId}/invia`)
        .set(auth(demoJwt));
      expect(reInvioVuoto.status).toBe(409);
      expect(reInvioVuoto.body.errorCode).toBe('E_COMANDA_NO_RIGHE_PENDING');

      // nuova riga pending → secondo invio crea una nuova comanda
      await addRigaTo(contoId, data.articleBId); // bar
      const second = await invia(contoId);
      expect(second).toHaveLength(1);
      expect(second[0].reparto).toBe('bar');
    });

    // ── Feed KDS ─────────────────────────────────────────────────────────────
    it('feed: default = non-pronte; shape righe con tavoloNumero e SENZA prezzi', async () => {
      const contoId = await apriCassa();
      await addRigaTo(contoId, data.articleAId, 3); // cucina
      await addRigaTo(contoId, data.articleBId, 1); // bar
      await invia(contoId);

      const res = await request(app.getHttpServer()).get(KDS).set(auth(demoJwt)).expect(200);
      expect(res.body.data).toHaveLength(2);
      for (const item of res.body.data) {
        expect(['inviata', 'in_preparazione']).toContain(item.stato);
        expect(item.contoId).toBe(contoId);
        expect(item.tavoloNumero).toBe('T1'); // join Conto→Tavolo
        expect(Array.isArray(item.righe)).toBe(true);
        for (const r of item.righe) {
          expect(r.nomeArticolo).toBeDefined();
          expect(r.quantita).toBeGreaterThan(0);
          expect('note' in r).toBe(true);
          expect(r.prezzoUnitario).toBeUndefined(); // MAI prezzi nel feed
        }
      }
    });

    it('feed: filtro reparto=cucina → solo la comanda cucina', async () => {
      const contoId = await apriCassa();
      await addRigaTo(contoId, data.articleAId); // cucina
      await addRigaTo(contoId, data.articleBId); // bar
      await invia(contoId);
      const res = await request(app.getHttpServer())
        .get(KDS)
        .query({ reparto: 'cucina' })
        .set(auth(demoJwt))
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].reparto).toBe('cucina');
    });

    it('feed: filtro stato=pronta esclude le comande appena inviate', async () => {
      const contoId = await apriCassa();
      await addRigaTo(contoId, data.articleAId);
      await invia(contoId);
      const res = await request(app.getHttpServer())
        .get(KDS)
        .query({ stato: 'pronta' })
        .set(auth(demoJwt))
        .expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('feed: FIFO inviataIl asc', async () => {
      const c1 = await apriAsporto();
      await addRigaTo(c1, data.articleAId);
      const first = await invia(c1); // cucina, prima
      const c2 = await apriAsporto();
      await addRigaTo(c2, data.articleBId);
      const second = await invia(c2); // bar, dopo

      const res = await request(app.getHttpServer()).get(KDS).set(auth(demoJwt)).expect(200);
      const ids = res.body.data.map((c: { id: string }) => c.id);
      expect(ids.indexOf(first[0].id)).toBeLessThan(ids.indexOf(second[0].id));
    });

    it('feed: conto ANNULLATO → le sue comande escono dal feed; conto CHIUSO → restano (semantica i)', async () => {
      // conto annullato
      const annullato = await apriCassa();
      await addRigaTo(annullato, data.articleAId);
      await invia(annullato);
      await request(app.getHttpServer())
        .post(`${API}/${annullato}/annulla`)
        .set(auth(demoJwt))
        .expect(200);

      // conto chiuso (pagato) — le comande restano visibili in cucina
      const chiuso = await apriCassa();
      await addRigaTo(chiuso, data.articleBId);
      await invia(chiuso);
      await pagaSaldo(chiuso); // guardia di saldo D3: "chiuso (pagato)" ora è letterale
      await request(app.getHttpServer())
        .post(`${API}/${chiuso}/chiudi`)
        .set(auth(demoJwt))
        .expect(200);

      const res = await request(app.getHttpServer()).get(KDS).set(auth(demoJwt)).expect(200);
      const contoIds = res.body.data.map((c: { contoId: string }) => c.contoId);
      expect(contoIds).not.toContain(annullato); // annullato escluso
      expect(contoIds).toContain(chiuso); // chiuso resta
    });

    // ── Transizioni forward-only ─────────────────────────────────────────────
    it('transizioni: inviata→in_preparazione→pronta (200); indietro → 409', async () => {
      const contoId = await apriCassa();
      await addRigaTo(contoId, data.articleAId);
      const [comanda] = await invia(contoId);
      const cid = comanda.id as string;

      await request(app.getHttpServer())
        .patch(`${KDS}/${cid}/stato`)
        .set(auth(demoJwt))
        .send({ stato: 'in_preparazione' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`${KDS}/${cid}/stato`)
        .set(auth(demoJwt))
        .send({ stato: 'pronta' })
        .expect(200);
      // indietro pronta→in_preparazione → 409
      const back = await request(app.getHttpServer())
        .patch(`${KDS}/${cid}/stato`)
        .set(auth(demoJwt))
        .send({ stato: 'in_preparazione' });
      expect(back.status).toBe(409);
      expect(back.body.errorCode).toBe('E_COMANDA_INVALID_TRANSITION');
    });

    it('transizioni: skip inviata→pronta ammesso (200)', async () => {
      const contoId = await apriCassa();
      await addRigaTo(contoId, data.articleAId);
      const [comanda] = await invia(contoId);
      await request(app.getHttpServer())
        .patch(`${KDS}/${comanda.id}/stato`)
        .set(auth(demoJwt))
        .send({ stato: 'pronta' })
        .expect(200);
    });

    it('transizioni: comanda inesistente → 404 E_COMANDA_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${KDS}/00000000-0000-0000-0000-000000000000/stato`)
        .set(auth(demoJwt))
        .send({ stato: 'pronta' });
      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('E_COMANDA_NOT_FOUND');
    });

    // ── Immutabilità righe inviate ───────────────────────────────────────────
    it('immutabilità: update/storno riga inviata → 409 E_RIGA_ALREADY_SENT; riga pending resta mutabile', async () => {
      const contoId = await apriCassa();
      const rigaInviata = await addRigaTo(contoId, data.articleAId, 2);
      await invia(contoId);

      const upd = await request(app.getHttpServer())
        .patch(`${API}/${contoId}/righe/${rigaInviata}`)
        .set(auth(demoJwt))
        .send({ quantita: 5 });
      expect(upd.status).toBe(409);
      expect(upd.body.errorCode).toBe('E_RIGA_ALREADY_SENT');

      const del = await request(app.getHttpServer())
        .delete(`${API}/${contoId}/righe/${rigaInviata}`)
        .set(auth(demoJwt));
      expect(del.status).toBe(409);
      expect(del.body.errorCode).toBe('E_RIGA_ALREADY_SENT');

      // riga aggiunta DOPO l'invio è pending → resta modificabile
      const rigaPending = await addRigaTo(contoId, data.articleBId, 1);
      await request(app.getHttpServer())
        .patch(`${API}/${contoId}/righe/${rigaPending}`)
        .set(auth(demoJwt))
        .send({ quantita: 4 })
        .expect(200);
    });

    // ── Note per-riga (KDS precursor, ADR-0069) ──────────────────────────────
    // Il constraint maxLength(200)→400 vive negli unit spec dei DTO (add/update-
    // riga.dto.spec): in E2E la ValidationPipe non valida il @Body (TD-BS Sub-2).
    it('note: add con note → persistita e visibile nel GET conto', async () => {
      const contoId = await apriCassa();
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/righe`)
        .set(auth(demoJwt))
        .send({ articleId: data.articleAId, quantita: 1, note: 'senza glutine' })
        .expect(201);
      expect(res.body.data.note).toBe('senza glutine');

      const get = await request(app.getHttpServer())
        .get(`${API}/${contoId}`)
        .set(auth(demoJwt))
        .expect(200);
      const riga = get.body.data.righe.find((r: { id: string }) => r.id === res.body.data.id);
      expect(riga.note).toBe('senza glutine');
    });

    it('note: add senza note → null nel GET (campo opzionale)', async () => {
      const contoId = await apriCassa();
      const add = await addRigaTo(contoId, data.articleAId);
      const get = await request(app.getHttpServer())
        .get(`${API}/${contoId}`)
        .set(auth(demoJwt))
        .expect(200);
      const riga = get.body.data.righe.find((r: { id: string }) => r.id === add);
      expect(riga.note).toBeNull();
    });

    it('note: update note su riga pending → aggiornata; quantità senza note la lascia invariata', async () => {
      const contoId = await apriCassa();
      const add = await request(app.getHttpServer())
        .post(`${API}/${contoId}/righe`)
        .set(auth(demoJwt))
        .send({ articleId: data.articleAId, quantita: 1, note: 'iniziale' })
        .expect(201);
      const rigaId = add.body.data.id as string;

      // patch con nuova note → aggiornata
      const upd = await request(app.getHttpServer())
        .patch(`${API}/${contoId}/righe/${rigaId}`)
        .set(auth(demoJwt))
        .send({ quantita: 3, note: 'ben cotto' })
        .expect(200);
      expect(upd.body.data.note).toBe('ben cotto');
      expect(upd.body.data.quantita).toBe(3);

      // patch senza note → note invariata (undefined = key ignorata)
      const upd2 = await request(app.getHttpServer())
        .patch(`${API}/${contoId}/righe/${rigaId}`)
        .set(auth(demoJwt))
        .send({ quantita: 5 })
        .expect(200);
      expect(upd2.body.data.note).toBe('ben cotto');
      expect(upd2.body.data.quantita).toBe(5);
    });

    it('note: update note su riga INVIATA → 409 E_RIGA_ALREADY_SENT (immutabilità)', async () => {
      const contoId = await apriCassa();
      const rigaInviata = await addRigaTo(contoId, data.articleAId, 1);
      await invia(contoId);
      const res = await request(app.getHttpServer())
        .patch(`${API}/${contoId}/righe/${rigaInviata}`)
        .set(auth(demoJwt))
        .send({ quantita: 1, note: 'troppo tardi' });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('E_RIGA_ALREADY_SENT');
    });

    // ── Audit ────────────────────────────────────────────────────────────────
    it('audit: comanda.inviata + comanda.stato_cambiato scritti in tx', async () => {
      const contoId = await apriCassa();
      await addRigaTo(contoId, data.articleAId);
      const [comanda] = await invia(contoId);
      await request(app.getHttpServer())
        .patch(`${KDS}/${comanda.id}/stato`)
        .set(auth(demoJwt))
        .send({ stato: 'in_preparazione' })
        .expect(200);

      const audits = await pgRows(
        containers.databaseUrl,
        `SELECT action FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 ORDER BY timestamp ASC`,
        [demoTenantId, comanda.id],
      );
      const actions = audits.map((a) => a.action);
      expect(actions).toContain('comanda.inviata');
      expect(actions).toContain('comanda.stato_cambiato');
    });
  });

  // ===========================================================================
  // Snapshot vatPercent su riga (ADR-0070) — prezzi lordi, scorporo differito
  // ===========================================================================
  // Seed: articleA vat 10 (Spaghetti, cucina), articleB vat 22 (Birra, bar).
  describe('vatPercent snapshot (ADR-0070)', () => {
    async function addRiga(contoId: string, articleId: string, quantita = 1): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/righe`)
        .set(auth(demoJwt))
        .send({ articleId, quantita })
        .expect(201);
      return res.body.data.id as string;
    }
    const vatOf = async (rigaId: string): Promise<number | null> => {
      const rows = await pgRows(
        containers.databaseUrl,
        'SELECT vat_percent FROM conti_righe WHERE id = $1',
        [rigaId],
      );
      return (rows[0]?.vat_percent as number | null) ?? null;
    };

    it('test 1+5 — snapshot da Article.vatPercent (articleA=10, articleB=22)', async () => {
      const contoId = await apriCassa();
      const rigaA = await addRiga(contoId, data.articleAId);
      const rigaB = await addRiga(contoId, data.articleBId);
      expect(await vatOf(rigaA)).toBe(10);
      expect(await vatOf(rigaB)).toBe(22);
    });

    it('test 2 — modificare Article.vatPercent NON altera le righe già create (immutabilità)', async () => {
      const contoId = await apriCassa();
      const rigaA = await addRiga(contoId, data.articleAId);
      expect(await vatOf(rigaA)).toBe(10);
      // cambia l'aliquota dell'articolo a valle
      await pgRows(containers.databaseUrl, 'UPDATE articles SET vat_percent = 4 WHERE id = $1', [
        data.articleAId,
      ]);
      // la riga già scritta resta congelata a 10
      expect(await vatOf(rigaA)).toBe(10);
    });

    it('test 3 — computeTotale invariato: somma lorda pura, nessuno scorporo IVA', async () => {
      const contoId = await apriCassa();
      await addRiga(contoId, data.articleAId, 2); // override 8.00 × 2 = 16.00
      await addRiga(contoId, data.articleBId, 1); // basePrice 5.00 × 1 = 5.00
      const get = await request(app.getHttpServer())
        .get(`${API}/${contoId}`)
        .set(auth(demoJwt))
        .expect(200);
      // Σ prezzo×qta = 21.00, invariato malgrado le aliquote 10/22 (nessuna IVA aggiunta/scorporata)
      expect(get.body.data.totale).toBe('21.00');
    });

    it('test 4 — nessuna riga con vat_percent NULL (NOT NULL a runtime)', async () => {
      const contoId = await apriCassa();
      await addRiga(contoId, data.articleAId);
      await addRiga(contoId, data.articleBId);
      const rows = await pgRows(
        containers.databaseUrl,
        'SELECT count(*)::int AS n FROM conti_righe WHERE vat_percent IS NULL',
      );
      expect(rows[0].n).toBe(0);
    });
  });

  // ===========================================================================
  // Portata snapshot (ADR-portata) — raggruppamento KDS, stesso pattern di vat.
  // Fixture: articleA portata='primo' esplicita; articleB senza → default 'nessuna'.
  // ===========================================================================
  describe('portata snapshot (ADR-portata)', () => {
    async function addRiga(contoId: string, articleId: string, quantita = 1): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/righe`)
        .set(auth(demoJwt))
        .send({ articleId, quantita })
        .expect(201);
      return res.body.data.id as string;
    }
    async function invia(contoId: string): Promise<void> {
      await request(app.getHttpServer())
        .post(`${API}/${contoId}/invia`)
        .set(auth(demoJwt))
        .expect(201);
    }
    const portataOf = async (rigaId: string): Promise<string | null> => {
      const rows = await pgRows(
        containers.databaseUrl,
        'SELECT portata FROM conti_righe WHERE id = $1',
        [rigaId],
      );
      return (rows[0]?.portata as string | null) ?? null;
    };

    it('test 1 (snapshot) + default — riga eredita Article.portata; articleB (non impostata) → nessuna', async () => {
      const contoId = await apriCassa();
      const rigaA = await addRiga(contoId, data.articleAId);
      const rigaB = await addRiga(contoId, data.articleBId);
      expect(await portataOf(rigaA)).toBe('primo'); // snapshot da Article.portata
      expect(await portataOf(rigaB)).toBe('nessuna'); // default DDL (articleB non la imposta)
    });

    it('test 3 (immutabilità) — modificare Article.portata NON altera le righe già create', async () => {
      const contoId = await apriCassa();
      const rigaA = await addRiga(contoId, data.articleAId);
      expect(await portataOf(rigaA)).toBe('primo');
      // cambia la portata dell'articolo a valle
      await pgRows(containers.databaseUrl, `UPDATE articles SET portata = 'dolce' WHERE id = $1`, [
        data.articleAId,
      ]);
      // la riga già scritta resta congelata su 'primo' (raggruppamento storico stabile)
      expect(await portataOf(rigaA)).toBe('primo');
    });

    it('test 5 — getConto espone portata per riga', async () => {
      const contoId = await apriCassa();
      await addRiga(contoId, data.articleAId);
      const get = await request(app.getHttpServer())
        .get(`${API}/${contoId}`)
        .set(auth(demoJwt))
        .expect(200);
      expect(get.body.data.righe[0].portata).toBe('primo');
    });

    it('test 6 — feed KDS espone portata nel payload (predisposizione board)', async () => {
      const contoId = await apriCassa();
      await addRiga(contoId, data.articleAId); // cucina, primo
      await invia(contoId);
      const feed = await request(app.getHttpServer())
        .get('/api/v1/comande')
        .set(auth(demoJwt))
        .expect(200);
      const righe = feed.body.data.flatMap((c: { righe: unknown[] }) => c.righe);
      expect(righe.length).toBeGreaterThan(0);
      expect(righe[0].portata).toBe('primo');
    });

    it('test 8 — computeTotale invariato: la portata non tocca il totale', async () => {
      const contoId = await apriCassa();
      await addRiga(contoId, data.articleAId, 2); // primo, 8.00 × 2 = 16.00
      await addRiga(contoId, data.articleBId, 1); // nessuna, 5.00 × 1 = 5.00
      const get = await request(app.getHttpServer())
        .get(`${API}/${contoId}`)
        .set(auth(demoJwt))
        .expect(200);
      // Σ prezzo×qta = 21.00, identico ai casi vat: la portata è raggruppamento, non prezzo.
      expect(get.body.data.totale).toBe('21.00');
    });

    it('test 4-analogo — nessuna riga con portata NULL (NOT NULL a runtime)', async () => {
      const contoId = await apriCassa();
      await addRiga(contoId, data.articleAId);
      await addRiga(contoId, data.articleBId);
      const rows = await pgRows(
        containers.databaseUrl,
        'SELECT count(*)::int AS n FROM conti_righe WHERE portata IS NULL',
      );
      expect(rows[0].n).toBe(0);
    });
  });

  // ===========================================================================
  // Storno riga INVIATA (ADR-storno) — flag distinto, feed marcato, audit-perdita
  // ===========================================================================
  describe('storno riga inviata (ADR-storno)', () => {
    async function addRiga(contoId: string, articleId: string, quantita = 1): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/righe`)
        .set(auth(demoJwt))
        .send({ articleId, quantita })
        .expect(201);
      return res.body.data.id as string;
    }
    async function invia(contoId: string): Promise<{ id: string; reparto: string }[]> {
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/invia`)
        .set(auth(demoJwt))
        .expect(201);
      return res.body.data as { id: string; reparto: string }[];
    }
    const storna = (contoId: string, rigaId: string) =>
      request(app.getHttpServer())
        .post(`${API}/${contoId}/righe/${rigaId}/storna`)
        .set(auth(demoJwt));
    const rigaDb = async (rigaId: string): Promise<Record<string, unknown>> =>
      (
        await pgRows(
          containers.databaseUrl,
          'SELECT stornata, stornata_il, deleted_at FROM conti_righe WHERE id = $1',
          [rigaId],
        )
      )[0];
    const getConto = async (contoId: string) =>
      (await request(app.getHttpServer()).get(`${API}/${contoId}`).set(auth(demoJwt)).expect(200))
        .body.data;

    it('test 1 — storno inviata → stornata=true, stornataIl valorizzato, NON soft-deleted', async () => {
      const contoId = await apriCassa();
      const rigaId = await addRiga(contoId, data.articleAId);
      await invia(contoId);
      const res = await storna(contoId, rigaId);
      expect(res.status).toBe(201);
      expect(res.body.data.stornata).toBe(true);
      const row = await rigaDb(rigaId);
      expect(row.stornata).toBe(true);
      expect(row.stornata_il).not.toBeNull();
      expect(row.deleted_at).toBeNull(); // NON soft-deleted (distinto)
    });

    it('test 2 — computeTotale esclude la stornata', async () => {
      const contoId = await apriCassa();
      const rA = await addRiga(contoId, data.articleAId, 2); // 8.00×2 = 16.00
      await addRiga(contoId, data.articleBId, 1); // 5.00
      await invia(contoId);
      expect((await getConto(contoId)).totale).toBe('21.00');
      await storna(contoId, rA).expect(201);
      expect((await getConto(contoId)).totale).toBe('5.00'); // solo articleB
    });

    it('test 3 — audit conto_riga.storno_inviata registra lo StatoComanda (perdita ricostruibile)', async () => {
      const contoId = await apriCassa();
      const rigaId = await addRiga(contoId, data.articleAId);
      const [comanda] = await invia(contoId);
      // porta la comanda a in_preparazione → storno = PERDITA (piatto in cottura)
      await request(app.getHttpServer())
        .patch(`/api/v1/comande/${comanda.id}/stato`)
        .set(auth(demoJwt))
        .send({ stato: 'in_preparazione' })
        .expect(200);
      await storna(contoId, rigaId).expect(201);
      const audit = await pgRows(
        containers.databaseUrl,
        `SELECT after_value->>'comandaStato' AS stato FROM audit_logs
         WHERE action = 'conto_riga.storno_inviata' AND entity_id = $1`,
        [rigaId],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].stato).toBe('in_preparazione');
    });

    it('test 4 — storno su riga PENDING (non inviata) → 409 E_RIGA_NOT_SENT', async () => {
      const contoId = await apriCassa();
      const rigaId = await addRiga(contoId, data.articleAId); // NON inviata
      const res = await storna(contoId, rigaId);
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('E_RIGA_NOT_SENT');
    });

    it('test 5 — doppio storno → 409 E_RIGA_ALREADY_STORNATA (non silenzioso)', async () => {
      const contoId = await apriCassa();
      const rigaId = await addRiga(contoId, data.articleAId);
      await invia(contoId);
      await storna(contoId, rigaId).expect(201);
      const res = await storna(contoId, rigaId);
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('E_RIGA_ALREADY_STORNATA');
    });

    it('test 6 — la riga stornata RESTA nel feed KDS con stornata:true (sana il silenzio)', async () => {
      const contoId = await apriCassa();
      const rigaId = await addRiga(contoId, data.articleAId);
      await invia(contoId);
      await storna(contoId, rigaId).expect(201);
      const feed = await request(app.getHttpServer())
        .get('/api/v1/comande')
        .set(auth(demoJwt))
        .expect(200);
      const righe = (feed.body.data as { righe: { id: string; stornata: boolean }[] }[]).flatMap(
        (c) => c.righe,
      );
      const riga = righe.find((r) => r.id === rigaId);
      expect(riga).toBeDefined();
      expect(riga?.stornata).toBe(true);
    });

    it('test 6b — la riga stornata esce anche in getConto con stornata:true (consumer FE immediato)', async () => {
      const contoId = await apriCassa();
      const rigaId = await addRiga(contoId, data.articleAId);
      await invia(contoId);
      await storna(contoId, rigaId).expect(201);
      const conto = await getConto(contoId);
      const riga = (conto.righe as { id: string; stornata: boolean }[]).find(
        (r) => r.id === rigaId,
      );
      expect(riga).toBeDefined();
      expect(riga?.stornata).toBe(true);
    });

    it('test 7 — comanda con TUTTE le righe stornate → card visibile (non nascosta)', async () => {
      const contoId = await apriCassa();
      const rigaId = await addRiga(contoId, data.articleAId); // unica riga → 1 comanda
      const [comanda] = await invia(contoId);
      await storna(contoId, rigaId).expect(201);
      const feed = await request(app.getHttpServer())
        .get('/api/v1/comande')
        .set(auth(demoJwt))
        .expect(200);
      const card = (feed.body.data as { id: string; righe: { stornata: boolean }[] }[]).find(
        (c) => c.id === comanda.id,
      );
      expect(card).toBeDefined(); // NON nascosta
      expect(card?.righe.every((r) => r.stornata)).toBe(true);
    });

    it('test 8 — riga stornata immutabile: PATCH → 409 (terminale, no de-storna)', async () => {
      const contoId = await apriCassa();
      const rigaId = await addRiga(contoId, data.articleAId);
      await invia(contoId);
      await storna(contoId, rigaId).expect(201);
      const res = await request(app.getHttpServer())
        .patch(`${API}/${contoId}/righe/${rigaId}`)
        .set(auth(demoJwt))
        .send({ quantita: 3 });
      expect(res.status).toBe(409); // E_RIGA_ALREADY_SENT (inviata → immutabile)
    });

    it('test 9 — cross-tenant: acme non può stornare una riga di demo (RLS → 404)', async () => {
      const contoId = await apriCassa();
      const rigaId = await addRiga(contoId, data.articleAId);
      await invia(contoId);
      // secondo tenant
      const acme = await seedSecondTenant(containers.databaseUrl);
      await seedComandePermissions(containers.databaseUrl, {
        tenantId: acme.tenantId,
        userId: acme.adminUserId,
        grant: 'full',
      });
      await flushTenantSlugCache(containers.redisHost, containers.redisPort);
      const acmeJwt = await loginAs(app, 'acme', 'admin@acme.local', 'Admin123!');
      const res = await request(app.getHttpServer())
        .post(`${API}/${contoId}/righe/${rigaId}/storna`)
        .set({ Authorization: `Bearer ${acmeJwt}`, 'X-Tenant-Slug': 'acme' });
      expect(res.status).toBe(404); // RLS: la riga di demo è invisibile ad acme
      // e la riga di demo NON è stata stornata
      expect((await rigaDb(rigaId)).stornata).toBe(false);
    });

    it('test 10 — totale con mix (attiva + stornata + soft-deleted) → conta solo l attiva', async () => {
      const contoId = await apriCassa();
      await addRiga(contoId, data.articleAId); // 8.00 — resterà attiva (unica nel totale finale)
      const rB = await addRiga(contoId, data.articleBId); // 5.00 — sarà stornata
      const rC = await addRiga(contoId, data.articleAId); // 8.00 — sarà soft-deleted (pending)
      await request(app.getHttpServer())
        .delete(`${API}/${contoId}/righe/${rC}`)
        .set(auth(demoJwt))
        .expect(200); // storno PENDING = soft-delete
      await invia(contoId); // invia rA, rB (rC è già soft-deleted)
      await storna(contoId, rB).expect(201);
      expect((await getConto(contoId)).totale).toBe('8.00'); // solo rA
    });
  });
});
