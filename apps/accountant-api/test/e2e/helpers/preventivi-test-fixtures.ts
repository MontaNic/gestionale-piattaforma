// =============================================================================
// preventivi-test-fixtures.ts — E2E helper dominio preventivi (STOP-e1)
// =============================================================================
// Riusa l'infra anagrafica: l'admin del verticale ha bisogno SIA di
// anagrafica.cliente.* (per creare l'azienda parent via API) SIA di
// preventivi.* (per gestire i preventivi). `seedAziendePermissions` è generico
// (accetta `codes` + `roleName`) → lo si chiama con i codici combinati.
// NB: nel setup di test i permessi vengono inseriti con category 'anagrafica'
// (hardcoded nell'helper riusato) — cosmetico, la RBAC valuta il `code`, non la
// categoria. createAziendaViaApi riusato da referenti-test-fixtures.
// =============================================================================

export { seedAziendePermissions, loginAs, flushTenantSlugCache } from './aziende-test-fixtures';
export { createAziendaViaApi } from './referenti-test-fixtures';

/** Admin verticale: anagrafica.cliente.* (azienda parent) + preventivi.* (gestione). */
export const PREVENTIVI_ADMIN_CODES = [
  'anagrafica.cliente.crea',
  'anagrafica.cliente.modifica',
  'anagrafica.cliente.visualizza',
  'anagrafica.cliente.elimina',
  'preventivi.visualizza',
  'preventivi.gestisci',
] as const;

/** Viewer: solo letture (preventivi.visualizza, no gestisci) → 403 sul create. */
export const PREVENTIVI_VIEWER_CODES = ['preventivi.visualizza'] as const;

/**
 * Crea un utente "viewer" preventivi nello stesso tenant con SOLO
 * `preventivi.visualizza` (no `preventivi.gestisci`). Per il test 403 sul create.
 * Mirror di seedViewer (aziende-test-fixtures) con codici preventivi.
 */
export async function seedPreventiviViewer(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');
  const { seedAziendePermissions } = await import('./aziende-test-fixtures');

  const userId = uuidv7();
  const email = opts.email ?? 'preventivi-viewer@studio.local';
  const password = opts.password ?? 'Viewer123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Viewer', 'Preventivi', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }

  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Preventivi Viewer',
    codes: [...PREVENTIVI_VIEWER_CODES],
  });

  return { userId, email, password };
}
