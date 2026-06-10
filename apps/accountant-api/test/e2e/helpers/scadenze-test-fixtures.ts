// =============================================================================
// scadenze-test-fixtures.ts — E2E helper dominio scadenze (STOP-scad1)
// =============================================================================
// Riusa l'infra anagrafica: l'admin del modulo ha bisogno SIA di
// anagrafica.cliente.* (per creare l'azienda parent via API per i test
// visibilita='azienda' / filtro aziendaId) SIA di scadenze.* (per gestire le
// scadenze). `seedAziendePermissions` è generico → lo si chiama coi codici
// combinati. createAziendaViaApi riusato da referenti-test-fixtures.
//
// seedScadenzeCategoriePiattaforma: `prisma migrate deploy` (test-containers) NON
// esegue il seed → le categorie piattaforma (tenant_id NULL) non esistono nel DB
// e2e. Le inietta via raw SQL per il test "GET /categorie include piattaforma".
// =============================================================================

export { seedAziendePermissions, loginAs, flushTenantSlugCache } from './aziende-test-fixtures';
export { createAziendaViaApi } from './referenti-test-fixtures';

/** Admin modulo: anagrafica.cliente.* (azienda parent) + scadenze.* (gestione). */
export const SCADENZE_ADMIN_CODES = [
  'anagrafica.cliente.crea',
  'anagrafica.cliente.visualizza',
  'scadenze.visualizza',
  'scadenze.gestisci',
] as const;

/** Viewer: solo letture (scadenze.visualizza, no gestisci) → 403 sul create. */
export const SCADENZE_VIEWER_CODES = ['scadenze.visualizza'] as const;

/**
 * Crea un utente "viewer" scadenze nello stesso tenant con SOLO
 * `scadenze.visualizza` (no `scadenze.gestisci`). Per il test 403 sul create.
 * Mirror di seedPreventiviViewer.
 */
export async function seedScadenzeViewer(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');
  const { seedAziendePermissions } = await import('./aziende-test-fixtures');

  const userId = uuidv7();
  const email = opts.email ?? 'scadenze-viewer@studio.local';
  const password = opts.password ?? 'Viewer123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Viewer', 'Scadenze', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }

  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Scadenze Viewer',
    codes: [...SCADENZE_VIEWER_CODES],
  });

  return { userId, email, password };
}

/** Le 7 categorie piattaforma (tenant_id NULL) replicate dal seed.ts. */
export const SCADENZE_CATEGORIE_PIATTAFORMA = [
  { nome: 'Dichiarativi', colore: '#7c3aed' },
  { nome: 'Versamenti', colore: '#dc2626' },
  { nome: 'Adempimenti', colore: '#0e7490' },
  { nome: 'Bilancio', colore: '#b45309' },
  { nome: 'Lavoro e Paghe', colore: '#15803d' },
  { nome: 'Scadenze CIE/Documenti', colore: '#64748b' },
  { nome: 'Altro', colore: '#94a3b8' },
] as const;

/**
 * Inserisce le categorie piattaforma (tenant_id NULL) via raw SQL. Ritorna l'id
 * della prima ('Dichiarativi') per i test che vi associano una scadenza.
 * Chiamare in beforeEach DOPO truncateDatabase.
 */
export async function seedScadenzeCategoriePiattaforma(databaseUrl: string): Promise<string> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let firstId = '';
  try {
    for (let i = 0; i < SCADENZE_CATEGORIE_PIATTAFORMA.length; i++) {
      const cat = SCADENZE_CATEGORIE_PIATTAFORMA[i];
      const catId = uuidv7();
      if (i === 0) firstId = catId;
      await client.query(
        `INSERT INTO scadenze_categorie (id, tenant_id, nome, colore, ordine, attivo)
         VALUES ($1, NULL, $2, $3, $4, true);`,
        [catId, cat.nome, cat.colore, i],
      );
    }
  } finally {
    await client.end();
  }
  return firstId;
}
