// =============================================================================
// tables-crud.e2e-spec.ts (F2 Tavoli, ADR-0058) — E2E CRUD Tavolo
// =============================================================================
// Coverage happy-path + soft-delete invisibility:
//   1. POST /tables create OK 201 + body shape (posX/posY default 0)
//   2. GET /tables list ritorna i tavoli del tenant
//   3. GET /tables/:id getById OK
//   4. PATCH /tables/:id persiste la posizione (drag-drop) posX/posY
//   5. DELETE /tables/:id soft-delete + list non lo include + GET → 404
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
import { flushTenantSlugCache, loginAs } from './helpers/menu-test-fixtures';
import { seedTablePermissions } from './helpers/table-test-fixtures';

describe('Tables CRUD E2E — /api/v1/tables', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminJwt: string;

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
    await seedTablePermissions(containers.databaseUrl, {
      tenantId: demoSeed.tenantId,
      userId: demoSeed.adminUserId,
      grant: 'manager',
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    adminJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
  });

  it('1. POST /tables create OK 201 + body shape (coordinate default 0)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ numero: '12', capienza: 4 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ numero: '12', capienza: 4, posX: 0, posY: 0 });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]+$/);
  });

  it('2. GET /tables list ritorna i tavoli del tenant', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ numero: '1', capienza: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ numero: '2', capienza: 6 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/tables')
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    const numeri = res.body.data.map((tv: { numero: string }) => tv.numero);
    expect(numeri).toContain('1');
    expect(numeri).toContain('2');
  });

  it('3. GET /tables/:id getById OK', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ numero: 'Terrazza 3', capienza: 8 })
      .expect(201);
    const tableId = create.body.data.id;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(tableId);
    expect(res.body.data.numero).toBe('Terrazza 3');
  });

  it('4. PATCH /tables/:id persiste la posizione (drag-drop)', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ numero: '5', capienza: 4 })
      .expect(201);
    const tableId = create.body.data.id;

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ posX: 320, posY: 180 });

    expect(res.status).toBe(200);
    expect(res.body.data.posX).toBe(320);
    expect(res.body.data.posY).toBe(180);
    // numero/capienza invariati
    expect(res.body.data.numero).toBe('5');
    expect(res.body.data.capienza).toBe(4);
  });

  it('5. DELETE /tables/:id soft-delete → list non lo include + GET → 404', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ numero: '7', capienza: 2 })
      .expect(201);
    const tableId = create.body.data.id;

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${adminJwt}`);

    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ id: tableId, deleted: true });

    const list = await request(app.getHttpServer())
      .get('/api/v1/tables')
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(list.status).toBe(200);
    expect(list.body.data.find((tv: { id: string }) => tv.id === tableId)).toBeUndefined();

    const get = await request(app.getHttpServer())
      .get(`/api/v1/tables/${tableId}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(get.status).toBe(404);
  });
});
