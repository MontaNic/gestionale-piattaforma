// =============================================================================
// menu-categories-crud.e2e-spec.ts (sessione 17 F1 ADR-0019) — E2E MenuCategory
// =============================================================================
// Coverage:
//   1-5. CRUD nested /menus/:menuId/categories
//   6. POST su menu inesistente → 404 E_MENU_NOT_FOUND
//   7. POST stesso name stesso menu → 409 E_MENU_CATEGORY_NAME_EXISTS
//   8. permission deny 403
//   9. validation → .skip TD-BS Sub-2 (constraint coperti da unit test)
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

describe('MenuCategories CRUD E2E — /api/v1/menus/:menuId/categories', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminJwt: string;
  let limitedJwt: string;
  let menuId: string;

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

    // Setup: menu parent
    const menu = await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Pranzo' })
      .expect(201);
    menuId = menu.body.data.id;
  });

  it('1. POST categories create OK 201', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti', sortOrder: 0 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Antipasti', menuId, sortOrder: 0 });
  });

  it('2. GET categories list ordinata', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Primi', sortOrder: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti', sortOrder: 0 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('Antipasti'); // sortOrder 0 first
  });

  it('3. GET categories/:id getById OK', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti' })
      .expect(201);
    const catId = create.body.data.id;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/menus/${menuId}/categories/${catId}`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(catId);
  });

  it('4. PATCH categories/:id update name', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti' })
      .expect(201);
    const catId = create.body.data.id;

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/menus/${menuId}/categories/${catId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti Freddi', sortOrder: 3 });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Antipasti Freddi');
    expect(res.body.data.sortOrder).toBe(3);
  });

  it('5. DELETE categories/:id soft-delete', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti' })
      .expect(201);
    const catId = create.body.data.id;

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/menus/${menuId}/categories/${catId}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ id: catId, deleted: true });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(list.body.data.find((c: { id: string }) => c.id === catId)).toBeUndefined();
  });

  it('6. POST su menu inesistente → 404 E_MENU_NOT_FOUND', async () => {
    const fakeMenuId = '019e0000-0000-7000-8000-000000000000';
    const res = await request(app.getHttpServer())
      .post(`/api/v1/menus/${fakeMenuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti' });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toContain('E_MENU_NOT_FOUND');
  });

  it('7. POST stesso name stesso menu → 409 E_MENU_CATEGORY_NAME_EXISTS', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Antipasti' });

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('E_MENU_CATEGORY_NAME_EXISTS');
  });

  it('8. POST permission deny 403 senza menu.categoria.gestisci', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${limitedJwt}`)
      .send({ name: 'Antipasti' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  // SKIP TD-BS Sub-2 (deferred): integrazione ValidationPipe→400 E2E bloccata
  // dal harness (no design:paramtypes runtime — vedi ADR-0019 §TD-BS sessione
  // 18). Constraint DTO coperti da create-menu-category.dto.spec.ts (Sub-1).
  it.skip('9. POST validation 400 (name troppo corto) — BLOCKED TD-BS Sub-2', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'a' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('E_MENU_CATEGORY_NAME_TOO_SHORT');
  });
});
