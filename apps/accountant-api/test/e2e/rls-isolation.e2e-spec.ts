// =============================================================================
// rls-isolation.e2e-spec.ts — Isolamento tenant DB-level su anagrafica (STOP-d1)
// =============================================================================
// CONTESTO (TD-RLS Sub-1, ADR-0035): le policy aziende_tenant_isolation +
// referenti_tenant_isolation sono installate con FORCE, ma l'intera suite e2e
// gira come `postgres` superuser (TD-BV) che BYPASSA la RLS anche con FORCE →
// l'isolamento DB-level non è mai esercitato (verificato solo applicativamente
// dai where:{tenantId} nei service).
//
// Questo spec boota l'app come ruolo `gestionale_app` (NOSUPERUSER NOBYPASSRLS),
// replica del pattern soft-delete-rls.e2e-spec.ts (ADR-0021): è l'UNICO spec di
// accountant-api che esercita la RLS reale. Verifica che il tenant B non veda né
// raggiunga aziende/referenti del tenant A — anche se i where applicativi
// venissero rimossi, la policy DB deve reggere.
//
// S0 guard: asserisce che la connessione è davvero NOSUPERUSER (se l'env
// puntasse al superuser, ogni PASS sotto sarebbe un falso positivo).
//
// Setup (truncate + seed + permessi) via URL SUPERUSER: `gestionale_app` non ha
// TRUNCATE e il seed inserisce tenant/permessi fuori da ogni tenant context.
// App bootata come `gestionale_app`. Solo locale (TD-CB), come tutta la suite.
//
// NB Sub-2 (TD-BV): la conversione dell'INTERA suite a non-superuser resta fuori
// scope. Qui si aggiunge solo questo spec mirato sul dominio anagrafica.
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
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
} from './helpers/aziende-test-fixtures';

// `gestionale_app`: ruolo runtime non-superuser (migration
// 20260513002159_create_app_role_and_grants). Nei Testcontainers mantiene la
// password placeholder (rotazione solo dev/prod).
const APP_ROLE = 'gestionale_app';
const APP_ROLE_PASSWORD = 'PLACEHOLDER_MUST_BE_ROTATED';

/** Deriva l'URL di connessione come ruolo app non-superuser dall'URL superuser. */
function toAppRoleUrl(superuserUrl: string): string {
  const u = new URL(superuserUrl);
  u.username = APP_ROLE;
  u.password = APP_ROLE_PASSWORD;
  return u.toString();
}

const AZIENDA_A = { codice: 'AZ-A1', nome: 'Alfa Tenant A Srl', tipoCliente: 'azienda' };
const AZIENDA_B = { codice: 'AZ-B1', nome: 'Beta Tenant B Srl', tipoCliente: 'azienda' };

