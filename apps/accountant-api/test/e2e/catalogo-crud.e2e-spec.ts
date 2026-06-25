// =============================================================================
// catalogo-crud.e2e-spec.ts (ADR-0050) — E2E CRUD catalogo servizi + categorie
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest.
// Pattern di riferimento: scadenze-crud (platform/custom scoping, viewer RBAC,
// isolamento cross-tenant).
// Coverage:
//   1.  GET /catalogo/categorie → include le 6 categorie platform (per ogni tenant)
//   2.  POST /catalogo/categorie → 201 categoria custom (tenant A)
//   3.  visibilità: tenant A vede platform + propria; tenant B solo platform
//   4.  PATCH categoria platform → 403 (read-only)
//   5.  DELETE categoria platform → 403 (read-only)
//   6.  GET /catalogo/servizi → include i 20 servizi platform
//   7.  POST /catalogo/servizi → 201 servizio custom (tenant A)
//   8.  PATCH servizio platform → 403 (read-only)
//   9.  isolamento: servizio custom di A non visibile a B
//   10. RBAC: viewer (solo servizi.visualizza) → POST servizio 403
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
  CATALOGO_ADMIN_CODES,
  CATALOGO_CATEGORIE_PIATTAFORMA_COUNT,
  CATALOGO_SERVIZI_PIATTAFORMA_COUNT,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedCatalogoPiattaforma,
  seedCatalogoViewer,
} from './helpers/catalogo-test-fixtures';

const CAT_BASE = '/api/v1/catalogo/categorie';
const SVC_BASE = '/api/v1/catalogo/servizi';

interface Row {
  id: string;
  tenantId: string | null;
}

describe('Catalogo CRUD E2E — /api/v1/catalogo', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminAJwt: string;
  let viewerJwt: string;
  let adminBJwt: string;
  let platformCategoriaId: string;
  let platformServizioId: string;

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

    // Catalogo piattaforma (tenant_id NULL) — migrate deploy non lo seeda.
    const platform = await seedCatalogoPiattaforma(containers.databaseUrl);
    platformCategoriaId = platform.categoriaId;
    platformServizioId = platform.servizioId;

    // Tenant A (studio-demo) + admin con servizi.*
    const seedA = await seedMinimal(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
      roleName: 'Catalogo Admin',
      codes: [...CATALOGO_ADMIN_CODES],
    });
    const viewer = await seedCatalogoViewer(containers.databaseUrl, { tenantId: seedA.tenantId });

    // Tenant B (studio-acme) + admin con gli stessi permessi (per l'isolamento)
    const seedB = await seedSecondTenant(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      roleName: 'Catalogo Admin',
      codes: [...CATALOGO_ADMIN_CODES],
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'studio-demo', viewer.email, viewer.password);
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');
  });

  function get(path: string, jwt: string) {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${jwt}`);
  }
  function post(path: string, jwt: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${jwt}`).send(body);
  }

  it('1. GET /catalogo/categorie → include le 6 categorie platform per ogni tenant', async () => {
    const resA = await get(CAT_BASE, adminAJwt).expect(200);
    const resB = await get(CAT_BASE, adminBJwt).expect(200);
    const platformA = (resA.body.data as Row[]).filter((c) => c.tenantId === null);
    const platformB = (resB.body.data as Row[]).filter((c) => c.tenantId === null);
    expect(platformA.length).toBe(CATALOGO_CATEGORIE_PIATTAFORMA_COUNT);
    expect(platformB.length).toBe(CATALOGO_CATEGORIE_PIATTAFORMA_COUNT);
  });

  it('2. POST /catalogo/categorie → 201 categoria custom (tenant A)', async () => {
    const res = await post(CAT_BASE, adminAJwt, { nome: 'Categoria Studio', colore: '#123456' });
    expect(res.status).toBe(201);
    expect(res.body.data.nome).toBe('Categoria Studio');
    expect(res.body.data.tenantId).not.toBeNull();
  });

  it('3. visibilità: A vede platform + propria, B vede solo platform', async () => {
    await post(CAT_BASE, adminAJwt, { nome: 'Solo di A' }).expect(201);

    const resA = await get(CAT_BASE, adminAJwt).expect(200);
    const resB = await get(CAT_BASE, adminBJwt).expect(200);
    const nomiA = (resA.body.data as Array<{ nome: string }>).map((c) => c.nome);
    const nomiB = (resB.body.data as Array<{ nome: string }>).map((c) => c.nome);

    expect(nomiA).toContain('Solo di A');
    expect(nomiB).not.toContain('Solo di A');
    // entrambi vedono le platform
    expect((resB.body.data as Row[]).filter((c) => c.tenantId === null).length).toBe(
      CATALOGO_CATEGORIE_PIATTAFORMA_COUNT,
    );
  });

  it('4. PATCH categoria platform → 403 (read-only)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${CAT_BASE}/${platformCategoriaId}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ nome: 'Hijack' });
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_SERVIZIO_CATEGORIA_PLATFORM_READONLY');
  });

  it('5. DELETE categoria platform → 403 (read-only)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`${CAT_BASE}/${platformCategoriaId}`)
      .set('Authorization', `Bearer ${adminAJwt}`);
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_SERVIZIO_CATEGORIA_PLATFORM_READONLY');
  });

  it('6. GET /catalogo/servizi → include i 20 servizi platform', async () => {
    const res = await get(SVC_BASE, adminAJwt).expect(200);
    const platform = (res.body.data as Row[]).filter((s) => s.tenantId === null);
    expect(platform.length).toBe(CATALOGO_SERVIZI_PIATTAFORMA_COUNT);
  });

  it('7. POST /catalogo/servizi → 201 servizio custom (tenant A)', async () => {
    const res = await post(SVC_BASE, adminAJwt, {
      codice: 'STUDIO-01',
      nome: 'Servizio custom studio',
      prezzoBase: 250,
      unitaMisura: 'ora',
      tipoRicorrenza: 'una_tantum',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.codice).toBe('STUDIO-01');
    expect(res.body.data.tenantId).not.toBeNull();
  });

  it('8. PATCH servizio platform → 403 (read-only)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${SVC_BASE}/${platformServizioId}`)
      .set('Authorization', `Bearer ${adminAJwt}`)
      .send({ prezzoBase: 1 });
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_SERVIZIO_PLATFORM_READONLY');
  });

  it('9. isolamento: servizio custom di A non visibile a B', async () => {
    await post(SVC_BASE, adminAJwt, {
      codice: 'A-ONLY',
      nome: 'Servizio solo di A',
      prezzoBase: 99,
    }).expect(201);

    const resB = await get(SVC_BASE, adminBJwt).expect(200);
    const codiciB = (resB.body.data as Array<{ codice: string }>).map((s) => s.codice);
    expect(codiciB).not.toContain('A-ONLY');
  });

  it('10. RBAC: viewer (solo servizi.visualizza) → POST servizio 403', async () => {
    const res = await post(SVC_BASE, viewerJwt, {
      codice: 'VIEW-01',
      nome: 'Tentativo viewer',
      prezzoBase: 10,
    });
    expect(res.status).toBe(403);
  });
});
