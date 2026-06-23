// =============================================================================
// portale-test-fixtures.ts — E2E helper identità portale cliente (ADR-0046)
// =============================================================================
// Seed di un utente-cliente del portale: azienda + user tipo='cliente' (legato
// all'azienda, cliente_ruolo='admin') + ruolo "Cliente" con il solo permesso
// portale.documenti.visualizza. Riusa seedAziendePermissions per role/permission
// wiring (loginAs/flushTenantSlugCache restano in aziende-test-fixtures).
//
// Setup phase via raw SQL (convenzione E2E ADR-0017 §TD-AW: setup raw SQL,
// assert via API). L'invariante DB chk_cliente_azienda_id (ADR-0046 §2) impone
// azienda_id NOT NULL per i clienti → l'azienda va creata PRIMA dell'utente.
// =============================================================================

export { seedAziendePermissions, loginAs, flushTenantSlugCache } from './aziende-test-fixtures';

/** Permesso cliente-facing del portale (ADR-0046 §6). */
export const PORTALE_CLIENTE_CODES = ['portale.documenti.visualizza'] as const;

export interface ClientePortaleResult {
  userId: string;
  aziendaId: string;
  email: string;
  password: string;
}

/**
 * Crea un'azienda + un utente tipo='cliente' legato ad essa nel tenant dato,
 * con ruolo "Cliente" (portale.documenti.visualizza). Chiamare DOPO seedMinimal.
 */
export async function seedClientePortale(
  databaseUrl: string,
  opts: {
    tenantId: string;
    email?: string;
    password?: string;
    aziendaCodice?: string;
    /** Permessi del ruolo "Cliente" (default: solo portale.documenti.visualizza). */
    codes?: readonly string[];
  },
): Promise<ClientePortaleResult> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');
  const { seedAziendePermissions } = await import('./aziende-test-fixtures');

  const aziendaId = uuidv7();
  const userId = uuidv7();
  const email = opts.email ?? 'cliente@studio.local';
  const password = opts.password ?? 'Cliente123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const codice = opts.aziendaCodice ?? 'AZ-PORT-1';

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // 1. Azienda parent (prima dell'utente: CHECK chk_cliente_azienda_id).
    await client.query(
      `INSERT INTO aziende (id, tenant_id, codice, nome, tipo_cliente, attivo, created_at, updated_at)
       VALUES ($1, $2, $3, 'Azienda Portale S.r.l.', 'azienda', true, NOW(), NOW());`,
      [aziendaId, opts.tenantId, codice],
    );

    // 2. User tipo='cliente' legato all'azienda (cliente_ruolo='admin').
    await client.query(
      `INSERT INTO users
         (id, tenant_id, email, password_hash, first_name, last_name, is_active,
          tipo, azienda_id, cliente_ruolo, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Cliente', 'Portale', true,
          'cliente', $5, 'admin', 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash, aziendaId],
    );
  } finally {
    await client.end();
  }

  // 3. Ruolo "Cliente" tenant-scoped con i permessi portale.* richiesti.
  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Cliente',
    codes: [...(opts.codes ?? PORTALE_CLIENTE_CODES)],
  });

  return { userId, aziendaId, email, password };
}
