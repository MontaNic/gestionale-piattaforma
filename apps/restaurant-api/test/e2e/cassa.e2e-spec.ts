// =============================================================================
// cassa.e2e-spec.ts — Cassa pre-fiscale E2E (PR1, ADR-0081)
// =============================================================================
// Esercita i pagamenti sul conto attraverso HTTP con RBAC reale. Copertura:
//   - Pagamento singolo a saldo → statoPagamento=saldato, chiudi ammesso
//   - Pagamento parziale → statoPagamento=parziale, chiudi BLOCCATO (E_CONTO_NOT_SETTLED)
//   - Split payment (contanti+carta) che salda → chiudi ammesso
//   - Overpay → E_PAGAMENTO_EXCEEDS_RESIDUO (overpay non modellato, D1)
//   - Storno pagamento → riapre il residuo; idempotenza (E_PAGAMENTO_ALREADY_STORNATO)
//   - Conto a totale 0 → chiudi ammesso senza pagamenti (clausola totale==0, D3)
//   - riepilogoIvaSnapshot congelato alla chiusura e coerente col derivato (D4)
//   - Scorporo multi-aliquota (10% + 22%): imponibile + iva == lordo per gruppo
//   - RBAC: i 3 `cassa.*` sono enforced (viewer senza cassa → 403 su tutte)
//   - Isolamento tenant via HTTP (conto di altro tenant → 404)
//
// L'isolamento RLS al layer DB (policy `pagamenti_tenant_isolation` come
// `gestionale_app` non-superuser) vive in `conti-rls-isolation.e2e-spec.ts`:
// questo spec gira come superuser `postgres` e la policy sarebbe bypassata.
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
import { flushTenantSlugCache, loginAs, seedLimitedUser } from './helpers/menu-test-fixtures';
import {
  seedComandeData,
  seedComandePermissions,
  type ComandeData,
} from './helpers/comande-test-fixtures';

const API = '/api/v1/conti';

async function pgRows(
  databaseUrl: string,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    await client.end();
  }
}

interface RiepilogoGruppo {
  vatPercent: number;
  lordo: string;
  imponibile: string;
  iva: string;
}

