// =============================================================================
// comande-test-fixtures.ts — E2E helper COMANDE (PR-2, ADR-0068)
// =============================================================================
// - seedComandePermissions: assegna i permessi `comande.*` a un utente via
//   permission catalog + role tenant-scoped + user_role. `grant`:
//     'full'   → comande.crea + modifica + elimina + visualizza (operativi)
//     'viewer' → solo comande.visualizza (legge, 403 su POST/PATCH/DELETE)
//   (comande.stato.cambia esiste nel catalog ma è orfano intenzionale → mai grantato)
// - seedComandeData: menu/categoria + 2 articoli + PriceList "Base" (con override
//   solo su articleA) + tavolo. Baseline pricing per esercitare il resolver.
// - insertActivePriceList: 2° listino attivo su un canale → collisione ambiguità.
// Pattern SQL raw modellato su table-test-fixtures / seedMinimal.
// =============================================================================

export const COMANDE_PERMISSION_CODES = [
  'comande.crea',
  'comande.modifica',
  'comande.elimina',
  'comande.visualizza',
  'comande.stato.cambia',
] as const;

export type ComandeGrant = 'full' | 'viewer';

const GRANTED: Record<ComandeGrant, readonly string[]> = {
  // 'full' = tutti i permessi comande OPERATIVI, incluso `comande.stato.cambia`
  // (KDS: transizioni stato comanda). Non più orfano da quando il layer Comanda è
  // attivo (ADR-attivazione-layer-comanda).
  full: [
    'comande.crea',
    'comande.modifica',
    'comande.elimina',
    'comande.visualizza',
    'comande.stato.cambia',
  ],
  viewer: ['comande.visualizza'],
};

export async function seedComandePermissions(
  databaseUrl: string,
  opts: { tenantId: string; userId: string; grant?: ComandeGrant; roleName?: string },
): Promise<{ roleId: string }> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');

  const grant = opts.grant ?? 'full';
  const grantedCodes = GRANTED[grant];
  const roleName = opts.roleName ?? (grant === 'full' ? 'Comande Full' : 'Comande Viewer');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const permIdByCode = new Map<string, string>();
    for (const code of COMANDE_PERMISSION_CODES) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO permissions (id, code, description, category, is_pre_f2)
         VALUES ($1, $2, $3, 'comande', false)
         ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
         RETURNING id;`,
        [uuidv7(), code, `E2E ${code}`],
      );
      const id = res.rows[0]?.id;
      if (!id) throw new Error(`Insert permission failed: ${code}`);
      permIdByCode.set(code, id);
    }

    const roleRes = await client.query<{ id: string }>(
      `INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at)
       VALUES ($1, $2, $3, 'E2E comande role', true, NOW(), NOW())
       ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL
         DO UPDATE SET description = EXCLUDED.description
       RETURNING id;`,
      [uuidv7(), opts.tenantId, roleName],
    );
    const roleId = roleRes.rows[0]?.id;
    if (!roleId) throw new Error('Insert role failed');

    for (const code of grantedCodes) {
      const permId = permIdByCode.get(code);
      if (!permId) continue;
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        [roleId, permId],
      );
    }

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

export interface ComandeData {
  menuId: string;
  categoryId: string;
  articleAId: string; // basePrice 10.00, override 8.00 nel listino Base, reparto cucina
  articleBId: string; // basePrice 5.00, NESSUN override → fallback basePrice, reparto bar
  priceListId: string; // "Base", attivo, tutti i canali
  tavoloId: string;
}

export async function seedComandeData(
  databaseUrl: string,
  opts: { tenantId: string },
): Promise<ComandeData> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const t = opts.tenantId;

  const menuId = uuidv7();
  const categoryId = uuidv7();
  const articleAId = uuidv7();
  const articleBId = uuidv7();
  const priceListId = uuidv7();
  const tavoloId = uuidv7();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO menus (id, tenant_id, name, is_active, sort_order, created_at, updated_at)
       VALUES ($1, $2, 'Menu E2E', true, 0, NOW(), NOW());`,
      [menuId, t],
    );
    await client.query(
      `INSERT INTO menu_categories (id, tenant_id, menu_id, name, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, 'Primi', 0, NOW(), NOW());`,
      [categoryId, t, menuId],
    );
    await client.query(
      `INSERT INTO articles (id, tenant_id, category_id, name, description_short, base_price, vat_percent, print_department, created_at, updated_at)
       VALUES ($1, $2, $3, 'Spaghetti', 'Al pomodoro', 10.00, 10, $4::"print_department", NOW(), NOW());`,
      [articleAId, t, categoryId, 'cucina'],
    );
    await client.query(
      `INSERT INTO articles (id, tenant_id, category_id, name, description_short, base_price, vat_percent, print_department, created_at, updated_at)
       VALUES ($1, $2, $3, 'Birra', 'Media', 5.00, 22, $4::"print_department", NOW(), NOW());`,
      [articleBId, t, categoryId, 'bar'],
    );
    await client.query(
      `INSERT INTO price_lists (id, tenant_id, name, channels, priority, is_active, created_at, updated_at)
       VALUES ($1, $2, 'Base', ARRAY['cassa','menu_online','asporto','delivery']::"channel"[], 0, true, NOW(), NOW());`,
      [priceListId, t],
    );
    // override solo per articleA nel listino Base: 8.00 (< basePrice 10.00)
    await client.query(
      `INSERT INTO article_prices (id, tenant_id, article_id, price_list_id, price, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 8.00, NOW(), NOW());`,
      [uuidv7(), t, articleAId, priceListId],
    );
    await client.query(
      `INSERT INTO tavoli (id, tenant_id, numero, capienza, pos_x, pos_y, created_at, updated_at)
       VALUES ($1, $2, 'T1', 4, 0, 0, NOW(), NOW());`,
      [tavoloId, t],
    );

    return { menuId, categoryId, articleAId, articleBId, priceListId, tavoloId };
  } finally {
    await client.end();
  }
}

/** Inserisce un ulteriore PriceList ATTIVO che copre `channels` (per test ambiguità). */
export async function insertActivePriceList(
  databaseUrl: string,
  opts: { tenantId: string; name: string; channels: string[] },
): Promise<string> {
  const { Client } = await import('pg');
  const { uuidv7 } = await import('uuidv7');
  const priceListId = uuidv7();
  const channelsLiteral = `ARRAY[${opts.channels.map((c) => `'${c}'`).join(',')}]::"channel"[]`;

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO price_lists (id, tenant_id, name, channels, priority, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, ${channelsLiteral}, 0, true, NOW(), NOW());`,
      [priceListId, opts.tenantId, opts.name],
    );
    return priceListId;
  } finally {
    await client.end();
  }
}
