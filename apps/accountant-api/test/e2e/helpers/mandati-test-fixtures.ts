// =============================================================================
// mandati-test-fixtures.ts — E2E helper dominio mandati/incarichi (ADR-0051)
// =============================================================================
// L'admin mandati ha bisogno di: anagrafica.cliente.* (azienda parent),
// preventivi.* (creare + accettare il preventivo da cui nasce il mandato),
// mandati.* (gestione). Il viewer ha solo mandati.visualizza → 403 sul create.
// =============================================================================

export { seedAziendePermissions, loginAs, flushTenantSlugCache } from './aziende-test-fixtures';
export { createAziendaViaApi } from './referenti-test-fixtures';

export const MANDATI_ADMIN_CODES = [
  'anagrafica.cliente.crea',
  'anagrafica.cliente.visualizza',
  'preventivi.visualizza',
  'preventivi.gestisci',
  'mandati.visualizza',
  'mandati.gestisci',
] as const;

export const MANDATI_VIEWER_CODES = ['mandati.visualizza'] as const;

/** Viewer mandati (solo visualizza) → 403 sul create. Mirror seedScadenzeViewer. */
export async function seedMandatiViewer(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');
  const { seedAziendePermissions } = await import('./aziende-test-fixtures');

  const userId = uuidv7();
  const email = opts.email ?? 'mandati-viewer@studio.local';
  const password = opts.password ?? 'Viewer123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Viewer', 'Mandati', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }

  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Mandati Viewer',
    codes: [...MANDATI_VIEWER_CODES],
  });

  return { userId, email, password };
}
