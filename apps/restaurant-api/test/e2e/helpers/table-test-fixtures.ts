// =============================================================================
// table-test-fixtures.ts — E2E helper F2 Tavoli domain (ADR-0058)
// =============================================================================
// seedTablePermissions: assegna i permessi `tavoli.*` a un utente via permission
// catalog + role tenant-scoped + user_role tenant-wide. L'opzione `grant` decide
// il sottoinsieme concesso al ruolo:
//   - 'manager' → tavoli.visualizza + tavoli.gestisci (CRUD completo)
//   - 'viewer'  → solo tavoli.visualizza (legge ma non scrive → 403 su POST/PATCH/DELETE)
// Entrambe le permission del catalog sono sempre inserite (idempotente); cambia
// solo cosa è linkato al ruolo. Pattern replicato 1:1 da menu-test-fixtures.ts.
//
// loginAs / flushTenantSlugCache / seedLimitedUser sono riusati da
// menu-test-fixtures (generici, non menu-specifici).
// =============================================================================

export const TABLE_PERMISSION_CODES = ['tavoli.visualizza', 'tavoli.gestisci'] as const;

export type TableGrant = 'manager' | 'viewer';

export interface TableFixturesResult {
  roleId: string;
  userRoleId: string;
  permissionIdByCode: Map<string, string>;
}

/**
 * Seed permessi `tavoli.*` per testare `/tables`. Chiamare DOPO
 * seedMinimal / seedSecondTenant. `grant` default 'manager'.
 */
export async function seedTablePermissions(
  databaseUrl: string,
  opts: { tenantId: string; userId: string; grant?: TableGrant; roleName?: string },
): Promise<TableFixturesResult> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');

  const grant = opts.grant ?? 'manager';
  const grantedCodes: readonly string[] =
    grant === 'manager' ? TABLE_PERMISSION_CODES : ['tavoli.visualizza'];
  const roleName = opts.roleName ?? (grant === 'manager' ? 'Tavoli Manager' : 'Tavoli Viewer');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const permissionIdByCode = new Map<string, string>();

  try {
    // 1. Permission catalog (entrambe le tavoli.*). ON CONFLICT idempotente.
    for (const code of TABLE_PERMISSION_CODES) {
      const permId = uuidv7();
      const res = await client.query<{ id: string }>(
        `INSERT INTO permissions (id, code, description, category, is_pre_f2)
         VALUES ($1, $2, $3, 'tavoli', false)
         ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
         RETURNING id;`,
        [permId, code, `E2E ${code}`],
      );
      const id = res.rows[0]?.id;
      if (!id) throw new Error(`Insert permission failed: ${code}`);
      permissionIdByCode.set(code, id);
    }

    // 2. Role tenant-scoped — partial unique index soft-delete-aware
    // (tenant_id, name) WHERE deleted_at IS NULL (TD-BZ): l'ON CONFLICT deve
    // includere lo stesso predicato WHERE.
    const roleId = uuidv7();
    const roleRes = await client.query<{ id: string }>(
      `INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at)
       VALUES ($1, $2, $3, 'E2E tavoli role', true, NOW(), NOW())
       ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL
         DO UPDATE SET description = EXCLUDED.description
       RETURNING id;`,
      [roleId, opts.tenantId, roleName],
    );
    const effectiveRoleId = roleRes.rows[0]?.id;
    if (!effectiveRoleId) throw new Error('Insert role failed');

    // 3. role_permissions — solo i codici concessi dal grant.
    for (const code of grantedCodes) {
      const permId = permissionIdByCode.get(code);
      if (!permId) continue;
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
