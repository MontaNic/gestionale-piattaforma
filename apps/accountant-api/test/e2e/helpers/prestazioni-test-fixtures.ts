// =============================================================================
// prestazioni-test-fixtures.ts — E2E helper timesheet/prestazioni (ADR-0053)
// =============================================================================
// L'admin prestazioni serve di tutta la catena per arrivare al mandato:
// anagrafica.cliente.* (azienda) + preventivi.* (preventivo→accettato) +
// mandati.* (crea mandato) + prestazioni.* (timesheet). Il viewer ha solo
// prestazioni.visualizza → 403 sul create.
// =============================================================================

export { seedAziendePermissions, loginAs, flushTenantSlugCache } from './aziende-test-fixtures';
export { createAziendaViaApi } from './referenti-test-fixtures';

export const PRESTAZIONI_ADMIN_CODES = [
  'anagrafica.cliente.crea',
  'anagrafica.cliente.visualizza',
  'preventivi.visualizza',
  'preventivi.gestisci',
  'mandati.visualizza',
  'mandati.gestisci',
  'prestazioni.visualizza',
  'prestazioni.gestisci',
] as const;

export const PRESTAZIONI_VIEWER_CODES = ['prestazioni.visualizza'] as const;

/** Viewer prestazioni (solo visualizza) → 403 sul create. Mirror seedMandatiViewer. */
export async function seedPrestazioniViewer(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');
  const { seedAziendePermissions } = await import('./aziende-test-fixtures');

  const userId = uuidv7();
  const email = opts.email ?? 'prestazioni-viewer@studio.local';
  const password = opts.password ?? 'Viewer123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Viewer', 'Prestazioni', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }

  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Prestazioni Viewer',
    codes: [...PRESTAZIONI_VIEWER_CODES],
  });

  return { userId, email, password };
}
