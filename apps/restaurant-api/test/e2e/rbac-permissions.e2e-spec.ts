import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, seedMinimal, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';

// =============================================================================
// rbac-permissions.e2e-spec.ts (sessione 11, ADR-0017) — E2E PermissionsGuard
// =============================================================================
// 3 scenari smoke RBAC su POST /api/v1/tenants:
//   1. Admin con `sistema.tenant.gestisci` (role + permission grant) → 201
//   2. User limited senza role/grant → 403 E_AUTH_INSUFFICIENT_PERMISSIONS
//   3. Audit row `auth.permission_denied` insertata post-deny (afterValue
//      shape: endpoint, mode, requiredPermissions)
//
// Setup: container fresh per file (B2b pattern). beforeEach: truncate +
// seedMinimal (admin demo) + seedRbacFixtures (permission + role + grant +
// limited user). Login UI POST /auth/login per JWT.
//
// NB: seedMinimal NON copre RBAC schema (63 permessi + 11 templates + 249
// mappings). seedRbacFixtures aggiunge il minimo necessario inline via raw SQL.
// =============================================================================

interface RbacFixtures {
  adminUserId: string;
  tenantId: string;
  permissionId: string;
  roleId: string;
  limitedUserId: string;
}

async function seedRbacFixtures(
  databaseUrl: string,
  seedResult: { tenantId: string; adminUserId: string },
): Promise<RbacFixtures> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const permissionId = uuidv7();
  const roleId = uuidv7();
  const userRoleId = uuidv7();
  const limitedUserId = uuidv7();
  const templateId = uuidv7();
  const limitedPasswordHash = await argon2.hash('Limited123!', { type: argon2.argon2id });

  // 1. Permission `sistema.tenant.gestisci`
  await client.query(
    `INSERT INTO permissions (id, code, description, category, is_pre_f2)
     VALUES ($1, 'sistema.tenant.gestisci', 'Configurazione tenant globale', 'sistema', false);`,
    [permissionId],
  );

  // 2. SystemRoleTemplate 'Super Admin' (isDefault=true). Necessario per
  // scenario allow: createTenant clona system_role_templates al bootstrap del
  // nuovo tenant (tenants.service.ts ~125). seedMinimal NON seeda templates
  // — fixture E2E inline minimale (1 template + 1 permission, no 32+6+104).
  await client.query(
    `INSERT INTO system_role_templates (id, name, description, is_default, created_at, updated_at)
     VALUES ($1, 'Super Admin', 'E2E template', true, NOW(), NOW());`,
    [templateId],
  );
  await client.query(
    `INSERT INTO system_role_template_permissions (template_id, permission_id)
     VALUES ($1, $2);`,
    [templateId, permissionId],
  );

  // 3. Role `Test Super Admin` nel tenant demo (per admin demo grant)
  await client.query(
    `INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at)
     VALUES ($1, $2, 'Test Super Admin', 'E2E test role', true, NOW(), NOW());`,
    [roleId, seedResult.tenantId],
  );

  // 4. Role_permission link
  await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2);`, [
    roleId,
    permissionId,
  ]);

  // 5. UserRole: assegna admin demo al ruolo tenant-wide (sede_id NULL)
  await client.query(
    `INSERT INTO user_roles (id, user_id, role_id, sede_id, assigned_at)
     VALUES ($1, $2, $3, NULL, NOW());`,
    [userRoleId, seedResult.adminUserId, roleId],
  );

  // 6. User "limited" SENZA role (zero permissions)
  await client.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
     VALUES ($1, $2, 'limited@demo.local', $3, 'Limited', 'User', true, 0, NOW(), NOW());`,
    [limitedUserId, seedResult.tenantId, limitedPasswordHash],
  );

  await client.end();

  return {
    adminUserId: seedResult.adminUserId,
    tenantId: seedResult.tenantId,
    permissionId,
    roleId,
    limitedUserId,
  };
}

async function loginAs(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Tenant-Slug', 'demo')
    .send({ email, password });
  if (res.status !== 201) {
    throw new Error(
      `Login failed for ${email}: status=${res.status} body=${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.accessToken as string;
}

interface AuditRow {
  action: string;
  user_id: string;
  tenant_id: string;
  after_value: unknown;
}

async function queryAuditPermissionDenied(
  databaseUrl: string,
  userId: string,
): Promise<AuditRow[]> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const result = await client.query<AuditRow>(
    `SELECT action, user_id, tenant_id, after_value
     FROM audit_logs
     WHERE action = 'auth.permission_denied' AND user_id = $1;`,
    [userId],
  );
  await client.end();
  return result.rows;
}

describe('PermissionsGuard E2E — POST /tenants', () => {
  let containers: TestContainers;
  let app: INestApplication;
  let fixtures: RbacFixtures;

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
    const seedResult = await seedMinimal(containers.databaseUrl);
    fixtures = await seedRbacFixtures(containers.databaseUrl, seedResult);
  });

  it('scenario 1 — admin demo con sistema.tenant.gestisci → 201 Created', async () => {
    const adminJwt = await loginAs(app, 'admin@demo.local', 'Admin123!');

    const res = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        name: 'Test Tenant RBAC Allow',
        slug: 'test-rbac-allow',
        adminEmail: 'newadmin@test-rbac-allow.local',
        adminPassword: 'NewAdmin123!',
        adminFirstName: 'New',
        adminLastName: 'Admin',
      });

    expect(res.status).toBe(201);
    expect(res.body.data?.tenant?.slug).toBe('test-rbac-allow');
  });

  it('scenario 2 — user limited senza permission → 403 E_AUTH_INSUFFICIENT_PERMISSIONS', async () => {
    const limitedJwt = await loginAs(app, 'limited@demo.local', 'Limited123!');

    const res = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${limitedJwt}`)
      .send({
        name: 'Should Not Create',
        slug: 'should-not-create',
        adminEmail: 'admin@should-not-create.local',
        adminPassword: 'AdminPass123!',
        adminFirstName: 'Admin',
        adminLastName: 'Block',
      });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('E_AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('scenario 3 — audit row auth.permission_denied insertata post-deny', async () => {
    const limitedJwt = await loginAs(app, 'limited@demo.local', 'Limited123!');

    // Trigger deny
    await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${limitedJwt}`)
      .send({
        name: 'Trigger Audit',
        slug: 'trigger-audit',
        adminEmail: 'admin@trigger-audit.local',
        adminPassword: 'AdminPass123!',
        adminFirstName: 'Audit',
        adminLastName: 'Trigger',
      })
      .expect(403);

    // Query audit_logs
    const auditRows = await queryAuditPermissionDenied(
      containers.databaseUrl,
      fixtures.limitedUserId,
    );

    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0];
    expect(audit.action).toBe('auth.permission_denied');
    expect(audit.user_id).toBe(fixtures.limitedUserId);
    expect(audit.tenant_id).toBe(fixtures.tenantId);
    expect(audit.after_value).toMatchObject({
      mode: 'AND',
      requiredPermissions: ['sistema.tenant.gestisci'],
    });
    // Endpoint contiene method POST + path tenants (esatto: 'POST /tenants' o
    // 'POST /api/v1/tenants' a seconda di route.path vs url fallback)
    const afterValue = audit.after_value as { endpoint: string };
    expect(afterValue.endpoint).toMatch(/POST .*tenants/);
  });
});
