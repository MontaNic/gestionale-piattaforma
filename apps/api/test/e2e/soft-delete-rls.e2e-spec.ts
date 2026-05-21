// =============================================================================
// soft-delete-rls.e2e-spec.ts — Regressione soft-delete sotto RLS non-superuser
// =============================================================================
// CONTESTO (ADR-0021): il bug del soft-delete — `tx.<model>.delete()` dentro
// `withTenantContextAtomicTx` viene riscritto dall'interceptor softDeleteExtension
// in un `update` su client NON-transazionale, che esce dal context RLS della tx
// → Prisma P2025 → HTTP 500 — è INVISIBILE alla suite E2E standard perché i
// Testcontainers connettono come `postgres` superuser, che bypassa la RLS.
//
// Questo spec è l'UNICO che boota l'app come ruolo `gestionale_app`
// (NOSUPERUSER NOBYPASSRLS) — riproduce la configurazione dev/prod e cattura
// ogni regressione del soft-delete RLS-aware.
//
//   - codice pre-fix:  DELETE menu/categoria/articolo → 500 (Prisma P2025)
//   - codice post-fix: 200 (service softDelete usa `tx.update({ deletedAt })`)
//
// NB: la conversione dell'INTERA suite E2E a non-superuser è TD-BV (fuori scope
// — la suite esistente resta superuser). Qui si aggiunge solo uno spec mirato.
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
import { flushTenantSlugCache, loginAs, seedMenuPermissions } from './helpers/menu-test-fixtures';

// `gestionale_app`: ruolo runtime non-superuser creato dalla migration
// 20260513002159_create_app_role_and_grants con password placeholder. La
// rotazione password avviene solo in dev/prod (docker init / deploy pipeline),
// quindi nei Testcontainers il role mantiene la placeholder.
const APP_ROLE = 'gestionale_app';
const APP_ROLE_PASSWORD = 'PLACEHOLDER_MUST_BE_ROTATED';

/** Deriva l'URL di connessione come ruolo app non-superuser dall'URL superuser. */
function toAppRoleUrl(superuserUrl: string): string {
  const u = new URL(superuserUrl);
  u.username = APP_ROLE;
  u.password = APP_ROLE_PASSWORD;
  return u.toString();
}

describe('Soft-delete RLS E2E — app come ruolo non-superuser (ADR-0021)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminJwt: string;

  beforeAll(async () => {
    containers = await startTestContainers();
    // App bootata come `gestionale_app` → RLS ENFORCED (gli altri spec E2E
    // girano come `postgres` superuser e quindi bypassano la RLS).
    app = await createTestApp({
      ...containers,
      databaseUrl: toAppRoleUrl(containers.databaseUrl),
    });
  });

  afterAll(async () => {
    await app?.close();
    await stopTestContainers(containers);
  });

  beforeEach(async () => {
    // truncate + seed via URL superuser: `gestionale_app` non ha privilegio
    // TRUNCATE e il seed inserisce tenant/permessi fuori da ogni tenant context.
    await truncateDatabase(containers.databaseUrl);
    const demo = await seedMinimal(containers.databaseUrl);
    await seedMenuPermissions(containers.databaseUrl, {
      tenantId: demo.tenantId,
      userId: demo.adminUserId,
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    adminJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
  });

  function authHeader(): { Authorization: string } {
    return { Authorization: `Bearer ${adminJwt}` };
  }

  it('DELETE /menus/:id — soft-delete OK 200 sotto RLS non-superuser', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set(authHeader())
      .send({ name: 'Pranzo' })
      .expect(201);
    const menuId = create.body.data.id as string;

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/menus/${menuId}`)
      .set(authHeader());

    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ id: menuId, deleted: true });

    // Il soft-delete è effettivo: GET list non lo include più.
    const list = await request(app.getHttpServer())
      .get('/api/v1/menus')
      .set(authHeader())
      .expect(200);
    expect(list.body.data.find((m: { id: string }) => m.id === menuId)).toBeUndefined();
  });

  it('DELETE categoria — soft-delete OK 200 sotto RLS non-superuser', async () => {
    const menu = await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set(authHeader())
      .send({ name: 'Pranzo' })
      .expect(201);
    const menuId = menu.body.data.id as string;

    const cat = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menuId}/categories`)
      .set(authHeader())
      .send({ name: 'Antipasti' })
      .expect(201);
    const catId = cat.body.data.id as string;

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/menus/${menuId}/categories/${catId}`)
      .set(authHeader());

    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ id: catId, deleted: true });
  });

  it('DELETE /articles/:id — soft-delete OK 200 sotto RLS non-superuser', async () => {
    const menu = await request(app.getHttpServer())
      .post('/api/v1/menus')
      .set(authHeader())
      .send({ name: 'Pranzo' })
      .expect(201);
    const cat = await request(app.getHttpServer())
      .post(`/api/v1/menus/${menu.body.data.id}/categories`)
      .set(authHeader())
      .send({ name: 'Antipasti' })
      .expect(201);
    const art = await request(app.getHttpServer())
      .post('/api/v1/articles')
      .set(authHeader())
      .send({
        categoryId: cat.body.data.id,
        name: 'Bruschetta al pomodoro',
        descriptionShort: 'Pane tostato',
        basePrice: 6.5,
        vatPercent: 10,
        printDepartment: 'cucina',
      })
      .expect(201);
    const artId = art.body.data.id as string;

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/articles/${artId}`)
      .set(authHeader());

    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ id: artId, deleted: true });
  });
});
