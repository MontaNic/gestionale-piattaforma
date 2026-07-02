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
});
