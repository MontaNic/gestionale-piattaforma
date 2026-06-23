// =============================================================================
// portale-circolari.e2e-spec.ts (ADR-0048) — lettore circolari lato cliente
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest.
// Livello 2 (portale cliente): read + markLetta on-open + conferma. L'operatore
// studio crea/pubblica le circolari via la superficie studio (/circolari); il
// cliente le legge via /portale/circolari. Pattern di riferimento:
// portale-cliente-identity (seed cliente) + circolari-crud (authoring studio).
// Coverage:
//   1.  cliente: GET /portale/circolari → solo PUBBLICATE indirizzate (tutti) — letta=false
//   2.  bozza non pubblicata → NON visibile al cliente
//   3.  destinatario azienda → visibile solo al cliente di quell'azienda (isolamento)
//   4.  GET /portale/circolari/:id → 200 + bodyHtml; segna letta=true (markLetta on-open)
//   5.  archiviata → esce dalla lista cliente
//   6.  conferma su circolare con richiedeConferma=true → 200 + confermata=true (idempotente)
//   7.  conferma su circolare senza richiedeConferma → 422 E_CIRCOLARE_NO_CONFERMA
//   8.  cliente accede a circolare di altra azienda per id → 404 (no leak)
//   9.  RBAC: operatore (no portale.*) → GET /portale/circolari = 403
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
  CIRCOLARI_ADMIN_CODES,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
} from './helpers/circolari-test-fixtures';
import { seedClientePortale } from './helpers/portale-test-fixtures';

const STUDIO = '/api/v1/circolari';
const PORTALE = '/api/v1/portale/circolari';
const PORTALE_CIRCOLARI_CODES = ['portale.circolari.visualizza'] as const;

