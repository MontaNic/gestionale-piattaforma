// =============================================================================
// aziende-test-fixtures.ts — E2E helper dominio anagrafica clienti (STOP-c1b)
// =============================================================================
// Pattern replicato da apps/restaurant-api/.../menu-test-fixtures.ts:
//   - seedAziendePermissions: assegna i permessi anagrafica.cliente.* a un
//     utente via permission catalog (ON CONFLICT idempotente) + role
//     tenant-scoped + user_role tenant-wide.
//   - seedViewer: utente con un ruolo che ha SOLO anagrafica.cliente.visualizza
//     (NON .elimina) → per il test 403 sul DELETE.
//   - loginAs / flushTenantSlugCache: login reale + flush cache slug Redis.
//
// Setup phase via raw SQL (convenzione E2E ADR-0017 §TD-AW: setup raw SQL,
// assert via API/Prisma).
// =============================================================================

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/** I 4 permessi anagrafica.cliente.* (CRUD completo) — catalogo c1. */
export const ANAGRAFICA_CLIENTE_PERMISSION_CODES = [
  'anagrafica.cliente.crea',
  'anagrafica.cliente.modifica',
  'anagrafica.cliente.visualizza',
  'anagrafica.cliente.elimina',
] as const;

export interface AziendeFixturesResult {
  roleId: string;
  userRoleId: string;
  permissionIdByCode: Map<string, string>;
}

/**
 * Assegna a `userId` (tenant `tenantId`) i permessi `codes` (default: i 4
 * anagrafica.cliente.*) via:
 *   - permission catalog (ON CONFLICT su unique `code`, idempotente)
 *   - 1 role tenant-scoped con quei permessi
 *   - 1 user_role tenant-wide (sede_id NULL)
 * Chiamare DOPO seedMinimal / seedSecondTenant.
 */
export async function seedAziendePermissions(
  databaseUrl: string,
  opts: {
    tenantId: string;
    userId: string;
    roleName?: string;
    codes?: readonly string[];
  },
): Promise<AziendeFixturesResult> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const permissionIdByCode = new Map<string, string>();
  const roleName = opts.roleName ?? 'Anagrafica Admin';
  const codes = opts.codes ?? ANAGRAFICA_CLIENTE_PERMISSION_CODES;

  try {
    // 1. Permission catalog (anagrafica.*). ON CONFLICT idempotente.
    for (const code of codes) {
      const permId = uuidv7();
      const res = await client.query<{ id: string }>(
        `INSERT INTO permissions (id, code, description, category, is_pre_f2)
         VALUES ($1, $2, $3, 'anagrafica', false)
         ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
         RETURNING id;`,
        [permId, code, `E2E ${code}`],
      );
      const id = res.rows[0]?.id;
      if (!id) throw new Error(`Insert permission failed: ${code}`);
      permissionIdByCode.set(code, id);
    }

    // 2. Role tenant-scoped — partial unique index soft-delete-aware
    // (tenant_id, name) WHERE deleted_at IS NULL (TD-BZ): l'ON CONFLICT DEVE
    // includere lo stesso predicato WHERE.
    const roleId = uuidv7();
    const roleRes = await client.query<{ id: string }>(
      `INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at)
       VALUES ($1, $2, $3, 'E2E anagrafica role', true, NOW(), NOW())
       ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL
         DO UPDATE SET description = EXCLUDED.description
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

    return { roleId: effectiveRoleId, userRoleId: effectiveUserRoleId, permissionIdByCode };
  } finally {
    await client.end();
  }
}

/**
 * Crea un utente "viewer" nello stesso tenant con un ruolo che ha SOLO
 * `anagrafica.cliente.visualizza` (NON .elimina). Per il test 403 sul DELETE:
 * il viewer può leggere ma non eliminare. Chiamare DOPO seedMinimal.
 */
export async function seedViewer(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');

  const userId = uuidv7();
  const email = opts.email ?? 'viewer@studio.local';
  const password = opts.password ?? 'Viewer123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Viewer', 'Studio', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }

  // Ruolo con SOLO visualizza.
  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Anagrafica Viewer',
    codes: ['anagrafica.cliente.visualizza'],
  });

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
 * truncateDatabase + seed rigenerano tenant UUID: TenantConsistencyGuard cache
 * TTL 60s restituirebbe l'UUID stale → false-positive mismatch (Discovery #51).
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
