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
// DP-3 hardening: pw da env, default = placeholder dei Testcontainers non-ruotati.
// Se un domani il substrato ruota la pw dell'app-role, basta TEST_APP_ROLE_PASSWORD.
const APP_ROLE_PASSWORD = process.env.TEST_APP_ROLE_PASSWORD ?? 'PLACEHOLDER_MUST_BE_ROTATED';

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

  // ===========================================================================
  // TD-BZ — Unicità nome soft-delete-aware (ADR-0023)
  // ===========================================================================
  // I partial unique index `WHERE deleted_at IS NULL` (migration td_bz_*) allineano
  // la regola DB al pre-check applicativo (`findFirst` esclude i soft-deleted):
  //   - ricreare il nome di un'entità soft-deleted → legale (pre-fix: P2002 → 500)
  //   - duplicare il nome tra entità ATTIVE → ancora bloccato (409 E_*_NAME_EXISTS)
  // Verificato sotto ruolo `gestionale_app` non-superuser (RLS reale).
  // ===========================================================================
  describe('TD-BZ — riuso nome soft-deleted / blocco duplicati attivi', () => {
    const srv = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();

    async function createMenu(name: string): Promise<string> {
      const res = await request(srv()).post('/api/v1/menus').set(authHeader()).send({ name });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    }

    it('Menu: ricreare il nome di un menu soft-deleted → 201 (riuso legale)', async () => {
      const id = await createMenu('Menù Estivo');
      await request(srv()).delete(`/api/v1/menus/${id}`).set(authHeader()).expect(200);

      const recreated = await request(srv())
        .post('/api/v1/menus')
        .set(authHeader())
        .send({ name: 'Menù Estivo' });

      expect(recreated.status).toBe(201);
      expect(recreated.body.data.id).not.toBe(id);
    });

    it('Menu: due menu ATTIVI omonimi → 409 E_MENU_NAME_EXISTS', async () => {
      await createMenu('Menù Invernale');
      const dup = await request(srv())
        .post('/api/v1/menus')
        .set(authHeader())
        .send({ name: 'Menù Invernale' });

      expect(dup.status).toBe(409);
      expect(dup.body.errorCode).toBe('E_MENU_NAME_EXISTS');
    });

    it('PriceList: ricreare il nome di un listino soft-deleted → 201 (riuso legale)', async () => {
      const create = await request(srv())
        .post('/api/v1/price-lists')
        .set(authHeader())
        .send({ name: 'Listino Delivery', channels: ['delivery'] });
      expect(create.status).toBe(201);
      await request(srv())
        .delete(`/api/v1/price-lists/${create.body.data.id}`)
        .set(authHeader())
        .expect(200);

      const recreated = await request(srv())
        .post('/api/v1/price-lists')
        .set(authHeader())
        .send({ name: 'Listino Delivery', channels: ['delivery'] });

      expect(recreated.status).toBe(201);
      expect(recreated.body.data.id).not.toBe(create.body.data.id);
    });

    it('PriceList: due listini ATTIVI omonimi → 409 E_PRICE_LIST_NAME_EXISTS', async () => {
      await request(srv())
        .post('/api/v1/price-lists')
        .set(authHeader())
        .send({ name: 'Listino Sala', channels: ['cassa'] })
        .expect(201);
      const dup = await request(srv())
        .post('/api/v1/price-lists')
        .set(authHeader())
        .send({ name: 'Listino Sala', channels: ['cassa'] });

      expect(dup.status).toBe(409);
      expect(dup.body.errorCode).toBe('E_PRICE_LIST_NAME_EXISTS');
    });

    it('MenuCategory: ricreare il nome di una categoria soft-deletata → 201', async () => {
      const menuId = await createMenu('Menù Cat-Test');
      const cat = await request(srv())
        .post(`/api/v1/menus/${menuId}/categories`)
        .set(authHeader())
        .send({ name: 'Antipasti' });
      expect(cat.status).toBe(201);
      await request(srv())
        .delete(`/api/v1/menus/${menuId}/categories/${cat.body.data.id}`)
        .set(authHeader())
        .expect(200);

      const recreated = await request(srv())
        .post(`/api/v1/menus/${menuId}/categories`)
        .set(authHeader())
        .send({ name: 'Antipasti' });

      expect(recreated.status).toBe(201);
      expect(recreated.body.data.id).not.toBe(cat.body.data.id);
    });

    it('MenuCategory: due categorie ATTIVE omonime nello stesso menu → 409', async () => {
      const menuId = await createMenu('Menù Cat-Dup');
      await request(srv())
        .post(`/api/v1/menus/${menuId}/categories`)
        .set(authHeader())
        .send({ name: 'Primi' })
        .expect(201);
      const dup = await request(srv())
        .post(`/api/v1/menus/${menuId}/categories`)
        .set(authHeader())
        .send({ name: 'Primi' });

      expect(dup.status).toBe(409);
      expect(dup.body.errorCode).toBe('E_MENU_CATEGORY_NAME_EXISTS');
    });

    it('Article: ricreare il nome di un articolo soft-deletato → 201', async () => {
      const menuId = await createMenu('Menù Art-Test');
      const cat = await request(srv())
        .post(`/api/v1/menus/${menuId}/categories`)
        .set(authHeader())
        .send({ name: 'Pizze' })
        .expect(201);
      const payload = {
        categoryId: cat.body.data.id as string,
        name: 'Margherita',
        descriptionShort: 'Pomodoro e mozzarella',
        basePrice: 6.5,
        vatPercent: 10,
        printDepartment: 'pizzeria',
      };
      const art = await request(srv()).post('/api/v1/articles').set(authHeader()).send(payload);
      expect(art.status).toBe(201);
      await request(srv())
        .delete(`/api/v1/articles/${art.body.data.id}`)
        .set(authHeader())
        .expect(200);

      const recreated = await request(srv())
        .post('/api/v1/articles')
        .set(authHeader())
        .send(payload);

      expect(recreated.status).toBe(201);
      expect(recreated.body.data.id).not.toBe(art.body.data.id);
    });

    it('Article: due articoli ATTIVI omonimi nella stessa categoria → 409', async () => {
      const menuId = await createMenu('Menù Art-Dup');
      const cat = await request(srv())
        .post(`/api/v1/menus/${menuId}/categories`)
        .set(authHeader())
        .send({ name: 'Dolci' })
        .expect(201);
      const payload = {
        categoryId: cat.body.data.id as string,
        name: 'Tiramisù',
        descriptionShort: 'Classico',
        basePrice: 5,
        vatPercent: 10,
        printDepartment: 'cucina',
      };
      await request(srv()).post('/api/v1/articles').set(authHeader()).send(payload).expect(201);
      const dup = await request(srv()).post('/api/v1/articles').set(authHeader()).send(payload);

      expect(dup.status).toBe(409);
      expect(dup.body.errorCode).toBe('E_ARTICLE_NAME_EXISTS');
    });
  });
});
