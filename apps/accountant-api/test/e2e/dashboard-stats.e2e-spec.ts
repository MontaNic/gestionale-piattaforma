// =============================================================================
// dashboard-stats.e2e-spec.ts (STOP-dash1) — E2E GET /dashboard/stats
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest. Verifica
// l'aggregazione tenant-level (count/groupBy/aggregate) su dati noti creati via
// API. Coverage:
//   1. stats con dati noti → clienti(totale/attivi/nonAttivi/perTipo) + preventivi corretti
//   2. ultimi: ≤5, ordinati updatedAt desc, aziendaNome valorizzato
//   3. isolamento: tenant B vede solo i propri conteggi (dati distinti da A)
//   4. RBAC: utente senza anagrafica.cliente.visualizza → 403
//
// Suite superuser (TD-BV): isolamento qui è applicativo (RLS DB-level coperto da
// rls-isolation.e2e-spec). ValidationPipe inattiva in e2e (TD-BS Sub-2).
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
  PREVENTIVI_ADMIN_CODES,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedPreventiviViewer,
} from './helpers/preventivi-test-fixtures';

const STATS = '/api/v1/dashboard/stats';

// Una voce con totale = prezzo * 1.22 (iva 22%, sconto 0).
function voce(prezzo: number) {
  return {
    nome: 'Servizio',
    unitaMisura: 'forfait',
    quantita: 1,
    prezzoUnitario: prezzo,
    scontoPct: 0,
    ivaAliquota: 22,
  };
}

