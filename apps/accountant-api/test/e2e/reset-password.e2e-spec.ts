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

// =============================================================================
// reset-password.e2e-spec.ts (feat/reset-password Commit 1 BE)
// =============================================================================
// Copre il flow forgot/reset password via supertest + full NestJS bootstrap:
//   1. forgot-password email esistente → 200 {success:true} + 1 token in DB
//   2. forgot-password email inesistente → 200 {success:true} + 0 token (NO ORACLE)
//   3. reset-password flow completo → 200, vecchia pwd 401, nuova pwd 201,
//      token marcato usato, sessioni revocate
//   4. reset-password token scaduto → 400 E_AUTH_RESET_TOKEN_EXPIRED
//   5. reset-password token usato → 400 E_AUTH_RESET_TOKEN_INVALID
//   6. reset-password token inesistente → 400 E_AUTH_RESET_TOKEN_INVALID
//   7. reset-password password troppo corta → 400 E_AUTH_PASSWORD_TOO_SHORT
//
// Il token in chiaro viaggia SOLO via email (in DB sta solo sha256), e in E2E
// l'SMTP è chiuso (fail-open, niente cattura). Per i test di consumo inseriamo
// quindi la riga password_resets direttamente con un token noto (sha256 lato
// test), riproducendo esattamente ciò che forgotPassword scrive.
//
// La connessione di test usa il superuser del container (bypass RLS, come gli
// helper seed/truncate). Lo scoping per tenant è comunque garantito dai
// `where: { tenantId }` nel service. RLS isolation ha il suo spec dedicato.
// =============================================================================

const SLUG = 'studio-demo';
const EMAIL = 'admin@studio.local';
const OLD_PASSWORD = 'Admin123!';
const NEW_PASSWORD = 'NuovaPassword123!';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('Reset password flow (E2E)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let seed: { tenantId: string; sedeId: string; adminUserId: string };

  // Inserisce una riga password_resets con token noto. expires_at e used_at sono
  // calcolati lato Postgres (NOW() ± INTERVAL): bindare un JS Date come param su
  // una colonna `timestamp without time zone` introduce uno shift di fuso
  // (node-postgres serializza nel tz locale del processo), che falsa i confronti
  // di scadenza. NOW()-side evita del tutto la conversione.
  async function insertReset(opts: {
    token: string;
    userId: string;
    tenantId: string;
    /** Secondi da ora per la scadenza (negativo = già scaduto). Default 1h. */
    expiresInSeconds?: number;
    /** Se true, token già consumato (used_at = NOW()). */
    used?: boolean;
  }): Promise<void> {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: containers.databaseUrl });
    await client.connect();
    await client.query(
      `INSERT INTO password_resets (id, tenant_id, user_id, token_hash, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5 * INTERVAL '1 second'), ${opts.used ? 'NOW()' : 'NULL'}, NOW());`,
      [uuidv7(), opts.tenantId, opts.userId, hashToken(opts.token), opts.expiresInSeconds ?? 3600],
    );
    await client.end();
  }

  async function countResets(userId: string): Promise<number> {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: containers.databaseUrl });
    await client.connect();
    const res = await client.query(
      'SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1;',
      [userId],
    );
    await client.end();
    return res.rows[0].n as number;
  }

  async function getReset(token: string): Promise<{ used_at: Date | null } | undefined> {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: containers.databaseUrl });
    await client.connect();
    const res = await client.query('SELECT used_at FROM password_resets WHERE token_hash = $1;', [
      hashToken(token),
    ]);
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
    seed = await seedMinimal(containers.databaseUrl);
  });

  // ─── forgot-password ──────────────────────────────────────────────────────

  it('POST /auth/forgot-password email esistente → 200 + 1 token creato', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('X-Tenant-Slug', SLUG)
      .send({ email: EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });
    expect(await countResets(seed.adminUserId)).toBe(1);
  });

  it('POST /auth/forgot-password email inesistente → 200 + 0 token (no oracle)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('X-Tenant-Slug', SLUG)
      .send({ email: 'nessuno@studio.local' });

    // Stessa response identica al caso esistente: nessun leak su esistenza email.
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });
    expect(await countResets(seed.adminUserId)).toBe(0);
  });

  // ─── reset-password: flow completo ─────────────────────────────────────────

  it('POST /auth/reset-password flow completo → cambia pwd, revoca sessioni, marca token usato', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await insertReset({ token, userId: seed.adminUserId, tenantId: seed.tenantId });

    // Sessione attiva pre-reset (login con vecchia pwd) → deve essere revocata.
    const preLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', SLUG)
      .send({ email: EMAIL, password: OLD_PASSWORD });
    expect(preLogin.status).toBe(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('X-Tenant-Slug', SLUG)
      .send({ token, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });

    // Token marcato come usato (monouso).
    expect((await getReset(token))?.used_at).not.toBeNull();

    // Vecchia password non funziona più.
    const oldLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', SLUG)
      .send({ email: EMAIL, password: OLD_PASSWORD });
    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body.errorCode).toBe('E_AUTH_INVALID_CREDENTIALS');

    // Nuova password funziona.
    const newLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', SLUG)
      .send({ email: EMAIL, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(201);
    expect(newLogin.body.data).toHaveProperty('accessToken');

    // Il refresh token della sessione pre-reset è stato revocato (theft/logout
    // globale): refresh con quel token → 401.
    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: preLogin.body.data.refreshToken });
    expect(refresh.status).toBe(401);
  });

  // ─── reset-password: token scaduto ─────────────────────────────────────────

  it('POST /auth/reset-password token scaduto → 400 E_AUTH_RESET_TOKEN_EXPIRED', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await insertReset({
      token,
      userId: seed.adminUserId,
      tenantId: seed.tenantId,
      expiresInSeconds: -60, // scaduto 1 min fa
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('X-Tenant-Slug', SLUG)
      .send({ token, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_AUTH_RESET_TOKEN_EXPIRED');

    // Vecchia password resta valida (reset non applicato).
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', SLUG)
      .send({ email: EMAIL, password: OLD_PASSWORD });
    expect(login.status).toBe(201);
  });

  // ─── reset-password: token già usato ───────────────────────────────────────

  it('POST /auth/reset-password token usato → 400 E_AUTH_RESET_TOKEN_INVALID', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await insertReset({
      token,
      userId: seed.adminUserId,
      tenantId: seed.tenantId,
      used: true,
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('X-Tenant-Slug', SLUG)
      .send({ token, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_AUTH_RESET_TOKEN_INVALID');
  });

  // ─── reset-password: token inesistente ─────────────────────────────────────

  it('POST /auth/reset-password token inesistente → 400 E_AUTH_RESET_TOKEN_INVALID', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('X-Tenant-Slug', SLUG)
      .send({ token: crypto.randomBytes(32).toString('hex'), newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_AUTH_RESET_TOKEN_INVALID');
  });

  // ─── reset-password: password invalida (troppo corta) ──────────────────────
  // NB: la ValidationPipe non gira in E2E (vedi test-app.ts) → questo verifica
  // il check server-side in AuthService.resetPassword, non il DTO.

  it('POST /auth/reset-password password troppo corta → 400 E_AUTH_PASSWORD_TOO_SHORT', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await insertReset({ token, userId: seed.adminUserId, tenantId: seed.tenantId });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('X-Tenant-Slug', SLUG)
      .send({ token, newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('E_AUTH_PASSWORD_TOO_SHORT');

    // Token NON consumato (validazione fallisce prima): resta usabile.
    expect((await getReset(token))?.used_at).toBeNull();
  });
});