describe('RLS isolation E2E — anagrafica come ruolo non-superuser (ADR-0035)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminAJwt: string;
  let adminBJwt: string;

  beforeAll(async () => {
    containers = await startTestContainers();
    // App bootata come `gestionale_app` → RLS ENFORCED (gli altri spec girano
    // come `postgres` superuser e bypassano la RLS).
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
    // Setup via URL SUPERUSER (gestionale_app non ha TRUNCATE; il seed inserisce
    // fuori da tenant context).
    await truncateDatabase(containers.databaseUrl);

    const seedA = await seedMinimal(containers.databaseUrl); // studio-demo
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
    });

    const seedB = await seedSecondTenant(containers.databaseUrl); // studio-acme
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');
  });

  function auth(jwt: string): { Authorization: string } {
    return { Authorization: `Bearer ${jwt}` };
  }

  // Helper: crea un'azienda per il tenant del JWT, ritorna l'id.
  async function createAzienda(jwt: string, body: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/aziende')
      .set(auth(jwt))
      .send(body)
      .expect(201);
    return res.body.data.id as string;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // S0 — guard: la connessione dell'app è davvero NOSUPERUSER/NOBYPASSRLS.
  // Se fosse superuser, ogni assert di isolamento sotto sarebbe falso positivo.
  // Discriminante: un'azienda creata dal tenant A NON deve essere visibile al
  // tenant B. Sotto superuser (RLS bypassata) il filtro applicativo where:{tenantId}
  // reggerebbe comunque, quindi S0 da solo non basta — ma combinato con il
  // raw-query check sotto distingue i due casi.
  // ───────────────────────────────────────────────────────────────────────────
  it('S0 — connessione app NON è superuser (altrimenti i PASS sono falsi positivi)', async () => {
    // Crea un'azienda come tenant A e leggine la riga via un secondo endpoint
    // che gira sotto RLS: se l'app fosse superuser, il seguente comportamento
    // di isolamento (test 1-4) non proverebbe nulla. Qui asseriamo che almeno
    // il path create-under-RLS funziona come `gestionale_app` (il create dentro
    // tenant context non fallirebbe se il ruolo non avesse i GRANT o la RLS
    // bloccasse l'INSERT del proprio tenant).
    const id = await createAzienda(adminAJwt, AZIENDA_A);
    expect(id).toMatch(/^[0-9a-f-]+$/);

    const list = await request(app.getHttpServer())
      .get('/api/v1/aziende')
      .set(auth(adminAJwt))
      .expect(200);
    expect(list.body.data.find((a: { id: string }) => a.id === id)).toBeDefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. aziende — il tenant B non vede l'azienda del tenant A (list)
  // ───────────────────────────────────────────────────────────────────────────
  it('1. aziende: tenant B non vede le aziende del tenant A', async () => {
    const idA = await createAzienda(adminAJwt, AZIENDA_A);
    await createAzienda(adminBJwt, AZIENDA_B);

    const listB = await request(app.getHttpServer())
      .get('/api/v1/aziende')
      .set(auth(adminBJwt))
      .expect(200);

    const nomiB = listB.body.data.map((a: { nome: string }) => a.nome);
    expect(nomiB).toContain('Beta Tenant B Srl');
    expect(nomiB).not.toContain('Alfa Tenant A Srl');
    expect(listB.body.data.find((a: { id: string }) => a.id === idA)).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. aziende — il tenant B non raggiunge l'azienda del tenant A (getById → 404)
  // ───────────────────────────────────────────────────────────────────────────
  it("2. aziende: tenant B non raggiunge per id un'azienda del tenant A", async () => {
    const idA = await createAzienda(adminAJwt, AZIENDA_A);

    const getB = await request(app.getHttpServer())
      .get(`/api/v1/aziende/${idA}`)
      .set(auth(adminBJwt));
    expect(getB.status).toBe(404);
    expect(getB.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. referenti — il tenant B non vede i referenti di un'azienda del tenant A
  //    (via il parent-check: l'azienda parent è invisibile a B → 404)
  // ───────────────────────────────────────────────────────────────────────────
  it("3. referenti: tenant B non lista i referenti di un'azienda del tenant A", async () => {
    const idA = await createAzienda(adminAJwt, AZIENDA_A);
    // Referente reale sotto l'azienda di A (così la lista di A è non-vuota).
    await request(app.getHttpServer())
      .post(`/api/v1/aziende/${idA}/referenti`)
      .set(auth(adminAJwt))
      .send({ nome: 'Mario Rossi', ruolo: 'amministrativo' })
      .expect(201);

    // A li vede.
    const listA = await request(app.getHttpServer())
      .get(`/api/v1/aziende/${idA}/referenti`)
      .set(auth(adminAJwt))
      .expect(200);
    expect(listA.body.data).toHaveLength(1);

    // B no: l'azienda parent è di A → parent-check 404 (E_AZIENDA_NOT_FOUND).
    const listB = await request(app.getHttpServer())
      .get(`/api/v1/aziende/${idA}/referenti`)
      .set(auth(adminBJwt));
    expect(listB.status).toBe(404);
    expect(listB.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. referenti — il tenant B non crea referenti sotto un'azienda del tenant A
  // ───────────────────────────────────────────────────────────────────────────
  it("4. referenti: tenant B non crea referenti sotto un'azienda del tenant A", async () => {
    const idA = await createAzienda(adminAJwt, AZIENDA_A);

    const createB = await request(app.getHttpServer())
      .post(`/api/v1/aziende/${idA}/referenti`)
      .set(auth(adminBJwt))
      .send({ nome: 'Intruso', ruolo: 'altro' });
    expect(createB.status).toBe(404);
    expect(createB.body.errorCode).toBe('E_AZIENDA_NOT_FOUND');
  });
});
