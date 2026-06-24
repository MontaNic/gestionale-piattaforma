import crypto from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, seedMinimal, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';
import {
  flushTenantSlugCache,
  loginAs,
  seedAziendePermissions,
  seedViewer,
} from './helpers/aziende-test-fixtures';

// =============================================================================
// inviti-cliente.e2e-spec.ts (feat/invito-cliente Commit 1 BE)
// =============================================================================
// Copre il flusso invito → accettazione via supertest + full NestJS bootstrap:
//   1. POST  invito → 201 + 1 riga DB
//   2. dedup: secondo invito stessa (azienda,email) → rinnova (1 riga, token nuovo)
//   3. accept-invite → 200 + tokens, crea User cliente, marca invito usato
//   4. auto-promote: azienda senza admin → primo 'utente' diventa admin
//   5. auto-promote OFF: azienda con admin → 'utente' resta utente
//   6. token scaduto → 400 E_INVITO_TOKEN_EXPIRED
//   7. token usato → 400 E_INVITO_TOKEN_INVALID
//   8. revoca → 200 + sparisce dai pendenti
//   9. RBAC: operatore senza clienti.invitare → 403
//
// Il token in chiaro viaggia solo via email (in DB sha256), e in E2E l'SMTP è
// chiuso → per le accept inseriamo la riga cliente_inviti con token noto (come
// reset-password.e2e). expires_at/used_at calcolati lato Postgres (NOW()±INTERVAL)
// per evitare lo shift di fuso del bind JS Date su `timestamp without time zone`.
// =============================================================================

