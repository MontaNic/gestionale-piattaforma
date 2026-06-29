// =============================================================================
// tariffe-test-fixtures.ts — E2E helper tariffario orario (ADR-0055)
// =============================================================================
// L'admin tariffe gestisce il listino (tariffario.gestisci/visualizza). Per i
// test di DERIVAZIONE serve l'intera catena fino alla prestazione (azienda →
// preventivo accettato → mandato → timesheet) + tariffario.gestisci per creare
// le tariffe. Il viewer ha solo tariffario.visualizza → 403 sul create.
// =============================================================================

export { seedAziendePermissions, loginAs, flushTenantSlugCache } from './aziende-test-fixtures';
export { createAziendaViaApi } from './referenti-test-fixtures';

/** Gestione listino tariffe (CRUD). */
export const TARIFFE_ADMIN_CODES = ['tariffario.visualizza', 'tariffario.gestisci'] as const;

/** Catena completa per i test di derivazione importo (+ gestione tariffe). */
export const TARIFFE_DERIV_ADMIN_CODES = [
  'anagrafica.cliente.crea',
  'anagrafica.cliente.visualizza',
  'preventivi.visualizza',
  'preventivi.gestisci',
  'mandati.visualizza',
  'mandati.gestisci',
  'prestazioni.visualizza',
  'prestazioni.gestisci',
  'tariffario.gestisci',
] as const;

export const TARIFFE_VIEWER_CODES = ['tariffario.visualizza'] as const;

/** Viewer tariffe (solo visualizza) → 403 sul create. */
export async function seedTariffeViewer(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');
  const { seedAziendePermissions } = await import('./aziende-test-fixtures');

  const userId = uuidv7();
  const email = opts.email ?? 'tariffe-viewer@studio.local';
  const password = opts.password ?? 'Viewer123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Viewer', 'Tariffe', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }

  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Tariffe Viewer',
    codes: [...TARIFFE_VIEWER_CODES],
  });

  return { userId, email, password };
}
