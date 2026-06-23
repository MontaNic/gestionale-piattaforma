// =============================================================================
// circolari-report.e2e-spec.ts (ADR-0048 §1) — report letture lato studio
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest.
// Consumer del permesso `circolari.read_report`: GET /circolari/:id/report
// restituisce il set destinatari ATTESO (risoluzione 'tutti'→tutti i clienti del
// tenant, 'azienda'→clienti dell'azienda) incrociato con lo stato lettura/conferma
// (circolari_letture). Il Socio (read_report) vede il report; il Collaboratore
// (solo circolari.create) no (403). Le letture/conferme sono generate dai clienti
// via la superficie portale (markLetta on-open + conferma), come in ADR-0048.
// Coverage:
//   1. RBAC: Collaboratore (no read_report) → 403
//   2. RBAC: Socio (read_report) → 200 + shape summary
//   3. risoluzione 'tutti' → attesi = tutti i clienti del tenant
//   4. risoluzione 'azienda' → attesi = solo i clienti di quell'azienda
//   5. letture/conferme: count corretti + breakdown per destinatario
//   6. bozza → 422 E_CIRCOLARE_NOT_REPORTABLE
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
  CIRCOLARI_SOCIO_CODES,
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedCircolariRedattore,
} from './helpers/circolari-test-fixtures';
import { seedClientePortale } from './helpers/portale-test-fixtures';

const STUDIO = '/api/v1/circolari';
const PORTALE = '/api/v1/portale/circolari';
const PORTALE_CIRCOLARI_CODES = ['portale.circolari.visualizza'] as const;