describe('Dashboard stats E2E — GET /api/v1/dashboard/stats', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let adminAJwt: string;
  let adminBJwt: string;
  let viewerJwt: string; // solo preventivi.visualizza → niente anagrafica.cliente.visualizza

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

    const seedA = await seedMinimal(containers.databaseUrl); // studio-demo
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedA.tenantId,
      userId: seedA.adminUserId,
      roleName: 'Dashboard Admin',
      codes: [...PREVENTIVI_ADMIN_CODES],
    });
    const viewer = await seedPreventiviViewer(containers.databaseUrl, { tenantId: seedA.tenantId });

    const seedB = await seedSecondTenant(containers.databaseUrl); // studio-acme
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seedB.tenantId,
      userId: seedB.adminUserId,
      roleName: 'Dashboard Admin',
      codes: [...PREVENTIVI_ADMIN_CODES],
    });

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    adminAJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    adminBJwt = await loginAs(app, 'studio-acme', 'admin@studio-acme.local', 'Admin123!');
    viewerJwt = await loginAs(app, 'studio-demo', viewer.email, viewer.password);
  });

  function auth(jwt: string): { Authorization: string } {
    return { Authorization: `Bearer ${jwt}` };
  }

  async function createAzienda(jwt: string, body: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/aziende')
      .set(auth(jwt))
      .send(body)
      .expect(201);
    return res.body.data.id as string;
  }

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

  async function patchStato(
    jwt: string,
    aziendaId: string,
    preventivoId: string,
    stato: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/v1/aziende/${aziendaId}/preventivi/${preventivoId}`)
      .set(auth(jwt))
      .send({ stato })
      .expect(200);
  }

  /** Popola il tenant A con dati noti. Ritorna l'id dell'azienda parent dei preventivi. */
  async function seedTenantAData(): Promise<string> {
    // 3 aziende: 2 azienda (1 disattivata) + 1 persona_fisica.
    const azA1 = await createAzienda(adminAJwt, {
      codice: 'AZ-A1',
      nome: 'Alfa SpA',
      tipoCliente: 'azienda',
    });
    await createAzienda(adminAJwt, {
      codice: 'AZ-A2',
      nome: 'Mario Bianchi',
      tipoCliente: 'persona_fisica',
    });
    await createAzienda(adminAJwt, {
      codice: 'AZ-A3',
      nome: 'Gamma Srl',
      tipoCliente: 'azienda',
      attivo: false,
    });

    // 3 preventivi su AZ-A1: totali 122 + 244 + 61 = 427.
    const p1 = await createPreventivo(adminAJwt, azA1, {
      codice: 'PA-1',
      oggetto: 'Uno',
      voci: [voce(100)],
    }); // totale 122, stato bozza (default)
    const p2 = await createPreventivo(adminAJwt, azA1, {
      codice: 'PA-2',
      oggetto: 'Due',
      voci: [voce(200)],
    }); // totale 244
    const p3 = await createPreventivo(adminAJwt, azA1, {
      codice: 'PA-3',
      oggetto: 'Tre',
      voci: [voce(50)],
    }); // totale 61
    await patchStato(adminAJwt, azA1, p2, 'inviato');
    await patchStato(adminAJwt, azA1, p3, 'accettato');
    void p1;
    return azA1;
  }

  // ───────────────────────────────────────────────────────────────────────────
  it('1. stats su dati noti → conteggi/somme corretti', async () => {
    await seedTenantAData();

    const res = await request(app.getHttpServer()).get(STATS).set(auth(adminAJwt)).expect(200);
    const stats = res.body.data;

    // Taglio stato: 3 aziende totali, AZ-A3 disattivata.
    expect(stats.clienti.totale).toBe(3);
    expect(stats.clienti.attivi).toBe(2);
    expect(stats.clienti.nonAttivi).toBe(1);
    // Invariante: i due sotto-conteggi (3 query indipendenti) sommano al totale.
    expect(stats.clienti.attivi + stats.clienti.nonAttivi).toBe(stats.clienti.totale);
    // Taglio tipo (ortogonale, NON filtra attivo).
    expect(stats.clienti.perTipo).toEqual({ azienda: 2, personaFisica: 1 });

    expect(stats.preventivi.totale).toBe(3);
    expect(stats.preventivi.perStato).toEqual({ bozza: 1, inviato: 1, accettato: 1, rifiutato: 0 });
    expect(stats.preventivi.valoreTotale).toBe(427);
  });

  // ───────────────────────────────────────────────────────────────────────────
  it('2. ultimi: ≤5, ordinati updatedAt desc, aziendaNome valorizzato', async () => {
    await seedTenantAData();

    const res = await request(app.getHttpServer()).get(STATS).set(auth(adminAJwt)).expect(200);
    const ultimi = res.body.data.preventivi.ultimi as Array<{
      codice: string;
      aziendaNome: string;
      updatedAt: string;
      totale: number;
    }>;

    expect(ultimi.length).toBe(3);
    expect(ultimi.length).toBeLessThanOrEqual(5);
    expect(ultimi.map((u) => u.codice).sort()).toEqual(['PA-1', 'PA-2', 'PA-3']);
    expect(ultimi.every((u) => u.aziendaNome === 'Alfa SpA')).toBe(true);
    expect(ultimi.every((u) => typeof u.totale === 'number')).toBe(true);

    const ts = ultimi.map((u) => new Date(u.updatedAt).getTime());
    expect(ts).toEqual([...ts].sort((a, b) => b - a)); // monotono desc
  });

  // ───────────────────────────────────────────────────────────────────────────
  it('3. isolamento: tenant B vede solo i propri conteggi', async () => {
    await seedTenantAData(); // tenant A: 3 aziende, 3 preventivi, valore 427

    // tenant B: 1 azienda + 1 preventivo (totale 1220).
    const azB = await createAzienda(adminBJwt, {
      codice: 'AZ-B1',
      nome: 'Beta Srl',
      tipoCliente: 'azienda',
    });
    await createPreventivo(adminBJwt, azB, { codice: 'PB-1', oggetto: 'B', voci: [voce(1000)] });

    const resB = await request(app.getHttpServer()).get(STATS).set(auth(adminBJwt)).expect(200);
    expect(resB.body.data.clienti.totale).toBe(1);
    expect(resB.body.data.preventivi.totale).toBe(1);
    expect(resB.body.data.preventivi.valoreTotale).toBe(1220);

    // tenant A non è stato influenzato.
    const resA = await request(app.getHttpServer()).get(STATS).set(auth(adminAJwt)).expect(200);
    expect(resA.body.data.preventivi.totale).toBe(3);
    expect(resA.body.data.preventivi.valoreTotale).toBe(427);
  });

  // ───────────────────────────────────────────────────────────────────────────
  it('4. RBAC: utente senza anagrafica.cliente.visualizza → 403', async () => {
    const res = await request(app.getHttpServer()).get(STATS).set(auth(viewerJwt));
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });
});
