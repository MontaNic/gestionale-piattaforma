// =============================================================================
// menu-test-fixtures.ts — E2E helper F1 Menu domain (sessione 17 ADR-0019)
// =============================================================================
// seedMenuPermissions: assegna i 5 permessi `menu.*` (categoria.gestisci,
// piatto.crea, piatto.modifica, prezzo.modifica, visualizza) all'utente passato
// via creazione di permessi + role tenant-scoped + user_role tenant-wide.
// Idempotente entro singolo test run; truncateDatabase pulisce tra test.
//
// Pattern replicato da rbac-permissions.e2e-spec.ts (seedRbacFixtures inline)
// ma centralizzato qui per riuso cross-spec menu CRUD.
//
// loginAs / flushTenantSlugCache: helper login + Redis tenant slug cache flush
// (pattern Discovery #51 sessione 16). Riusabili da tutti gli spec menu.
// =============================================================================

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export const MENU_PERMISSION_CODES = [
  'menu.categoria.gestisci',
  'menu.piatto.crea',
  'menu.piatto.modifica',
  'menu.prezzo.modifica',
  'menu.visualizza',
] as const;

export interface MenuFixturesResult {
  /** id del ruolo "Menu Admin" creato nel tenant del seed */
  roleId: string;
  /** id della UserRole tenant-wide assegnata all'utente */
  userRoleId: string;
  /** map permission code -> permission id (per assertion downstream) */
  permissionIdByCode: Map<string, string>;
}

/**
 * Seed minimo per testare endpoint `/menus`, `/menus/:id/categories`,
 * `/articles`, `/articles/:id/prices`, `/price-lists`:
 *
 *   - 5 permission `menu.*` (idempotente via ON CONFLICT su unique `code`)
 *   - 1 role tenant-scoped "Menu Admin" con tutte le 5 permission
 *   - 1 user_role tenant-wide (sede_id NULL) per `userId`
 *
 * Chiamare DOPO seedMinimal / seedSecondTenant. Usabile per entrambi i tenant
 * (demo + acme) se serve grant cross-tenant.
 */
export async function seedMenuPermissions(
  databaseUrl: string,
  opts: { tenantId: string; userId: string; roleName?: string },
): Promise<MenuFixturesResult> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const permissionIdByCode = new Map<string, string>();
  const roleName = opts.roleName ?? 'Menu Admin';

  try {
    // 1. Permission catalog (5 menu.*). ON CONFLICT idempotente.
    for (const code of MENU_PERMISSION_CODES) {
      const permId = uuidv7();
      const res = await client.query<{ id: string }>(
        `INSERT INTO permissions (id, code, description, category, is_pre_f2)
         VALUES ($1, $2, $3, 'menu', false)
         ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
         RETURNING id;`,
        [permId, code, `E2E ${code}`],
      );
      const id = res.rows[0]?.id;
      if (!id) throw new Error(`Insert permission failed: ${code}`);
      permissionIdByCode.set(code, id);
    }

    // 2. Role "Menu Admin" tenant-scoped (UNIQUE(tenant_id, name))
    const roleId = uuidv7();
    const roleRes = await client.query<{ id: string }>(
      `INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at)
       VALUES ($1, $2, $3, 'E2E menu admin role', true, NOW(), NOW())
       ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description
       RETURNING id;`,
      [roleId, opts.tenantId, roleName],
    );
    const effectiveRoleId = roleRes.rows[0]?.id;
    if (!effectiveRoleId) throw new Error('Insert role failed');

    // 3. role_permissions (PK composta = idempotente)
    for (const permId of permissionIdByCode.values()) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        [effectiveRoleId, permId],
      );
    }

    // 4. UserRole tenant-wide (sede_id NULL)
    const userRoleId = uuidv7();
    const userRoleRes = await client.query<{ id: string }>(
      `INSERT INTO user_roles (id, user_id, role_id, sede_id, assigned_at)
       SELECT $1, $2, $3, NULL, NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM user_roles
         WHERE user_id = $2 AND role_id = $3 AND sede_id IS NULL
       )
       RETURNING id;`,
      [userRoleId, opts.userId, effectiveRoleId],
    );
    const effectiveUserRoleId = userRoleRes.rows[0]?.id ?? userRoleId;

    return {
      roleId: effectiveRoleId,
      userRoleId: effectiveUserRoleId,
      permissionIdByCode,
    };
  } finally {
    await client.end();
  }
}

/**
 * Seed user "limited" sullo stesso tenant: nessun role assegnato → zero
 * permission grants. Utile per test deny path (403 E_AUTH_INSUFFICIENT_PERMISSIONS).
 */
export async function seedLimitedUser(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');

  const userId = uuidv7();
  const email = opts.email ?? 'limited@demo.local';
  const password = opts.password ?? 'Limited123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Limited', 'User', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }
  return { userId, email, password };
}

/**
 * Login via POST /api/v1/auth/login → ritorna accessToken JWT.
 * X-Tenant-Slug header obbligatorio pre-auth (tenant resolution).
 */
export async function loginAs(
  app: INestApplication,
  tenantSlug: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Tenant-Slug', tenantSlug)
    .send({ email, password });
  if (res.status !== 201) {
    throw new Error(
      `Login failed for ${email} on tenant ${tenantSlug}: status=${res.status} body=${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.accessToken as string;
}

/**
 * Pulisce namespace `tenant:slug:*` in Redis tra test. Necessario quando
 * truncateDatabase + seedMinimal/seedSecondTenant rigenerano tenant UUID:
 * TenantConsistencyGuard cache TTL 60s restituirebbe l'UUID stale del run
 * precedente → false-positive mismatch 401 (Discovery #51 sessione 16).
 */
export async function flushTenantSlugCache(host: string, port: number): Promise<void> {
  const { default: Redis } = await import('ioredis');
  const client = new Redis({ host, port, lazyConnect: false, maxRetriesPerRequest: 1 });
  try {
    const keys = await client.keys('tenant:slug:*');
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } finally {
    await client.quit();
  }
}