describe('Circolari report letture — studio E2E (ADR-0048 §1)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let socioJwt: string;
  let collaboratoreJwt: string;
  let cliente1Jwt: string;
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

    // Socio: authoring/publish + circolari.read_report (sull'admin seedMinimal).
    const seed = await seedMinimal(containers.databaseUrl);
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seed.tenantId,
      userId: seed.adminUserId,
      roleName: 'Circolari Socio',
      codes: [...CIRCOLARI_SOCIO_CODES],
    });

    // Collaboratore: solo circolari.create (no read_report) → 403 sul report.
    const collaboratore = await seedCircolariRedattore(containers.databaseUrl, {
      tenantId: seed.tenantId,
    });

    // Due clienti in due aziende distinte: generano le letture/conferme dal portale.
    const cliente1 = await seedClientePortale(containers.databaseUrl, {
      tenantId: seed.tenantId,
      email: 'cliente1@studio.local',
      aziendaCodice: 'AZ-REP-1',
      codes: PORTALE_CIRCOLARI_CODES,
    });
    const cliente2 = await seedClientePortale(containers.databaseUrl, {
      tenantId: seed.tenantId,
      email: 'cliente2@studio.local',
      aziendaCodice: 'AZ-REP-2',
      codes: PORTALE_CIRCOLARI_CODES,
    });
    azienda1Id = cliente1.aziendaId;
    azienda2Id = cliente2.aziendaId;

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    socioJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    collaboratoreJwt = await loginAs(
      app,
      'studio-demo',
      collaboratore.email,
      collaboratore.password,
    );
    cliente1Jwt = await loginAs(app, 'studio-demo', cliente1.email, cliente1.password);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  async function createCircolare(body: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(STUDIO)
      .set('Authorization', `Bearer ${socioJwt}`)
      .send(body)
      .expect(201);
    return res.body.data.id as string;
  }

  async function publish(id: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`${STUDIO}/${id}/publish`)
      .set('Authorization', `Bearer ${socioJwt}`)
      .expect(200);
  }

  function getReport(jwt: string, id: string): request.Test {
    return request(app.getHttpServer())
      .get(`${STUDIO}/${id}/report`)
      .set('Authorization', `Bearer ${jwt}`);
  }

  // Cliente apre il dettaglio → markLetta on-open.
  async function openAsCliente(jwt: string, id: string): Promise<void> {
    await request(app.getHttpServer())
      .get(`${PORTALE}/${id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);
  }

  async function confermaAsCliente(jwt: string, id: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`${PORTALE}/${id}/conferma`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);
  }

  it('1. Collaboratore (no read_report) → GET report = 403', async () => {
    const id = await createCircolare({
      titolo: 'Report gated',
      oggettoEmail: 'X',
      bodyHtml: 'Corpo.',
      destinatari: [{ tipo: 'tutti' }],
    });
    await publish(id);

    await getReport(collaboratoreJwt, id).expect(403);
  });

  it('2. Socio (read_report) → 200 + shape summary/recipients', async () => {
    const id = await createCircolare({
      titolo: 'Report ok',
      oggettoEmail: 'X',
      bodyHtml: 'Corpo.',
      destinatari: [{ tipo: 'tutti' }],
    });
    await publish(id);

    const res = await getReport(socioJwt, id).expect(200);
    expect(res.body.data).toMatchObject({
      circolareId: id,
      stato: 'pubblicata',
      richiedeConferma: false,
      summary: { attesi: 2, letti: 0, confermati: 0 },
    });
    expect(Array.isArray(res.body.data.recipients)).toBe(true);
  });

  it("3. risoluzione 'tutti' → attesi = tutti i clienti del tenant", async () => {
    const id = await createCircolare({
      titolo: 'Broadcast',
      oggettoEmail: 'X',
      bodyHtml: 'A tutti.',
      destinatari: [{ tipo: 'tutti' }],
    });
    await publish(id);

    const res = await getReport(socioJwt, id).expect(200);
    expect(res.body.data.summary.attesi).toBe(2);
    expect(res.body.data.recipients.map((r: { email: string }) => r.email).sort()).toEqual([
      'cliente1@studio.local',
      'cliente2@studio.local',
    ]);
  });

  it("4. risoluzione 'azienda' → attesi = solo i clienti di quell'azienda", async () => {
    const id = await createCircolare({
      titolo: 'Mirata',
      oggettoEmail: 'X',
      bodyHtml: 'Solo Azienda 1.',
      destinatari: [{ tipo: 'azienda', aziendaId: azienda1Id }],
    });
    await publish(id);

    const res = await getReport(socioJwt, id).expect(200);
    expect(res.body.data.summary.attesi).toBe(1);
    expect(res.body.data.recipients).toHaveLength(1);
    expect(res.body.data.recipients[0]).toMatchObject({
      email: 'cliente1@studio.local',
      aziendaId: azienda1Id,
      letta: false,
      confermata: false,
    });
    // cliente2 (azienda2) non è nel set atteso.
    expect(
      res.body.data.recipients.some((r: { aziendaId: string }) => r.aziendaId === azienda2Id),
    ).toBe(false);
  });

  it('5. letture/conferme: count corretti + breakdown per destinatario', async () => {
    const id = await createCircolare({
      titolo: 'Con conferma',
      oggettoEmail: 'X',
      bodyHtml: 'Conferma richiesta.',
      richiedeConferma: true,
      destinatari: [{ tipo: 'tutti' }],
    });
    await publish(id);

    // cliente1 apre (letta) e conferma; cliente2 non fa nulla.
    await openAsCliente(cliente1Jwt, id);
    await confermaAsCliente(cliente1Jwt, id);

    const res = await getReport(socioJwt, id).expect(200);
    expect(res.body.data.summary).toMatchObject({ attesi: 2, letti: 1, confermati: 1 });

    const byEmail = new Map<string, { letta: boolean; confermata: boolean }>(
      res.body.data.recipients.map((r: { email: string; letta: boolean; confermata: boolean }) => [
        r.email,
        { letta: r.letta, confermata: r.confermata },
      ]),
    );
    expect(byEmail.get('cliente1@studio.local')).toEqual({ letta: true, confermata: true });
    expect(byEmail.get('cliente2@studio.local')).toEqual({ letta: false, confermata: false });
  });

  it('6. bozza → 422 E_CIRCOLARE_NOT_REPORTABLE', async () => {
    const id = await createCircolare({
      titolo: 'Bozza',
      oggettoEmail: 'X',
      bodyHtml: 'Non pubblicata.',
      destinatari: [{ tipo: 'tutti' }],
    });

    const res = await getReport(socioJwt, id).expect(422);
    expect(res.body.errorCode).toBe('E_CIRCOLARE_NOT_REPORTABLE');
  });
});
