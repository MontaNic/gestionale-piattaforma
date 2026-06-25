// =============================================================================
// report-test-fixtures.ts — E2E helper report margine (ADR-0054)
// =============================================================================
// L'admin report serve tutta la catena (azienda → preventivo → mandato →
// prestazioni) + report.operativo.visualizza per leggere /report/margine.
// Il "no-report" ha permessi ma NON report.operativo.visualizza → 403.
// =============================================================================

export { seedAziendePermissions, loginAs, flushTenantSlugCache } from './aziende-test-fixtures';
export { createAziendaViaApi } from './referenti-test-fixtures';

export const REPORT_ADMIN_CODES = [
  'anagrafica.cliente.crea',
  'anagrafica.cliente.visualizza',
  'preventivi.visualizza',
  'preventivi.gestisci',
  'mandati.visualizza',
  'mandati.gestisci',
  'prestazioni.visualizza',
  'prestazioni.gestisci',
  'report.operativo.visualizza',
] as const;

// Utente SENZA report.operativo.visualizza → 403 su /report/margine.
export const REPORT_NOACCESS_CODES = ['mandati.visualizza'] as const;

export async function seedReportNoAccessUser(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');
  const { seedAziendePermissions } = await import('./aziende-test-fixtures');

  const userId = uuidv7();
  const email = opts.email ?? 'report-noaccess@studio.local';
  const password = opts.password ?? 'Viewer123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'NoAccess', 'Report', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }

  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Report NoAccess',
    codes: [...REPORT_NOACCESS_CODES],
  });

  return { userId, email, password };
}
