// =============================================================================
// catalogo-test-fixtures.ts — E2E helper dominio catalogo servizi (ADR-0050)
// =============================================================================
// Riusa l'infra generica (seedAziendePermissions, loginAs, flushTenantSlugCache).
// L'admin catalogo ha bisogno solo di servizi.* (nessuna azienda).
//
// seedCatalogoPiattaforma: `prisma migrate deploy` (test-containers) NON esegue
// il seed → le righe piattaforma (tenant_id NULL) non esistono nel DB e2e. Le
// inietta via raw SQL: 6 categorie + 20 servizi (come il seed reale, valori
// semplificati: ciò che conta nei test è il conteggio + la visibilità).
// =============================================================================

export { seedAziendePermissions, loginAs, flushTenantSlugCache } from './aziende-test-fixtures';

/** Admin catalogo: gestione completa. */
export const CATALOGO_ADMIN_CODES = ['servizi.visualizza', 'servizi.gestisci'] as const;

/** Viewer: solo lettura → 403 sul create/patch/delete. */
export const CATALOGO_VIEWER_CODES = ['servizi.visualizza'] as const;

/** 6 categorie piattaforma (tenant_id NULL). */
const CATEGORIE_PIATTAFORMA = [
  { nome: 'Contabilità', colore: '#6366f1' },
  { nome: 'Dichiarazioni fiscali', colore: '#f59e0b' },
  { nome: 'Lavoro e paghe', colore: '#10b981' },
  { nome: 'Societario e legale', colore: '#3b82f6' },
  { nome: 'Consulenza', colore: '#8b5cf6' },
  { nome: 'Altro', colore: '#6b7280' },
] as const;

export const CATALOGO_CATEGORIE_PIATTAFORMA_COUNT = CATEGORIE_PIATTAFORMA.length; // 6
export const CATALOGO_SERVIZI_PIATTAFORMA_COUNT = 20;

/**
 * Crea un utente "viewer" catalogo nello stesso tenant con SOLO
 * `servizi.visualizza`. Mirror di seedScadenzeViewer.
 */
export async function seedCatalogoViewer(
  databaseUrl: string,
  opts: { tenantId: string; email?: string; password?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const argon2 = await import('argon2');
  const { seedAziendePermissions } = await import('./aziende-test-fixtures');

  const userId = uuidv7();
  const email = opts.email ?? 'catalogo-viewer@studio.local';
  const password = opts.password ?? 'Viewer123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Viewer', 'Catalogo', true, 0, NOW(), NOW());`,
      [userId, opts.tenantId, email, passwordHash],
    );
  } finally {
    await client.end();
  }

  await seedAziendePermissions(databaseUrl, {
    tenantId: opts.tenantId,
    userId,
    roleName: 'Catalogo Viewer',
    codes: [...CATALOGO_VIEWER_CODES],
  });

  return { userId, email, password };
}

/**
 * Inserisce 6 categorie + 20 servizi piattaforma (tenant_id NULL) via raw SQL.
 * Ritorna l'id della prima categoria e del primo servizio (per i test 403
 * platform-readonly). Chiamare in beforeEach DOPO truncateDatabase.
 */
export async function seedCatalogoPiattaforma(
  databaseUrl: string,
): Promise<{ categoriaId: string; servizioId: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let firstCategoriaId = '';
  let firstServizioId = '';
  try {
    const categoriaIds: string[] = [];
    for (let i = 0; i < CATEGORIE_PIATTAFORMA.length; i++) {
      const cat = CATEGORIE_PIATTAFORMA[i];
      const catId = uuidv7();
      categoriaIds.push(catId);
      if (i === 0) firstCategoriaId = catId;
      await client.query(
        `INSERT INTO servizi_categorie (id, tenant_id, nome, colore, ordine, attivo, created_at, updated_at)
         VALUES ($1, NULL, $2, $3, $4, true, NOW(), NOW());`,
        [catId, cat.nome, cat.colore, i],
      );
    }
    for (let i = 0; i < CATALOGO_SERVIZI_PIATTAFORMA_COUNT; i++) {
      const svcId = uuidv7();
      if (i === 0) firstServizioId = svcId;
      const codice = `SVC-${String(i + 1).padStart(2, '0')}`;
      const categoriaId = categoriaIds[i % categoriaIds.length];
      await client.query(
        `INSERT INTO servizi_catalogo
           (id, tenant_id, codice, nome, categoria_id, unita_misura, prezzo_base, iva_aliquota, tipo_ricorrenza, attivo, ordine, created_at, updated_at)
         VALUES ($1, NULL, $2, $3, $4, 'forfait', 100, 22, 'una_tantum', true, $5, NOW(), NOW());`,
        [svcId, codice, `Servizio piattaforma ${i + 1}`, categoriaId, i],
      );
    }
  } finally {
    await client.end();
  }
  return { categoriaId: firstCategoriaId, servizioId: firstServizioId };
}
