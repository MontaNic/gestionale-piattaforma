// =============================================================================
// price-lists-crud.e2e-spec.ts (sessione 17 F1 ADR-0019) — E2E PriceList + ArticlePrice
// =============================================================================
// Coverage:
//   1-3. CRUD /price-lists
//   4. POST /articles/:articleId/prices upsert (Sub-DP 2)
//   5. idempotenza upsert (stesso articleId+priceListId → update, no duplicate)
//   6-7. PATCH/DELETE article price
//   8. permission deny 403
//   9. validation channels → .skip TD-BS
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
  flushTenantSlugCache,
  loginAs,
  seedLimitedUser,
  seedMenuPermissions,
} from './helpers/menu-test-fixtures';

describe('PriceLists + ArticlePrice CRUD E2E — /api/v1/price-lists', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminJwt: string;
  let limitedJwt: string;
  let articleId: string;

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
    const demoSeed = await seedMinimal(containers.databaseUrl);
    await seedMenuPermissions(containers.databaseUrl, {
      tenantId: demoSeed.tenantId,
      userId: demoSeed.adminUserId,
    });
    const limited = await seedLimitedUser(containers.databaseUrl, {
      tenantId: demoSeed.tenantId,
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
    limitedJwt = await loginAs(app, 'demo', limited.email, limited.password);

    // Setup: menu + category + article (per nested prices)
    const menu = await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Pranzo' })
      .expect(201);
    const category = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menu.body.data.id}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti' })
      .expect(201);
    const article = await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        categoryId: category.body.data.id,
        name: 'Bruschetta',
        descriptionShort: 'Test',
        basePrice: 6.5,
        vatPercent: 10,
        printDepartment: 'cucina',
      })
      .expect(201);
    articleId = article.body.data.id;
  });

  it('1. POST /price-lists create con channels 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/price-lists')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Base', channels: ['cassa', 'menu_online'], priority: 0 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Base', priority: 0, isActive: true });
    expect(res.body.data.channels).toEqual(['cassa', 'menu_online']);
  });

  it('2. GET /price-lists list', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/price-lists')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Base', channels: ['cassa'] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/price-lists')
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('3. PATCH update + DELETE soft-delete price-list', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/price-lists')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Base', channels: ['cassa'] })
      .expect(201);
    const plId = create.body.data.id;

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/price-lists/${plId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Estivo', channels: ['cassa', 'delivery'], priority: 5 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.name).toBe('Estivo');
    expect(patch.body.data.priority).toBe(5);

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/price-lists/${plId}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(del.status).toBe(200);

    const list = await request(app.getHttpServer())
      .get('/api/v1/price-lists')
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(list.body.data).toHaveLength(0);
  });

  it('4. POST /articles/:articleId/prices set price (upsert create)', async () => {
    const pl = await request(app.getHttpServer())
      .post('/api/v1/price-lists')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Base', channels: ['cassa'] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/articles/${articleId}/prices`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ priceListId: pl.body.data.id, price: 7.5 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ articleId, priceListId: pl.body.data.id });
    expect(Number(res.body.data.price)).toBe(7.5);
  });

  it('5. POST prices idempotenza upsert (stesso articleId+priceListId → update)', async () => {
    const pl = await request(app.getHttpServer())
      .post('/api/v1/price-lists')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Base', channels: ['cassa'] })
      .expect(201);
    const priceListId = pl.body.data.id;

    const first = await request(app.getHttpServer())
      .post(`/api/v1/articles/${articleId}/prices`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ priceListId, price: 7.5 })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/articles/${articleId}/prices`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ priceListId, price: 9.0 })
      .expect(201);

    // Stesso record (no duplicate): id invariato, price aggiornato
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(Number(second.body.data.price)).toBe(9);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/articles/${articleId}/prices`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(list.body.data).toHaveLength(1);
  });

  it('6. PATCH + DELETE article price', async () => {
    const pl = await request(app.getHttpServer())
      .post('/api/v1/price-lists')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Base', channels: ['cassa'] })
      .expect(201);
    const setPrice = await request(app.getHttpServer())
      .post(`/api/v1/articles/${articleId}/prices`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ priceListId: pl.body.data.id, price: 7.5 })
      .expect(201);
    const priceId = setPrice.body.data.id;

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/articles/${articleId}/prices/${priceId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ price: 11.0 });
    expect(patch.status).toBe(200);
    expect(Number(patch.body.data.price)).toBe(11);

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/articles/${articleId}/prices/${priceId}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ id: priceId, deleted: true });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/articles/${articleId}/prices`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(list.body.data).toHaveLength(0);
  });

  it('7. POST /price-lists permission deny 403 senza menu.prezzo.modifica', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/price-lists')
      .set('Authorization', `Bearer ${limitedJwt}`)
      .send({ name: 'Base', channels: ['cassa'] });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  // TODO TD-BS: ValidationPipe inattiva in harness E2E (SWC paramtypes)
  it.skip('8. POST validation 400 (channels vuoto) — BLOCKED TD-BS', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/price-lists')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Base', channels: [] });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('E_PRICE_LIST_CHANNELS_REQUIRED');
  });
});
