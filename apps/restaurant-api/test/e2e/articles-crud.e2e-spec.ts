// =============================================================================
// articles-crud.e2e-spec.ts (sessione 17 F1 ADR-0019) — E2E Article
// =============================================================================
// Coverage:
//   1-4. CRUD /articles
//   5. filtro ?categoryId= e ?menuId=
//   6. cambio categoria via PATCH + conflict check destination (Sub-DP 5)
//   7. permission deny 403
//   8. validation VAT → .skip TD-BS Sub-2 (constraint coperti da unit test)
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

const ARTICLE_BASE = {
  descriptionShort: 'Descrizione breve test',
  basePrice: 9.5,
  vatPercent: 10,
  printDepartment: 'cucina',
} as const;

describe('Articles CRUD E2E — /api/v1/articles', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminJwt: string;
  let limitedJwt: string;
  let menuId: string;
  let categoryAId: string;
  let categoryBId: string;

  beforeAll(async () => {
    containers = await startTestContainers();
    app = await createTestApp(containers);
  });

  afterAll(async () => {
    await app?.close();
    await stopTestContainers(containers);
  });

  async function createCategory(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name })
      .expect(201);
    return res.body.data.id;
  }

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

    const menu = await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Pranzo' })
      .expect(201);
    menuId = menu.body.data.id;
    categoryAId = await createCategory('Antipasti');
    categoryBId = await createCategory('Primi');
  });

  it('1. POST create con allergeni + tag dietetici 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        ...ARTICLE_BASE,
        categoryId: categoryAId,
        name: 'Bruschetta',
        allergens: ['cereali_glutine'],
        dietaryTags: ['vegano', 'vegetariano'],
        channelVisibility: ['cassa', 'menu_online'],
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Bruschetta',
      categoryId: categoryAId,
      vatPercent: 10,
    });
    expect(res.body.data.allergens).toEqual(['cereali_glutine']);
    expect(res.body.data.dietaryTags).toEqual(['vegano', 'vegetariano']);
  });

  it('2. GET /articles list', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...ARTICLE_BASE, categoryId: categoryAId, name: 'Bruschetta' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('3. PATCH update basePrice + soft-delete', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...ARTICLE_BASE, categoryId: categoryAId, name: 'Bruschetta' })
      .expect(201);
    const articleId = create.body.data.id;

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ basePrice: 12.0, vatPercent: 22 });
    expect(patch.status).toBe(200);
    expect(Number(patch.body.data.basePrice)).toBe(12);
    expect(patch.body.data.vatPercent).toBe(22);

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(del.status).toBe(200);

    const list = await request(app.getHttpServer())
      .get('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(list.body.data).toHaveLength(0);
  });

  it('4. GET /articles?categoryId= e ?menuId= filtri', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...ARTICLE_BASE, categoryId: categoryAId, name: 'Bruschetta' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...ARTICLE_BASE, categoryId: categoryBId, name: 'Carbonara' })
      .expect(201);

    const byCategory = await request(app.getHttpServer())
      .get(`/api/v1/articles?categoryId=${categoryAId}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(byCategory.status).toBe(200);
    expect(byCategory.body.data).toHaveLength(1);
    expect(byCategory.body.data[0].name).toBe('Bruschetta');

    const byMenu = await request(app.getHttpServer())
      .get(`/api/v1/articles?menuId=${menuId}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(byMenu.status).toBe(200);
    expect(byMenu.body.data).toHaveLength(2);
  });

  it('5. PATCH cambio categoria + conflict check destination', async () => {
    // Articolo "Bruschetta" in categoria A
    const create = await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...ARTICLE_BASE, categoryId: categoryAId, name: 'Bruschetta' })
      .expect(201);
    const articleId = create.body.data.id;

    // Articolo omonimo "Bruschetta" gia' presente in categoria B
    await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...ARTICLE_BASE, categoryId: categoryBId, name: 'Bruschetta' })
      .expect(201);

    // Spostare l'articolo A→B collide con l'omonimo in B → 409
    const conflict = await request(app.getHttpServer())
      .patch(`/api/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ categoryId: categoryBId });
    expect(conflict.status).toBe(409);
    expect(JSON.stringify(conflict.body)).toContain('E_ARTICLE_NAME_EXISTS');

    // Rinominare + spostare in B (nome unico) → OK
    const ok = await request(app.getHttpServer())
      .patch(`/api/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ categoryId: categoryBId, name: 'Bruschetta Speciale' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.categoryId).toBe(categoryBId);
    expect(ok.body.data.name).toBe('Bruschetta Speciale');
  });

  it('6. POST permission deny 403 senza menu.piatto.crea', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${limitedJwt}`)
      .send({ ...ARTICLE_BASE, categoryId: categoryAId, name: 'Bruschetta' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('7. POST categoria inesistente → 404 E_MENU_CATEGORY_NOT_FOUND', async () => {
    const fakeCategoryId = '019e0000-0000-7000-8000-000000000000';
    const res = await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...ARTICLE_BASE, categoryId: fakeCategoryId, name: 'Bruschetta' });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toContain('E_MENU_CATEGORY_NOT_FOUND');
  });

  // SKIP TD-BS Sub-2 (deferred): integrazione ValidationPipe→400 E2E bloccata
  // dal harness (no design:paramtypes runtime — vedi ADR-0019 §TD-BS sessione
  // 18). Constraint DTO (incluso VAT @IsIn[4,10,22]) coperti da
  // create-article.dto.spec.ts (Sub-1).
  it.skip('8. POST validation VAT 400 (aliquota non valida) — BLOCKED TD-BS Sub-2', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...ARTICLE_BASE, categoryId: categoryAId, name: 'Bruschetta', vatPercent: 15 });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('E_ARTICLE_VAT_INVALID');
  });
});
