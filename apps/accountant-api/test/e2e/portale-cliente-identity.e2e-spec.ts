// =============================================================================
// portale-cliente-identity.e2e-spec.ts (ADR-0046) — fondamenta portale cliente
// =============================================================================
// Full AppModule bootstrap (Testcontainers Postgres/Redis) + supertest.
// Task 1 (fondamenta livello 2): identità operatore/cliente, login unico,
// scoping azienda, separazione delle superfici via permessi. Le superfici DATI
// del cliente (documenti read-only) arrivano col task successivo → qui si testa
// solo l'identità + il gating.
// Coverage:
//   1. cliente: login unico OK + GET /me → tipo='cliente', aziendaId valorizzato,
//      clienteRuolo='admin', permissions = ['portale.documenti.visualizza']
//   2. operatore: GET /me → tipo='operatore', aziendaId null
//   3. RBAC cross-superficie: cliente → GET /aziende (endpoint studio) = 403
//   4. operatore → GET /aziende = 200 (sanity: la superficie studio resta intatta)
//   5. invariante DB chk_cliente_azienda_id: cliente senza azienda + operatore
//      con azienda → entrambe le INSERT/UPDATE raw rifiutate dal CHECK
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
  seedAziendePermissions,
  loginAs,
  flushTenantSlugCache,
} from './helpers/aziende-test-fixtures';
import { seedClientePortale } from './helpers/portale-test-fixtures';

const ME = '/api/v1/me';
const AZIENDE = '/api/v1/aziende';

describe('Portale cliente — identità & superfici E2E (ADR-0046)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let operatoreJwt: string;
  let clienteJwt: string;
  let tenantId: string;
  let clienteAziendaId: string;

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

    // Operatore studio (admin@studio.local) con anagrafica.cliente.* → vede /aziende.
    const seed = await seedMinimal(containers.databaseUrl);
    tenantId = seed.tenantId;
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seed.tenantId,
      userId: seed.adminUserId,
      roleName: 'Anagrafica Admin',
      codes: ['anagrafica.cliente.visualizza'],
    });

    // Cliente portale (tipo='cliente' + azienda + portale.documenti.visualizza).
    const cliente = await seedClientePortale(containers.databaseUrl, { tenantId: seed.tenantId });
    clienteAziendaId = cliente.aziendaId;

    await flushTenantSlugCache(containers.redisHost, containers.redisPort);

    operatoreJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
    clienteJwt = await loginAs(app, 'studio-demo', cliente.email, cliente.password);
  });

  it('1. cliente: login unico + /me espone tipo/azienda/clienteRuolo + permesso portale', async () => {
    const res = await request(app.getHttpServer())
      .get(ME)
      .set('Authorization', `Bearer ${clienteJwt}`)
      .expect(200);

    expect(res.body.data.user.tipo).toBe('cliente');
    expect(res.body.data.user.aziendaId).toBe(clienteAziendaId);
    expect(res.body.data.user.clienteRuolo).toBe('admin');
    expect(res.body.data.permissions).toEqual(['portale.documenti.visualizza']);
  });

  it('2. operatore: /me ha tipo=operatore e nessuna azienda', async () => {
    const res = await request(app.getHttpServer())
      .get(ME)
      .set('Authorization', `Bearer ${operatoreJwt}`)
      .expect(200);

    expect(res.body.data.user.tipo).toBe('operatore');
    expect(res.body.data.user.aziendaId).toBeNull();
    expect(res.body.data.user.clienteRuolo).toBeNull();
  });

  it('3. RBAC cross-superficie: cliente NON accede a un endpoint studio → 403', async () => {
    await request(app.getHttpServer())
      .get(AZIENDE)
      .set('Authorization', `Bearer ${clienteJwt}`)
      .expect(403);
  });

  it('4. operatore: la superficie studio resta accessibile → 200', async () => {
    await request(app.getHttpServer())
      .get(AZIENDE)
      .set('Authorization', `Bearer ${operatoreJwt}`)
      .expect(200);
  });

  it('5. invariante DB chk_cliente_azienda_id: cliente-senza-azienda e operatore-con-azienda rifiutati', async () => {
    const { Client } = await import('pg');
    const { uuidv7 } = await import('uuidv7');
    const client = new Client({ connectionString: containers.databaseUrl });
    await client.connect();
    try {
      // cliente senza azienda_id → viola il CHECK
      await expect(
        client.query(
          `INSERT INTO users
             (id, tenant_id, email, password_hash, first_name, last_name, is_active, tipo, failed_login_attempts, created_at, updated_at)
           VALUES ($1, $2, 'bad-cliente@studio.local', 'x', 'Bad', 'Cliente', true, 'cliente', 0, NOW(), NOW());`,
          [uuidv7(), tenantId],
        ),
      ).rejects.toThrow(/chk_cliente_azienda_id/);

      // operatore con azienda_id → viola il CHECK
      await expect(
        client.query(
          `INSERT INTO users
             (id, tenant_id, email, password_hash, first_name, last_name, is_active, tipo, azienda_id, failed_login_attempts, created_at, updated_at)
           VALUES ($1, $2, 'bad-operatore@studio.local', 'x', 'Bad', 'Operatore', true, 'operatore', $3, 0, NOW(), NOW());`,
          [uuidv7(), tenantId, clienteAziendaId],
        ),
      ).rejects.toThrow(/chk_cliente_azienda_id/);
    } finally {
      await client.end();
    }
  });
});