describe('Cassa pre-fiscale E2E — /api/v1/conti pagamenti (PR1, ADR-0081)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let demoJwt: string;
  let demoTenantId: string;
  let data: ComandeData;

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
    const demo = await seedMinimal(containers.databaseUrl);
    demoTenantId = demo.tenantId;
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: demo.tenantId,
      userId: demo.adminUserId,
      grant: 'full',
    });
    data = await seedComandeData(containers.databaseUrl, { tenantId: demo.tenantId });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    demoJwt = await loginAs(app, 'demo', 'admin@demo.local', 'Admin123!');
  });

  const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}`, 'X-Tenant-Slug': 'demo' });

  /** Conto cassa sul tavolo seedato. */
  async function apriCassa(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'cassa', coperti: 4, tavoloId: data.tavoloId })
      .expect(201);
    return res.body.data.id as string;
  }

  /** Conto asporto (senza tavolo): evita il partial-unique un-tavolo-un-conto. */
  async function apriAsporto(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(API)
      .set(auth(demoJwt))
      .send({ channel: 'asporto' })
      .expect(201);
    return res.body.data.id as string;
  }

  async function addRiga(contoId: string, articleId: string, quantita = 1): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(demoJwt))
      .send({ articleId, quantita })
      .expect(201);
    return res.body.data.id as string;
  }

  async function getConto(contoId: string, jwt = demoJwt): Promise<Record<string, never>> {
    const res = await request(app.getHttpServer())
      .get(`${API}/${contoId}`)
      .set(auth(jwt))
      .expect(200);
    return res.body.data;
  }

  async function paga(
    contoId: string,
    importo: number,
    metodo = 'contanti',
    jwt = demoJwt,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti`)
      .set(auth(jwt))
      .send({ metodo, importo });
  }

  // ===========================================================================
  // Pagamento singolo a saldo
  // ===========================================================================
  it('saldo: articleA×1 (8.00) pagato interamente → saldato, residuo 0, chiudi 200', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1); // override listino 8.00

    const before = await getConto(contoId);
    expect(before.totale).toBe('8.00');
    expect(before.residuo).toBe('8.00');
    expect(before.statoPagamento).toBe('da_pagare');
    expect(before.pagamenti).toHaveLength(0);

    const pag = await paga(contoId, 8);
    expect(pag.status).toBe(201);
    expect(pag.body.data.metodo).toBe('contanti');
    expect(Number(pag.body.data.importo)).toBe(8);
    expect(pag.body.data.stornato).toBe(false);

    const after = await getConto(contoId);
    expect(after.residuo).toBe('0.00');
    expect(after.statoPagamento).toBe('saldato');
    expect(after.pagamenti).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
  });

  it('operatore: il pagamento registra operatoreId = utente autenticato', async () => {
    const contoId = await apriAsporto();
    await addRiga(contoId, data.articleBId, 1); // 5.00
    const pag = await paga(contoId, 5);
    expect(pag.status).toBe(201);

    const rows = await pgRows(
      containers.databaseUrl,
      `SELECT operatore_id FROM pagamenti WHERE id = $1`,
      [pag.body.data.id],
    );
    const users = await pgRows(
      containers.databaseUrl,
      `SELECT id FROM users WHERE email = 'admin@demo.local'`,
    );
    expect(rows[0].operatore_id).toBe(users[0].id);
  });

  // ===========================================================================
  // Pagamento parziale — la guardia di saldo D3 blocca la chiusura
  // ===========================================================================
  it('parziale: 3.00 su 8.00 → parziale, residuo 5.00, chiudi → 409 E_CONTO_NOT_SETTLED', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);
    expect((await paga(contoId, 3)).status).toBe(201);

    const conto = await getConto(contoId);
    expect(conto.residuo).toBe('5.00');
    expect(conto.statoPagamento).toBe('parziale');

    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt));
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_NOT_SETTLED');

    // Il conto è ancora aperto: la guardia precede la transizione (nessun effetto).
    expect((await getConto(contoId)).stato).toBe('aperto');
  });

  it('parziale: annulla resta la via per chiudere senza incasso (200)', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/annulla`)
      .set(auth(demoJwt))
      .expect(200);

    // annulla NON congela il riepilogo IVA: non c'è stata una chiusura vera.
    const rows = await pgRows(
      containers.databaseUrl,
      `SELECT stato, riepilogo_iva_snapshot FROM conti WHERE id = $1`,
      [contoId],
    );
    expect(rows[0].stato).toBe('annullato');
    expect(rows[0].riepilogo_iva_snapshot).toBeNull();
  });

  // ===========================================================================
  // Split payment (caso NATIVO, D1)
  // ===========================================================================
  it('split: 10.00 carta + 6.00 contanti su 16.00 → saldato, 2 pagamenti, chiudi 200', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 2); // 8.00 × 2 = 16.00

    expect((await paga(contoId, 10, 'carta')).status).toBe(201);
    const mid = await getConto(contoId);
    expect(mid.residuo).toBe('6.00');
    expect(mid.statoPagamento).toBe('parziale');

    expect((await paga(contoId, 6, 'contanti')).status).toBe(201);
    const after = await getConto(contoId);
    expect(after.residuo).toBe('0.00');
    expect(after.statoPagamento).toBe('saldato');
    expect(after.pagamenti).toHaveLength(2);
    expect((after.pagamenti as unknown as Array<{ metodo: string }>).map((p) => p.metodo)).toEqual([
      'carta',
      'contanti',
    ]);

    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
  });

  // ===========================================================================
  // Overpay non modellato
  // ===========================================================================
  it('overpay: 10.00 su residuo 8.00 → 409 E_PAGAMENTO_EXCEEDS_RESIDUO, nessuna riga scritta', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);

    const res = await paga(contoId, 10);
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_PAGAMENTO_EXCEEDS_RESIDUO');

    const rows = await pgRows(
      containers.databaseUrl,
      `SELECT count(*)::int AS count FROM pagamenti WHERE conto_id = $1`,
      [contoId],
    );
    expect(rows[0].count).toBe(0);
  });

  it('overpay: secondo pagamento che sfonda il residuo → 409 (il primo resta valido)', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1); // 8.00
    expect((await paga(contoId, 5)).status).toBe(201);

    const res = await paga(contoId, 4); // residuo 3.00
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_PAGAMENTO_EXCEEDS_RESIDUO');

    const conto = await getConto(contoId);
    expect(conto.residuo).toBe('3.00');
    expect(conto.pagamenti).toHaveLength(1);
  });

  // SKIP TD-BS Sub-2 (ADR-0019): nel harness E2E la ValidationPipe non riceve
  // design:paramtypes runtime → i DTO @Body NON vengono validati. Verificato
  // empiricamente in PR1 sul DTO PRE-ESISTENTE `AddRigaDto` (`quantita: 0` → 201
  // invece di 400): limitazione del harness, non di questa PR. In prod
  // (`nest build --builder swc`, .swcrc decoratorMetadata) la validazione produce
  // 400 E_VALIDATION. Constraint del DTO coperti da
  // src/conti/dto/registra-pagamento.dto.spec.ts (unit, 12 casi).
  it.skip('validazione: importo 0 → 400; 3 decimali → 400 — BLOCKED TD-BS Sub-2', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);
    expect((await paga(contoId, 0)).status).toBe(400);
    expect((await paga(contoId, 1.005)).status).toBe(400);
  });

  // ===========================================================================
  // Storno pagamento
  // ===========================================================================
  it('storno: il pagamento stornato riapre il residuo e resta visibile marcato', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);
    const pag = await paga(contoId, 8);
    expect((await getConto(contoId)).statoPagamento).toBe('saldato');

    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti/${pag.body.data.id}/storna`)
      .set(auth(demoJwt));
    expect(res.status).toBe(200);
    expect(res.body.data.stornato).toBe(true);
    expect(res.body.data.stornatoIl).not.toBeNull();

    const after = await getConto(contoId);
    expect(after.residuo).toBe('8.00');
    expect(after.statoPagamento).toBe('da_pagare');
    // Resta nel payload marcato (come le righe stornate), non sparisce.
    expect(after.pagamenti).toHaveLength(1);
    expect((after.pagamenti as unknown as Array<{ stornato: boolean }>)[0].stornato).toBe(true);

    // Residuo riaperto ⇒ chiusura di nuovo bloccata.
    const chiudi = await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt));
    expect(chiudi.status).toBe(409);
    expect(chiudi.body.errorCode).toBe('E_CONTO_NOT_SETTLED');

    // …e ri-pagando si richiude.
    expect((await paga(contoId, 8, 'carta')).status).toBe(201);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
  });

  it('storno: due volte lo stesso pagamento → 409 E_PAGAMENTO_ALREADY_STORNATO (terminale)', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);
    const pag = await paga(contoId, 8);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti/${pag.body.data.id}/storna`)
      .set(auth(demoJwt))
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti/${pag.body.data.id}/storna`)
      .set(auth(demoJwt));
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_PAGAMENTO_ALREADY_STORNATO');
  });

  it('storno: pagamentoId inesistente → 404 E_PAGAMENTO_NOT_FOUND', async () => {
    const contoId = await apriCassa();
    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti/00000000-0000-0000-0000-000000000000/storna`)
      .set(auth(demoJwt));
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_PAGAMENTO_NOT_FOUND');
  });

  it('storno: su conto già chiuso → 409 E_CONTO_NOT_OPEN (non si riapre un terminale)', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);
    const pag = await paga(contoId, 8);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti/${pag.body.data.id}/storna`)
      .set(auth(demoJwt));
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_NOT_OPEN');
  });

  it('pagamento: su conto già chiuso → 409 E_CONTO_NOT_OPEN', async () => {
    const contoId = await apriCassa();
    const res0 = await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt));
    expect(res0.status).toBe(200); // conto vuoto: totale 0 ⇒ guardia soddisfatta

    const res = await paga(contoId, 5);
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_NOT_OPEN');
  });

  // ===========================================================================
  // Conto a totale 0 (clausola `totale == 0` di D3)
  // ===========================================================================
  it('totale 0: conto senza righe → saldato, chiudi 200 senza pagamenti', async () => {
    const contoId = await apriCassa();
    const conto = await getConto(contoId);
    expect(conto.totale).toBe('0.00');
    expect(conto.residuo).toBe('0.00');
    expect(conto.statoPagamento).toBe('saldato');
    expect(conto.riepilogoIva).toEqual([]);

    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
  });

  it('totale 0: unica riga pagata poi soft-deleted → residuo negativo ma chiudi 200 (clausola totale==0)', async () => {
    // Documenta il limite dichiarato D3: dopo lo storno di una riga già pagata il
    // residuo va NEGATIVO. Con una riga sola il totale torna a 0 → la seconda
    // clausola della guardia salva la chiusura (non è ridondante).
    const contoId = await apriCassa();
    const rigaId = await addRiga(contoId, data.articleAId, 1);
    expect((await paga(contoId, 8)).status).toBe(201);
    await request(app.getHttpServer())
      .delete(`${API}/${contoId}/righe/${rigaId}`)
      .set(auth(demoJwt))
      .expect(200);

    const conto = await getConto(contoId);
    expect(conto.totale).toBe('0.00');
    expect(conto.residuo).toBe('-8.00');
    expect(conto.statoPagamento).toBe('saldato');

    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
  });

  it('limite D3: storno parziale di un conto già saldato → chiudi BLOCCATO (via d uscita: storna il pagamento)', async () => {
    // 2 righe (8.00 + 5.00 = 13.00), pagate tutte; poi si storna la riga da 5.00:
    // totale 8.00, pagato 13.00 → residuo -5.00, totale != 0 → 409. Comportamento
    // dichiarato in ADR-0081 D3, non un bug: si esce stornando il pagamento.
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1); // 8.00
    const rigaB = await addRiga(contoId, data.articleBId, 1); // 5.00
    const pag = await paga(contoId, 13);
    await request(app.getHttpServer())
      .delete(`${API}/${contoId}/righe/${rigaB}`)
      .set(auth(demoJwt))
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt));
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_NOT_SETTLED');

    // Via d'uscita documentata: storna il pagamento e ri-registra al nuovo totale.
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti/${pag.body.data.id}/storna`)
      .set(auth(demoJwt))
      .expect(200);
    expect((await paga(contoId, 8)).status).toBe(201);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
  });

  // ===========================================================================
  // `chiudibile` — il predicato della guardia esposto in lettura (ADR-0082)
  // ===========================================================================
  // Ogni caso verifica il campo E l'esito reale di `chiudi`: se i due divergono
  // la UI mostrerebbe un bottone che il BE rifiuta (o lo nasconderebbe a torto).
  it('chiudibile: aperto non pagato → false, e chiudi conferma 409', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);

    const conto = await getConto(contoId);
    expect(conto.chiudibile).toBe(false);
    expect(conto.statoPagamento).toBe('da_pagare');

    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt));
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_NOT_SETTLED');
  });

  it('chiudibile: saldato esatto → true, e chiudi conferma 200', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);
    expect((await paga(contoId, 8)).status).toBe(201);

    expect((await getConto(contoId)).chiudibile).toBe(true);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
  });

  it('chiudibile: sovra-pagato (residuo<0, totale>0) → false pur essendo statoPagamento=saldato', async () => {
    // La divergenza voluta tra `isChiudibile` (isZero stretto) e
    // `computeStatoPagamento` (<= 0): il campo segue la GUARDIA, non lo stato.
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1); // 8.00
    const rigaB = await addRiga(contoId, data.articleBId, 1); // 5.00
    expect((await paga(contoId, 13)).status).toBe(201);
    await request(app.getHttpServer())
      .delete(`${API}/${contoId}/righe/${rigaB}`)
      .set(auth(demoJwt))
      .expect(200);

    const conto = await getConto(contoId);
    expect(conto.residuo).toBe('-5.00');
    expect(conto.statoPagamento).toBe('saldato');
    expect(conto.chiudibile).toBe(false);

    const res = await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt));
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('E_CONTO_NOT_SETTLED');
  });

  it('chiudibile: totale 0 (conto senza righe) → true senza pagamenti', async () => {
    const contoId = await apriCassa();
    const conto = await getConto(contoId);
    expect(conto.totale).toBe('0.00');
    expect(conto.chiudibile).toBe(true);

    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
  });

  // ===========================================================================
  // Riepilogo IVA — scorporo derivato + snapshot congelato (D4)
  // ===========================================================================
  it('scorporo: multi-aliquota 10%+22% — imponibile+iva == lordo per ogni gruppo, ordinato per aliquota', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 2); // 8.00×2 = 16.00 @ 10%
    await addRiga(contoId, data.articleBId, 1); // 5.00×1 =  5.00 @ 22%

    const conto = await getConto(contoId);
    expect(conto.totale).toBe('21.00'); // somma LORDA pura (ADR-0070 D1)

    const riepilogo = conto.riepilogoIva as unknown as RiepilogoGruppo[];
    expect(riepilogo.map((g) => g.vatPercent)).toEqual([10, 22]); // ordinato asc
    expect(riepilogo[0]).toEqual({
      vatPercent: 10,
      lordo: '16.00',
      imponibile: '14.55',
      iva: '1.45',
    });
    expect(riepilogo[1]).toEqual({
      vatPercent: 22,
      lordo: '5.00',
      imponibile: '4.10',
      iva: '0.90',
    });
    // Invariante: per ogni gruppo imponibile + iva == lordo ESATTAMENTE.
    for (const g of riepilogo) {
      expect((Number(g.imponibile) + Number(g.iva)).toFixed(2)).toBe(g.lordo);
    }
    // Σ lordi dei gruppi == totale del conto.
    expect(riepilogo.reduce((s, g) => s + Number(g.lordo), 0).toFixed(2)).toBe(conto.totale);
  });

  it('scorporo: la riga STORNATA esce dal riepilogo come esce dal totale', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1); // 8.00 @ 10%
    const rigaB = await addRiga(contoId, data.articleBId, 1); // 5.00 @ 22%
    await request(app.getHttpServer())
      .delete(`${API}/${contoId}/righe/${rigaB}`)
      .set(auth(demoJwt))
      .expect(200);

    const conto = await getConto(contoId);
    expect(conto.totale).toBe('8.00');
    const riepilogo = conto.riepilogoIva as unknown as RiepilogoGruppo[];
    expect(riepilogo).toHaveLength(1);
    expect(riepilogo[0].vatPercent).toBe(10);
  });

  it('snapshot D4: alla chiusura riepilogo_iva_snapshot == riepilogo derivato pre-chiusura; NULL prima', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 2); // 16.00 @ 10%
    await addRiga(contoId, data.articleBId, 1); // 5.00  @ 22%

    // Prima della chiusura la colonna è NULL (nessun congelamento su conto aperto).
    const pre = await pgRows(
      containers.databaseUrl,
      `SELECT riepilogo_iva_snapshot FROM conti WHERE id = $1`,
      [contoId],
    );
    expect(pre[0].riepilogo_iva_snapshot).toBeNull();

    const derivato = (await getConto(contoId)).riepilogoIva as unknown as RiepilogoGruppo[];
    expect((await paga(contoId, 21)).status).toBe(201);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);

    const post = await pgRows(
      containers.databaseUrl,
      `SELECT riepilogo_iva_snapshot FROM conti WHERE id = $1`,
      [contoId],
    );
    expect(post[0].riepilogo_iva_snapshot).toEqual(derivato);
  });

  it('snapshot D4: congelato — modificare l aliquota dell Article NON altera lo snapshot', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1); // 8.00 @ vatPercent 10 (snapshot riga)
    expect((await paga(contoId, 8)).status).toBe(201);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);

    // L'articolo passa al 22%: né la riga (ADR-0070 D2) né lo snapshot cambiano.
    await pgRows(containers.databaseUrl, `UPDATE articles SET vat_percent = 22 WHERE id = $1`, [
      data.articleAId,
    ]);

    const rows = await pgRows(
      containers.databaseUrl,
      `SELECT riepilogo_iva_snapshot FROM conti WHERE id = $1`,
      [contoId],
    );
    expect(rows[0].riepilogo_iva_snapshot).toEqual([
      { vatPercent: 10, lordo: '8.00', imponibile: '7.27', iva: '0.73' },
    ]);
  });

  it('snapshot D4: conto senza righe chiuso → snapshot [] (chiusura vera, riepilogo vuoto)', async () => {
    const contoId = await apriCassa();
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);
    const rows = await pgRows(
      containers.databaseUrl,
      `SELECT riepilogo_iva_snapshot FROM conti WHERE id = $1`,
      [contoId],
    );
    expect(rows[0].riepilogo_iva_snapshot).toEqual([]);
  });

  // ===========================================================================
  // Audit-in-tx
  // ===========================================================================
  it('audit: pagamento_registrato / pagamento_stornato con before+after; conto.chiuso porta lo snapshot', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);
    const pag = await paga(contoId, 8);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti/${pag.body.data.id}/storna`)
      .set(auth(demoJwt))
      .expect(200);
    expect((await paga(contoId, 8, 'carta')).status).toBe(201);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(demoJwt))
      .expect(200);

    const audits = await pgRows(
      containers.databaseUrl,
      `SELECT action, entity_type, before_value, after_value FROM audit_logs
       WHERE tenant_id = $1 AND action LIKE 'conto.%' ORDER BY timestamp ASC`,
      [demoTenantId],
    );
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('conto.pagamento_registrato');
    expect(actions).toContain('conto.pagamento_stornato');
    expect(actions).toContain('conto.chiuso'); // nome storico invariato (anchor stability)

    const registrato = audits.find((a) => a.action === 'conto.pagamento_registrato');
    expect(registrato?.entity_type).toBe('Pagamento');
    expect(registrato?.before_value).toMatchObject({ residuoPrima: '8.00' });
    expect(registrato?.after_value).toMatchObject({ importo: '8', residuoDopo: '0.00' });

    const stornato = audits.find((a) => a.action === 'conto.pagamento_stornato');
    expect(stornato?.before_value).toMatchObject({ stornato: false });
    expect(stornato?.after_value).toMatchObject({ stornato: true });

    const chiuso = audits.find((a) => a.action === 'conto.chiuso');
    expect(chiuso?.after_value).toMatchObject({
      stato: 'chiuso',
      riepilogoIvaSnapshot: [{ vatPercent: 10, lordo: '8.00', imponibile: '7.27', iva: '0.73' }],
    });
  });

  // ===========================================================================
  // RBAC — i 3 cassa.* sono enforced (D5)
  // ===========================================================================
  it('rbac: utente con SOLO comande.visualizza → 403 su GET/POST pagamenti e storna', async () => {
    const limited = await seedLimitedUser(containers.databaseUrl, { tenantId: demoTenantId });
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: demoTenantId,
      userId: limited.userId,
      grant: 'viewer',
      roleName: 'Comande Viewer',
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    const viewerJwt = await loginAs(app, 'demo', limited.email, limited.password);

    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);

    // legge il conto (comande.visualizza) ma NON le rotte cassa
    await request(app.getHttpServer()).get(`${API}/${contoId}`).set(auth(viewerJwt)).expect(200);
    await request(app.getHttpServer())
      .get(`${API}/${contoId}/pagamenti`)
      .set(auth(viewerJwt))
      .expect(403);
    expect((await paga(contoId, 8, 'contanti', viewerJwt)).status).toBe(403);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti/qualsiasi/storna`)
      .set(auth(viewerJwt))
      .expect(403);
  });

  it('rbac: profilo cassa (comande.visualizza + cassa.*) batte pagamenti ma NON tocca le righe', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);

    const cassiere = await seedLimitedUser(containers.databaseUrl, {
      tenantId: demoTenantId,
      email: 'cassiere@demo.local',
    });
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: demoTenantId,
      userId: cassiere.userId,
      grant: 'cassa',
      roleName: 'Comande Cassa',
    });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    const cassaJwt = await loginAs(app, 'demo', cassiere.email, cassiere.password);

    // cassa.pagamento.registra + cassa.visualizza → OK
    expect((await paga(contoId, 8, 'contanti', cassaJwt)).status).toBe(201);
    await request(app.getHttpServer())
      .get(`${API}/${contoId}/pagamenti`)
      .set(auth(cassaJwt))
      .expect(200);

    // senza comande.modifica non aggiunge righe né chiude il conto
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/righe`)
      .set(auth(cassaJwt))
      .send({ articleId: data.articleBId, quantita: 1 })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/chiudi`)
      .set(auth(cassaJwt))
      .expect(403);
  });

  it('rbac: GET /pagamenti riflette i pagamenti del conto (incluso lo stornato)', async () => {
    const contoId = await apriCassa();
    await addRiga(contoId, data.articleAId, 1);
    const pag = await paga(contoId, 5);
    await request(app.getHttpServer())
      .post(`${API}/${contoId}/pagamenti/${pag.body.data.id}/storna`)
      .set(auth(demoJwt))
      .expect(200);
    expect((await paga(contoId, 8, 'carta')).status).toBe(201);

    const res = await request(app.getHttpServer())
      .get(`${API}/${contoId}/pagamenti`)
      .set(auth(demoJwt))
      .expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((p: { stornato: boolean }) => p.stornato)).toEqual([true, false]);
  });

  // ===========================================================================
  // Isolamento tenant (HTTP)
  // ===========================================================================
  it('tenant: pagare/leggere un conto di un ALTRO tenant → 404 (mai 200 con dati altrui)', async () => {
    const acme = await seedSecondTenant(containers.databaseUrl);
    await seedComandePermissions(containers.databaseUrl, {
      tenantId: acme.tenantId,
      userId: acme.adminUserId,
      grant: 'full',
      roleName: 'Comande Full Acme',
    });
    const acmeData = await seedComandeData(containers.databaseUrl, { tenantId: acme.tenantId });
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    // conto + pagamento nel tenant demo
    const contoDemo = await apriCassa();
    await addRiga(contoDemo, data.articleAId, 1);
    const pagDemo = await paga(contoDemo, 8);
    expect(pagDemo.status).toBe(201);
    expect(acmeData.tavoloId).toBeTruthy();

    const acmeJwt = await loginAs(app, 'acme', 'admin@acme.local', 'Admin123!');
    const acmeAuth = { Authorization: `Bearer ${acmeJwt}`, 'X-Tenant-Slug': 'acme' };

    // acme non vede né tocca il conto/pagamento di demo
    await request(app.getHttpServer())
      .get(`${API}/${contoDemo}/pagamenti`)
      .set(acmeAuth)
      .expect(404);
    await request(app.getHttpServer())
      .post(`${API}/${contoDemo}/pagamenti`)
      .set(acmeAuth)
      .send({ metodo: 'contanti', importo: 1 })
      .expect(404);
    await request(app.getHttpServer())
      .post(`${API}/${contoDemo}/pagamenti/${pagDemo.body.data.id}/storna`)
      .set(acmeAuth)
      .expect(404);

    // il pagamento di demo è intatto
    const rows = await pgRows(
      containers.databaseUrl,
      `SELECT stornato FROM pagamenti WHERE id = $1`,
      [pagDemo.body.data.id],
    );
    expect(rows[0].stornato).toBe(false);
  });
});