const SLUG = 'studio-demo';
const ADMIN_EMAIL = 'admin@studio.local';
const ADMIN_PW = 'Admin123!';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('Inviti cliente (E2E)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let seed: { tenantId: string; sedeId: string; adminUserId: string };
  let aziendaId: string;
  let adminJwt: string;

  async function pg() {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: containers.databaseUrl });
    await client.connect();
    return client;
  }

  async function insertAzienda(tenantId: string, codice = 'AZ-INV'): Promise<string> {
    const id = uuidv7();
    const client = await pg();
    await client.query(
      `INSERT INTO aziende (id, tenant_id, codice, nome, tipo_cliente, attivo, created_at, updated_at)
       VALUES ($1, $2, $3, 'Azienda Invito Srl', 'azienda', true, NOW(), NOW());`,
      [id, tenantId, codice],
    );
    await client.end();
    return id;
  }

  // Crea la riga RBAC ruolo "Cliente" del tenant (per l'assegnazione in accept).
  async function insertClienteRole(tenantId: string): Promise<void> {
    const client = await pg();
    await client.query(
      `INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at)
       VALUES ($1, $2, 'Cliente', 'E2E cliente role', true, NOW(), NOW())
       ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL DO NOTHING;`,
      [uuidv7(), tenantId],
    );
    await client.end();
  }

  async function insertInvito(opts: {
    tenantId: string;
    aziendaId: string;
    email: string;
    token: string;
    ruolo?: 'admin' | 'utente';
    expiresInSeconds?: number;
    used?: boolean;
  }): Promise<void> {
    const client = await pg();
    await client.query(
      `INSERT INTO cliente_inviti
         (id, tenant_id, azienda_id, email, cliente_ruolo, token_hash, expires_at, used_at, invitato_da_id, created_at)
       VALUES ($1,$2,$3,$4,$5::"cliente_ruolo",$6, NOW() + ($7 * INTERVAL '1 second'),
               ${opts.used ? 'NOW()' : 'NULL'}, $8, NOW());`,
      [
        uuidv7(),
        opts.tenantId,
        opts.aziendaId,
        opts.email,
        opts.ruolo ?? 'utente',
        hashToken(opts.token),
        opts.expiresInSeconds ?? 7 * 24 * 60 * 60,
        seed.adminUserId,
      ],
    );
    await client.end();
  }

  // Inserisce un utente cliente già esistente (per il test auto-promote OFF).
  async function insertClienteUser(opts: {
    tenantId: string;
    aziendaId: string;
    email: string;
    ruolo: 'admin' | 'utente';
  }): Promise<void> {
    const argon2 = await import('argon2');
    const hash = await argon2.hash('Cliente123!', { type: argon2.argon2id });
    const client = await pg();
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active,
                          failed_login_attempts, tipo, azienda_id, cliente_ruolo, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'Cli','Ente',true,0,'cliente',$5,$6::"cliente_ruolo",NOW(),NOW());`,
      [uuidv7(), opts.tenantId, opts.email, hash, opts.aziendaId, opts.ruolo],
    );
    await client.end();
  }

  async function countInviti(aziendaId: string, onlyPending = false): Promise<number> {
    const client = await pg();
    const res = await client.query(
      `SELECT COUNT(*)::int AS n FROM cliente_inviti WHERE azienda_id = $1 ${onlyPending ? 'AND used_at IS NULL' : ''};`,
      [aziendaId],
    );
    await client.end();
    return res.rows[0].n as number;
  }

  async function getInvitoTokenHash(aziendaId: string, email: string): Promise<string | undefined> {
    const client = await pg();
    const res = await client.query(
      `SELECT token_hash FROM cliente_inviti WHERE azienda_id = $1 AND email = $2;`,
      [aziendaId, email],
    );
    await client.end();
    return res.rows[0]?.token_hash;
  }

  async function getUserByEmail(
    tenantId: string,
    email: string,
  ): Promise<
    { tipo: string; azienda_id: string | null; cliente_ruolo: string | null } | undefined
  > {
    const client = await pg();
    const res = await client.query(
      `SELECT tipo, azienda_id, cliente_ruolo FROM users WHERE tenant_id = $1 AND email = $2;`,
      [tenantId, email],
    );
    await client.end();
    return res.rows[0];
  }

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
    await flushTenantSlugCache(containers.redisHost, containers.redisPort);
    seed = await seedMinimal(containers.databaseUrl);
    // Admin con permesso clienti.invitare.
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: seed.tenantId,
      userId: seed.adminUserId,
      roleName: 'Inviti Admin',
      codes: ['clienti.invitare'],
    });
    await insertClienteRole(seed.tenantId);
    aziendaId = await insertAzienda(seed.tenantId);
    adminJwt = await loginAs(app, SLUG, ADMIN_EMAIL, ADMIN_PW);
  });

  const BASE = () => `/api/v1/aziende/${aziendaId}/inviti`;

  // ─── operatore: crea / dedup / revoca / RBAC ───────────────────────────────

  it('POST invito → 201 + 1 riga DB', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE())
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ email: 'nuovo@cliente.local' });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('nuovo@cliente.local');
    expect(res.body.data.clienteRuolo).toBe('utente');
    expect(res.body.data).not.toHaveProperty('tokenHash');
    expect(await countInviti(aziendaId)).toBe(1);
  });

  it('dedup: secondo invito stessa (azienda,email) → rinnova (1 riga, token nuovo)', async () => {
    await request(app.getHttpServer())
      .post(BASE())
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ email: 'dup@cliente.local' })
      .expect(201);
    const hash1 = await getInvitoTokenHash(aziendaId, 'dup@cliente.local');

    await request(app.getHttpServer())
      .post(BASE())
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ email: 'dup@cliente.local', clienteRuolo: 'admin' })
      .expect(201);
    const hash2 = await getInvitoTokenHash(aziendaId, 'dup@cliente.local');

    expect(await countInviti(aziendaId)).toBe(1); // upsert, non duplicato
    expect(hash2).not.toBe(hash1); // token rinnovato
  });

  it('GET inviti → lista pendenti; revoca → sparisce', async () => {
    await request(app.getHttpServer())
      .post(BASE())
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ email: 'rev@cliente.local' })
      .expect(201);

    const list1 = await request(app.getHttpServer())
      .get(BASE())
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    expect(list1.body.data).toHaveLength(1);
    const invitoId = list1.body.data[0].id;

    const rev = await request(app.getHttpServer())
      .delete(`${BASE()}/${invitoId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    expect(rev.body.data).toEqual({ id: invitoId, revoked: true });

    expect(await countInviti(aziendaId, true)).toBe(0); // niente pendenti
  });

  it('RBAC: operatore senza clienti.invitare → 403', async () => {
    const viewer = await seedViewer(containers.databaseUrl, {
      tenantId: seed.tenantId,
      email: 'noinvite@studio.local',
    });
    const viewerJwt = await loginAs(app, SLUG, viewer.email, viewer.password);

    await request(app.getHttpServer())
      .post(BASE())
      .set('Authorization', `Bearer ${viewerJwt}`)
      .send({ email: 'x@cliente.local' })
      .expect(403);
  });

  // ─── accept-invite (@Public) ───────────────────────────────────────────────

  it('accept-invite → 200 + tokens, crea User cliente, marca invito usato', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await insertInvito({
      tenantId: seed.tenantId,
      aziendaId,
      email: 'accept@cliente.local',
      token,
      ruolo: 'admin',
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .set('X-Tenant-Slug', SLUG)
      .send({ token, password: 'ClientePwd123!', firstName: 'Mario', lastName: 'Rossi' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');

    const user = await getUserByEmail(seed.tenantId, 'accept@cliente.local');
    expect(user?.tipo).toBe('cliente');
    expect(user?.azienda_id).toBe(aziendaId);
    expect(user?.cliente_ruolo).toBe('admin');

    // Login con la nuova password funziona.
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', SLUG)
      .send({ email: 'accept@cliente.local', password: 'ClientePwd123!' });
    expect(login.status).toBe(201);
  });

  it('auto-promote: azienda senza admin → primo "utente" diventa admin', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await insertInvito({
      tenantId: seed.tenantId,
      aziendaId,
      email: 'first@cliente.local',
      token,
      ruolo: 'utente',
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .set('X-Tenant-Slug', SLUG)
      .send({ token, password: 'ClientePwd123!', firstName: 'Prima', lastName: 'Persona' })
      .expect(200);

    const user = await getUserByEmail(seed.tenantId, 'first@cliente.local');
    expect(user?.cliente_ruolo).toBe('admin'); // promosso
  });

  it('auto-promote OFF: azienda con admin → "utente" resta utente', async () => {
    await insertClienteUser({
      tenantId: seed.tenantId,
      aziendaId,
      email: 'existing-admin@cliente.local',
      ruolo: 'admin',
    });
    const token = crypto.randomBytes(32).toString('hex');
    await insertInvito({
      tenantId: seed.tenantId,
      aziendaId,
      email: 'second@cliente.local',
      token,
      ruolo: 'utente',
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .set('X-Tenant-Slug', SLUG)
      .send({ token, password: 'ClientePwd123!', firstName: 'Seconda', lastName: 'Persona' })
      .expect(200);

    const user = await getUserByEmail(seed.tenantId, 'second@cliente.local');
    expect(user?.cliente_ruolo).toBe('utente'); // NON promosso
  });

  it('accept-invite token scaduto → 400 E_INVITO_TOKEN_EXPIRED', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await insertInvito({
      tenantId: seed.tenantId,
      aziendaId,
      email: 'exp@cliente.local',
      token,
      expiresInSeconds: -60,
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .set('X-Tenant-Slug', SLUG)
      .send({ token, password: 'ClientePwd123!', firstName: 'X', lastName: 'Y' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_INVITO_TOKEN_EXPIRED');
  });

  it('accept-invite token usato → 400 E_INVITO_TOKEN_INVALID', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await insertInvito({
      tenantId: seed.tenantId,
      aziendaId,
      email: 'used@cliente.local',
      token,
      used: true,
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .set('X-Tenant-Slug', SLUG)
      .send({ token, password: 'ClientePwd123!', firstName: 'X', lastName: 'Y' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_INVITO_TOKEN_INVALID');
  });
});
