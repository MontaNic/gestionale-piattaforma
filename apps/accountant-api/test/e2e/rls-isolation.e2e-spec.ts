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
// Codici admin verticale (anagrafica.* + preventivi.*) — riuso del catalogo dei
// fixtures preventivi per concedere `preventivi.{visualizza,gestisci}` agli admin.
import { PREVENTIVI_ADMIN_CODES } from './helpers/preventivi-test-fixtures';

// `gestionale_app`: ruolo runtime non-superuser (migration
// 20260513002159_create_app_role_and_grants). Nei Testcontainers mantiene la
// password placeholder (rotazione solo dev/prod).
const APP_ROLE = 'gestionale_app';
// DP-3 hardening (allineato al gate restaurant): pw da env, default = placeholder
// dei Testcontainers non-ruotati. Se un domani il substrato ruota la pw dell'app-role,
// basta TEST_APP_ROLE_PASSWORD.
const APP_ROLE_PASSWORD = process.env.TEST_APP_ROLE_PASSWORD ?? 'PLACEHOLDER_MUST_BE_ROTATED';

/** Deriva l'URL di connessione come ruolo app non-superuser dall'URL superuser. */
function toAppRoleUrl(superuserUrl: string): string {
  const u = new URL(superuserUrl);
  u.username = APP_ROLE;
  u.password = APP_ROLE_PASSWORD;
  return u.toString();
}

const AZIENDA_A = { codice: 'AZ-A1', nome: 'Alfa Tenant A Srl', tipoCliente: 'azienda' };
const AZIENDA_B = { codice: 'AZ-B1', nome: 'Beta Tenant B Srl', tipoCliente: 'azienda' };

// Payload preventivo con 2 voci (riusa la shape verificata di preventivi-crud).
// `codice` viene sovrascritto per-test per evitare collisioni partial-unique.
const PREV_BODY = {
  codice: 'PREV-RLS',
  oggetto: 'Preventivo isolamento RLS',
  voci: [
    {
      nome: 'Consulenza',
      unitaMisura: 'ora',
      quantita: 2,
      prezzoUnitario: 100,
      scontoPct: 10,
      ivaAliquota: 22,
    },
    {
      nome: 'Setup',
      unitaMisura: 'forfait',
      quantita: 1,
      prezzoUnitario: 50,
      scontoPct: 0,
      ivaAliquota: 22,
    },
  ],
};

