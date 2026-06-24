import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestApp,
  E2E_PLATFORM_TENANT_ID,
  seedMinimal,
  truncateDatabase,
} from './helpers/test-app';
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

// =============================================================================
// platform-tenants.e2e-spec.ts (feat/superadmin-platform Commit 1 BE)
// =============================================================================
// Superadmin minimale: gestione tenant sotto /api/v1/platform/tenants, gated da
// PlatformGuard (tenant === oneplatform). Scenari:
//   1. list come platform → 200 + tutti i tenant
//   2. list come tenant NON-platform (ma con sistema.tenant.gestisci) → 403 PlatformGuard
//   3. create come platform → 201 + presente in list
//   4. suspend/restore → isActive false/true
//   5. softDelete → sparisce dalla list
//   6. suspend del tenant di piattaforma stesso → 403 E_PLATFORM_CANNOT_MODIFY_SELF
//
// Setup raw SQL (convenzione E2E). Il superadmin è un utente del tenant
// `oneplatform` (id fisso E2E_PLATFORM_TENANT_ID) con sistema.tenant.gestisci.
// I system_role_templates (Super Admin isDefault) servono alla create (clone).
// =============================================================================

const PLATFORM_SLUG = 'oneplatform';
const SA_EMAIL = 'superadmin@oneplatform.local';
const SA_PW = 'Superadmin123!';