describe('Portale circolari — lettore cliente E2E (ADR-0048)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let operatoreJwt: string;
  let cliente1Jwt: string;
  let cliente2Jwt: string;
  let azienda1Id: string;
  let azienda2Id: string;

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

    // Operatore studio: anagrafica.cliente.* + circolari.* (authoring/publish).
    const seed = await seedMinimal(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seed.tenantId,
      userId: seed.adminUserId,
      roleName: 'Circolari Admin',
      codes: [...CIRCOLARI_ADMIN_CODES],
    });

    // Due clienti in due aziende distinte, entrambi con portale.circolari.visualizza.
    const cliente1 = await seedClientePortale(containers.databaseUrl, {
      tenantId: seed.tenantId,
      email: 'cliente1@studio.local',
      aziendaCodice: 'AZ-CIRC-1',
      codes: PORTALE_CIRCOLARI_CODES,
    });
    const cliente2 = await seedClientePortale(containers.databaseUrl, {
      tenantId: seed.tenantId,
      email: 'cliente2@studio.local',
      aziendaCodice: 'AZ-CIRC-2',
      codes: PORTALE_CIRCOLARI_CODES,
    });
    azienda1Id = cliente1.aziendaId;
    azienda2Id = cliente2.aziendaId;

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    operatoreJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    cliente1Jwt = await loginAs(app, 'studio-demo', cliente1.email, cliente1.password);
    cliente2Jwt = await loginAs(app, 'studio-demo', cliente2.email, cliente2.password);
  });

  // ── Helper: crea (e opzionalmente pubblica) una circolare via superficie studio ──
  async function createCircolare(body: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(STUDIO)
      .set('Authorization', `Bearer ${operatoreJwt}`)
      .send(body)
      .expect(201);
    return res.body.data.id as string;
  }

  async function publish(id: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`${STUDIO}/${id}/publish`)
      .set('Authorization', `Bearer ${operatoreJwt}`)
      .expect(200);
  }

  function portaleList(jwt: string): request.Test {
    return request(app.getHttpServer()).get(PORTALE).set('Authorization', `Bearer ${jwt}`);
  }

  it('1. cliente vede solo le circolari pubblicate indirizzate a tutti (letta=false)', async () => {
    const id = await createCircolare({
      titolo: 'Aggiornamento normativo',
      oggettoEmail: 'Novità',
      bodyHtml: 'Gentili clienti, aggiornamenti.',
      destinatari: [{ tipo: 'tutti' }],
    });
    await publish(id);

    const res = await portaleList(cliente1Jwt).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id,
      titolo: 'Aggiornamento normativo',
      letta: false,
      confermata: false,
      richiedeConferma: false,
    });
  });

  it('2. una bozza non pubblicata non è visibile al cliente', async () => {
    await createCircolare({
      titolo: 'Bozza interna',
      oggettoEmail: 'WIP',
      bodyHtml: 'Non ancora pubblicata.',
      destinatari: [{ tipo: 'tutti' }],
    });

    const res = await portaleList(cliente1Jwt).expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('3. destinatario azienda: visibile solo al cliente di quell’azienda', async () => {
    const id = await createCircolare({
      titolo: 'Solo per Azienda 1',
      oggettoEmail: 'Riservata',
      bodyHtml: 'Comunicazione mirata.',
      destinatari: [{ tipo: 'azienda', aziendaId: azienda1Id }],
    });
    await publish(id);

    const res1 = await portaleList(cliente1Jwt).expect(200);
    expect(res1.body.data.map((c: { id: string }) => c.id)).toContain(id);

    const res2 = await portaleList(cliente2Jwt).expect(200);
    expect(res2.body.data).toEqual([]);
  });

  it('4. GET dettaglio espone bodyHtml e segna la circolare come letta', async () => {
    const id = await createCircolare({
      titolo: 'Da leggere',
      oggettoEmail: 'Apri',
      bodyHtml: 'Corpo della circolare.',
      destinatari: [{ tipo: 'tutti' }],
    });
    await publish(id);

    const detail = await request(app.getHttpServer())
      .get(`${PORTALE}/${id}`)
      .set('Authorization', `Bearer ${cliente1Jwt}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({ id, bodyHtml: 'Corpo della circolare.', letta: true });

    // markLetta riflesso nella lista (idempotente).
    const list = await portaleList(cliente1Jwt).expect(200);
    expect(list.body.data[0]).toMatchObject({ id, letta: true });
  });

  it('5. una circolare archiviata esce dalla lista cliente', async () => {
    const id = await createCircolare({
      titolo: 'Temporanea',
      oggettoEmail: 'Scade',
      bodyHtml: 'Sarà archiviata.',
      destinatari: [{ tipo: 'tutti' }],
    });
    await publish(id);
    await request(app.getHttpServer())
      .post(`${STUDIO}/${id}/archive`)
      .set('Authorization', `Bearer ${operatoreJwt}`)
      .expect(200);

    const res = await portaleList(cliente1Jwt).expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('6. conferma su circolare con richiedeConferma=true → confermata=true (idempotente)', async () => {
    const id = await createCircolare({
      titolo: 'Presa visione obbligatoria',
      oggettoEmail: 'Conferma',
      bodyHtml: 'Conferma la lettura.',
      richiedeConferma: true,
      destinatari: [{ tipo: 'tutti' }],
    });
    await publish(id);

    const first = await request(app.getHttpServer())
      .post(`${PORTALE}/${id}/conferma`)
      .set('Authorization', `Bearer ${cliente1Jwt}`)
      .expect(200);
    expect(first.body.data.confermataAt).toBeTruthy();

    // Idempotente: la seconda conferma restituisce lo stesso timestamp.
    const second = await request(app.getHttpServer())
      .post(`${PORTALE}/${id}/conferma`)
      .set('Authorization', `Bearer ${cliente1Jwt}`)
      .expect(200);
    expect(second.body.data.confermataAt).toBe(first.body.data.confermataAt);

    const list = await portaleList(cliente1Jwt).expect(200);
    expect(list.body.data[0]).toMatchObject({ id, letta: true, confermata: true });
  });

  it('7. conferma su circolare che non la richiede → 422 E_CIRCOLARE_NO_CONFERMA', async () => {
    const id = await createCircolare({
      titolo: 'Senza conferma',
      oggettoEmail: 'Info',
      bodyHtml: 'Nessuna conferma richiesta.',
      destinatari: [{ tipo: 'tutti' }],
    });
    await publish(id);

    const res = await request(app.getHttpServer())
      .post(`${PORTALE}/${id}/conferma`)
      .set('Authorization', `Bearer ${cliente1Jwt}`)
      .expect(422);
    expect(res.body.errorCode).toBe('E_CIRCOLARE_NO_CONFERMA');
  });

  it('8. cliente accede a circolare di altra azienda per id → 404 (no leak)', async () => {
    const id = await createCircolare({
      titolo: 'Solo Azienda 2',
      oggettoEmail: 'Riservata',
      bodyHtml: 'Non per Azienda 1.',
      destinatari: [{ tipo: 'azienda', aziendaId: azienda2Id }],
    });
    await publish(id);

    await request(app.getHttpServer())
      .get(`${PORTALE}/${id}`)
      .set('Authorization', `Bearer ${cliente1Jwt}`)
      .expect(404);
  });

  it('9. RBAC: l’operatore non ha portale.* → GET /portale/circolari = 403', async () => {
    await request(app.getHttpServer())
      .get(PORTALE)
      .set('Authorization', `Bearer ${operatoreJwt}`)
      .expect(403);
  });
});