describe('RLS isolation E2E — anagrafica come ruolo non-superuser (ADR-0035)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminAJwt: string;
  let adminBJwt: string;
  let tenantAId: string;
  let tenantBId: string;

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
    tenantAId = seedA.tenantId;
    // anagrafica.* + preventivi.* (superset) → un solo ruolo basta per i test
    // anagrafica (S0-4) e preventivi (S-prev-1..4).
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
      codes: [...PREVENTIVI_ADMIN_CODES],
    });

    const seedB = await seedSecondTenant(containers.databaseUrl); // studio-acme
    tenantBId = seedB.tenantId;
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      codes: [...PREVENTIVI_ADMIN_CODES],
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

  // Helper: crea un preventivo (testata + voci) sotto un'azienda, ritorna l'id.
  async function createPreventivo(
    jwt: string,
    aziendaId: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/aziende/${aziendaId}/preventivi`)
      .set(auth(jwt))
      .send(body)
      .expect(201);
    return res.body.data.id as string;
  }

  // Helper: query raw come ruolo `gestionale_app` (NOSUPERUSER/NOBYPASSRLS) con
  // il tenant context RLS impostato a `tenantId` (null = nessun tenant). Esercita
  // le policy DB-level direttamente (le policy leggono `app.tenant_id` /
  // `app.is_super_admin`, vedi migration). Usato dove non esiste un endpoint API
  // (es. conteggio righe `preventivi_voci`).
  async function queryAsAppRole<T extends Record<string, unknown>>(
    tenantId: string | null,
    sql: string,
  ): Promise<T[]> {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: toAppRoleUrl(containers.databaseUrl) });
    await client.connect();
    try {
      if (tenantId !== null) {
        await client.query(`SET app.tenant_id = '${tenantId}'`);
        await client.query(`SET app.is_super_admin = 'false'`);
      }
      const res = await client.query<T>(sql);
      return res.rows;
    } finally {
      await client.end();
    }
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

  // ═══════════════════════════════════════════════════════════════════════════
  // preventivi / preventivi_voci — isolamento DB-level (TD-RLS-preventivi)
  // ───────────────────────────────────────────────────────────────────────────
  // Le policy preventivi_tenant_isolation + preventivi_voci_tenant_isolation
  // sono installate con FORCE (ADR-0036) ma mai esercitate sotto RLS reale: qui,
  // come `gestionale_app`, si verifica che un tenant non veda né raggiunga i
  // preventivi/voci dell'altro. I preventivi demo del seed completo NON esistono
  // in questa suite (beforeEach: truncate + seedMinimal) → fixture creati via API.
  // ═══════════════════════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────────────────────
  // S-prev-0 — guard: la connessione raw come ruolo app è davvero
  // NOSUPERUSER/NOBYPASSRLS. Auto-diagnostico: se fosse superuser o bypassrls,
  // ogni assert di isolamento DB-level (S-prev-4) sarebbe un falso positivo.
  // ───────────────────────────────────────────────────────────────────────────
  it('S-prev-0 — la connessione app è gestionale_app, NON superuser/bypassrls', async () => {
    const rows = await queryAsAppRole<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      null,
      `SELECT current_user, r.rolsuper, r.rolbypassrls
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.current_user).toBe(APP_ROLE);
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S-prev-1 — list preventivi del tenant A → vede solo i propri.
  // ───────────────────────────────────────────────────────────────────────────
  it('S-prev-1 — tenant A lista solo i propri preventivi (non quelli di B)', async () => {
    const azA = await createAzienda(adminAJwt, AZIENDA_A);
    const azB = await createAzienda(adminBJwt, AZIENDA_B);
    await createPreventivo(adminAJwt, azA, { ...PREV_BODY, codice: 'PREV-A1' });
    await createPreventivo(adminBJwt, azB, { ...PREV_BODY, codice: 'PREV-B1' });

    const listA = await request(app.getHttpServer())
      .get(`/api/v1/aziende/${azA}/preventivi`)
      .set(auth(adminAJwt))
      .expect(200);

    const codiciA = listA.body.data.map((p: { codice: string }) => p.codice);
    expect(codiciA).toContain('PREV-A1');
    expect(codiciA).not.toContain('PREV-B1');
    expect(listA.body.data).toHaveLength(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S-prev-2 — list preventivi del tenant B → vede solo i propri (simmetrico).
  // ───────────────────────────────────────────────────────────────────────────
  it('S-prev-2 — tenant B lista solo i propri preventivi (non quelli di A)', async () => {
    const azA = await createAzienda(adminAJwt, AZIENDA_A);
    const azB = await createAzienda(adminBJwt, AZIENDA_B);
    await createPreventivo(adminAJwt, azA, { ...PREV_BODY, codice: 'PREV-A1' });
    await createPreventivo(adminBJwt, azB, { ...PREV_BODY, codice: 'PREV-B1' });

    const listB = await request(app.getHttpServer())
      .get(`/api/v1/aziende/${azB}/preventivi`)
      .set(auth(adminBJwt))
      .expect(200);

    const codiciB = listB.body.data.map((p: { codice: string }) => p.codice);
    expect(codiciB).toContain('PREV-B1');
    expect(codiciB).not.toContain('PREV-A1');
    expect(listB.body.data).toHaveLength(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S-prev-3 — getById di un preventivo di A dal contesto B → 404 (isolamento).
  // ───────────────────────────────────────────────────────────────────────────
  it('S-prev-3 — tenant B non raggiunge per id un preventivo del tenant A', async () => {
    const azA = await createAzienda(adminAJwt, AZIENDA_A);
    const prevA = await createPreventivo(adminAJwt, azA, { ...PREV_BODY, codice: 'PREV-A1' });

    // A lo raggiunge.
    await request(app.getHttpServer())
      .get(`/api/v1/aziende/${azA}/preventivi/${prevA}`)
      .set(auth(adminAJwt))
      .expect(200);

    // B no: la riga è del tenant A → invisibile sotto RLS → E_PREVENTIVO_NOT_FOUND.
    const getB = await request(app.getHttpServer())
      .get(`/api/v1/aziende/${azA}/preventivi/${prevA}`)
      .set(auth(adminBJwt));
    expect(getB.status).toBe(404);
    expect(getB.body.errorCode).toBe('E_PREVENTIVO_NOT_FOUND');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S-prev-4 — preventivi_voci: con il tenant context impostato, una SELECT
  // raw vede solo le voci dei propri preventivi (esercizio DB-level diretto
  // della policy preventivi_voci_tenant_isolation: nessun endpoint lista le voci).
  // ───────────────────────────────────────────────────────────────────────────
  it('S-prev-4 — preventivi_voci: ogni tenant vede solo le proprie voci (DB-level)', async () => {
    const azA = await createAzienda(adminAJwt, AZIENDA_A);
    const azB = await createAzienda(adminBJwt, AZIENDA_B);
    // 2 voci ciascuno (PREV_BODY ha 2 voci) → 4 righe totali in preventivi_voci.
    await createPreventivo(adminAJwt, azA, { ...PREV_BODY, codice: 'PREV-A1' });
    await createPreventivo(adminBJwt, azB, { ...PREV_BODY, codice: 'PREV-B1' });

    const countFor = async (tenantId: string): Promise<number> => {
      const rows = await queryAsAppRole<{ count: string }>(
        tenantId,
        'SELECT count(*)::int AS count FROM preventivi_voci',
      );
      return Number(rows[0]?.count);
    };

    // Sotto RLS reale ogni tenant vede solo le sue 2 voci (non 4).
    expect(await countFor(tenantAId)).toBe(2);
    expect(await countFor(tenantBId)).toBe(2);
  });
});