describe('Platform superadmin — /api/v1/platform/tenants (E2E)', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let platformJwt: string;
  let normalJwt: string;
  let normalTenantId: string;

  async function pg() {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: containers.databaseUrl });
    await client.connect();
    return client;
  }

  // Tenant `oneplatform` con id fisso + sede + superadmin user (argon2).
  async function seedPlatformTenant(): Promise<void> {
    const { uuidv7: v7 } = await import('uuidv7');
    const argon2 = await import('argon2');
    const hash = await argon2.hash(SA_PW, { type: argon2.argon2id });
    const client = await pg();
    await client.query(
      `INSERT INTO tenants (id, name, slug, is_active, created_at, updated_at)
       VALUES ($1, 'OnePlatform', $2, true, NOW(), NOW());`,
      [E2E_PLATFORM_TENANT_ID, PLATFORM_SLUG],
    );
    await client.query(
      `INSERT INTO sedi (id, tenant_id, name, address, city, postal_code, country, timezone, currency, is_active, created_at, updated_at)
       VALUES ($1, $2, 'Sede Piattaforma', 'Via P 1', 'Milano', '20100', 'IT', 'Europe/Rome', 'EUR', true, NOW(), NOW());`,
      [v7(), E2E_PLATFORM_TENANT_ID],
    );
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Super', 'Admin', true, 0, NOW(), NOW());`,
      [v7(), E2E_PLATFORM_TENANT_ID, SA_EMAIL, hash],
    );
    await client.end();
  }

  async function platformUserId(): Promise<string> {
    const client = await pg();
    const res = await client.query(`SELECT id FROM users WHERE email = $1;`, [SA_EMAIL]);
    await client.end();
    return res.rows[0].id as string;
  }

  // system_role_templates 'Super Admin' (isDefault) + mapping sistema.tenant.gestisci,
  // necessari a createTenant (clona i template al bootstrap del nuovo tenant).
  async function seedSystemTemplates(): Promise<void> {
    const client = await pg();
    const perm = await client.query(
      `SELECT id FROM permissions WHERE code = 'sistema.tenant.gestisci';`,
    );
    const permId = perm.rows[0]?.id as string;
    const tplId = uuidv7();
    await client.query(
      `INSERT INTO system_role_templates (id, name, description, is_default, created_at, updated_at)
       VALUES ($1, 'Super Admin', 'E2E template', true, NOW(), NOW())
       ON CONFLICT (name) DO NOTHING;`,
      [tplId],
    );
    const tpl = await client.query(
      `SELECT id FROM system_role_templates WHERE name = 'Super Admin';`,
    );
    await client.query(
      `INSERT INTO system_role_template_permissions (template_id, permission_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
      [tpl.rows[0].id, permId],
    );
    await client.end();
  }

  async function listSlugs(jwt: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${jwt}`);
    return (res.body.data as { slug: string }[]).map((t) => t.slug);
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

    // Tenant normale (studio-demo) + admin con sistema.tenant.gestisci → serve a
    // dimostrare che PERFINO un Super Admin di tenant NON accede a /platform/*.
    const normal = await seedMinimal(containers.databaseUrl);
    normalTenantId = normal.tenantId;
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: normal.tenantId,
      userId: normal.adminUserId,
      roleName: 'Tenant Super Admin',
      codes: ['sistema.tenant.gestisci'],
    });

    // Tenant di piattaforma + superadmin + permesso + system templates.
    await seedPlatformTenant();
    await seedAziendePermissions(containers.databaseUrl, {
      tenantId: E2E_PLATFORM_TENANT_ID,
      userId: await platformUserId(),
      roleName: 'Platform Super Admin',
      codes: ['sistema.tenant.gestisci'],
    });
    await seedSystemTemplates();

    platformJwt = await loginAs(app, PLATFORM_SLUG, SA_EMAIL, SA_PW);
    normalJwt = await loginAs(app, 'studio-demo', 'admin@studio.local', 'Admin123!');
  });

  it('GET /platform/tenants come platform → 200 + tutti i tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${platformJwt}`);
    expect(res.status).toBe(200);
    const slugs = (res.body.data as { slug: string }[]).map((t) => t.slug);
    expect(slugs).toContain('oneplatform');
    expect(slugs).toContain('studio-demo');
  });

  it('GET /platform/tenants come tenant NON-platform (con sistema.tenant.gestisci) → 403 E_PLATFORM_FORBIDDEN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${normalJwt}`);
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_PLATFORM_FORBIDDEN');
  });

  it('POST /platform/tenants come platform → 201 + presente in list', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${platformJwt}`)
      .send({
        name: 'Nuovo Studio',
        slug: 'nuovo-studio',
        adminEmail: 'admin@nuovo.local',
        adminPassword: 'Nuovo123!',
        adminFirstName: 'Anna',
        adminLastName: 'Verdi',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.tenant.slug).toBe('nuovo-studio');
    expect(await listSlugs(platformJwt)).toContain('nuovo-studio');
  });

  it('PATCH suspend/restore → isActive false poi true', async () => {
    const s = await request(app.getHttpServer())
      .patch(`/api/v1/platform/tenants/${normalTenantId}/suspend`)
      .set('Authorization', `Bearer ${platformJwt}`);
    expect(s.status).toBe(200);
    expect(s.body.data.isActive).toBe(false);

    const r = await request(app.getHttpServer())
      .patch(`/api/v1/platform/tenants/${normalTenantId}/restore`)
      .set('Authorization', `Bearer ${platformJwt}`);
    expect(r.status).toBe(200);
    expect(r.body.data.isActive).toBe(true);
  });

  it('DELETE → soft-delete (sparisce dalla list)', async () => {
    const d = await request(app.getHttpServer())
      .delete(`/api/v1/platform/tenants/${normalTenantId}`)
      .set('Authorization', `Bearer ${platformJwt}`);
    expect(d.status).toBe(200);
    expect(d.body.data).toEqual({ id: normalTenantId, deleted: true });
    expect(await listSlugs(platformJwt)).not.toContain('studio-demo');
  });

  it('suspend del tenant di piattaforma stesso → 403 E_PLATFORM_CANNOT_MODIFY_SELF', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/platform/tenants/${E2E_PLATFORM_TENANT_ID}/suspend`)
      .set('Authorization', `Bearer ${platformJwt}`);
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_PLATFORM_CANNOT_MODIFY_SELF');
  });

  it('DELETE tenant inesistente → 404 E_TENANT_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/platform/tenants/${uuidv7()}`)
      .set('Authorization', `Bearer ${platformJwt}`);
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('E_TENANT_NOT_FOUND');
  });
});
