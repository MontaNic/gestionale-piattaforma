// =============================================================================
// dashboard-test-fixtures.ts — E2E helper DASHBOARD (ADR-0084)
// =============================================================================
// Un solo helper: assegnare `report.operativo.visualizza` a un utente via
// permission catalog + role tenant-scoped + user_role. Sta a parte da
// `comande-test-fixtures` di proposito — il punto degli RBAC test della
// dashboard è proprio che il gate NON è un permesso comande/cassa: un utente
// con tutti i `comande.*` e nessun `report.*` deve prendere 403.
//
// Pattern SQL raw modellato su seedComandePermissions (stesse ON CONFLICT,
// stessa forma degli insert).
// =============================================================================

export const DASHBOARD_PERMISSION_CODE = 'report.operativo.visualizza';

/** Categoria = primo segmento prima del primo punto (convenzione seed.ts). */
function categoryOf(code: string): string {
  return code.split('.')[0] ?? 'report';
}

export async function seedDashboardPermission(
  databaseUrl: string,
  opts: { tenantId: string; userId: string; roleName?: string },
): Promise<{ roleId: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');

  const roleName = opts.roleName ?? 'Dashboard Reader';

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const permRes = await client.query<{ id: string }>(
      `INSERT INTO permissions (id, code, description, category, is_pre_f2)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
       RETURNING id;`,
      [
        uuidv7(),
        DASHBOARD_PERMISSION_CODE,
        `E2E ${DASHBOARD_PERMISSION_CODE}`,
        categoryOf(DASHBOARD_PERMISSION_CODE),
      ],
    );
    const permId = permRes.rows[0]?.id;
    if (!permId) throw new Error(`Insert permission failed: ${DASHBOARD_PERMISSION_CODE}`);

    const roleRes = await client.query<{ id: string }>(
      `INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at)
       VALUES ($1, $2, $3, 'E2E dashboard role', true, NOW(), NOW())
       ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL
         DO UPDATE SET description = EXCLUDED.description
       RETURNING id;`,
      [uuidv7(), opts.tenantId, roleName],
    );
    const roleId = roleRes.rows[0]?.id;
    if (!roleId) throw new Error('Insert role failed');

    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING;`,
      [roleId, permId],
    );

    await client.query(
      `INSERT INTO user_roles (id, user_id, role_id, sede_id, assigned_at)
       SELECT $1, $2, $3, NULL, NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM user_roles WHERE user_id = $2 AND role_id = $3 AND sede_id IS NULL
       );`,
      [uuidv7(), opts.userId, roleId],
    );

    return { roleId };
  } finally {
    await client.end();
  }
}
