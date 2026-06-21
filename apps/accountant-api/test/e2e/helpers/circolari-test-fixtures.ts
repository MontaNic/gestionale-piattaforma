// =============================================================================
// circolari-test-fixtures.ts — E2E helper dominio circolari (ADR-0045)
// =============================================================================
// Riusa l'infra anagrafica: l'admin del modulo ha bisogno SIA di
// anagrafica.cliente.* (per creare l'azienda parent via API, usata come
// destinatario tipo='azienda') SIA di circolari.* (create/publish/archive).
// `seedAziendePermissions` è generico → chiamato coi codici combinati.
//
// Il "redattore" ha SOLO circolari.create (no publish): serve a verificare il
// 403 su POST /:id/publish (permesso publish mancante).
// =============================================================================

export { seedAziendePermissions, loginAs, flushTenantSlugCache } from './aziende-test-fixtures';
export { createAziendaViaApi } from './referenti-test-fixtures';

/** Admin modulo: anagrafica.cliente.* (azienda parent) + circolari.* (gestione). */
export const CIRCOLARI_ADMIN_CODES = [
  'anagrafica.cliente.crea',
  'anagrafica.cliente.visualizza',
  'circolari.create',
  'circolari.publish',
  'circolari.archive',
] as const;

/** Redattore: solo circolari.create (no publish/archive) → 403 su publish. */
export const CIRCOLARI_REDATTORE_CODES = ['circolari.create'] as const;

/**
 * Crea un utente "redattore" circolari nello stesso tenant con SOLO
 * `circolari.create` (no publish). Per il test 403 su POST /:id/publish.
 * Mirror di seedScadenzeViewer.
 */
export async function seedCircolariRedattore(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');
  const { seedAziendePermissions } = await import('./aziende-test-fixtures');

  const userId = uuidv7();
  const email = opts.email ?? 'circolari-redattore@studio.local';
  const password = opts.password ?? 'Redattore123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Redattore', 'Circolari', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }

  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Circolari Redattore',
    codes: [...CIRCOLARI_REDATTORE_CODES],
  });

  return { userId, email, password };
}
