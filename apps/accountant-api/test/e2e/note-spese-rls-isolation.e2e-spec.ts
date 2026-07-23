// =============================================================================
// note-spese-rls-isolation.e2e-spec.ts — RLS DB-level Note Spese (PR-1)
// =============================================================================
// Nel gate `test:e2e:rls` (accountant). Asserisce l'isolamento tenant DB-level
// delle tabelle Note Spese (`note_spese`, `note_spese_allegati`) come ruolo
// `gestionale_app` (NOSUPERUSER/NOBYPASSRLS).
//
// **Solo raw-query** (nessun HTTP): PR-1 non ha service/endpoint, e comunque il
// gate deve esercitare la POLICY, non il filtro applicativo. Discovery PR-0: i
// test HTTP restano verdi anche con RLS bypassata (protetti da `where:{tenantId}`).
// Qui ogni assert gira raw come `gestionale_app` con `app.tenant_id` settato →
// esercita SOLO la policy DB. Setup via superuser (bypassa RLS per seedare
// cross-tenant); assert via app-role.
//
// Copertura: lettura + scrittura cross-tenant, su ENTRAMBE le tabelle.
// =============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';
import { seedMinimal, seedSecondTenant, truncateDatabase } from './helpers/test-app';

const APP_ROLE = 'gestionale_app';
// DP-3 hardening (allineato al gate): pw da env, default placeholder Testcontainers.
const APP_ROLE_PASSWORD = process.env.TEST_APP_ROLE_PASSWORD ?? 'PLACEHOLDER_MUST_BE_ROTATED';

function toAppRoleUrl(superuserUrl: string): string {
  const u = new URL(superuserUrl);
  u.username = APP_ROLE;
  u.password = APP_ROLE_PASSWORD;
  return u.toString();
}

/** Query raw come `gestionale_app` con contesto tenant (esercita la policy DB). */
async function asAppRole<T extends Record<string, unknown>>(
  superuserUrl: string,
  tenantId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: T[] }> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: toAppRoleUrl(superuserUrl) });
  await client.connect();
  try {
    if (tenantId !== null) {
      await client.query(`SET app.tenant_id = '${tenantId}'`);
      await client.query(`SET app.is_super_admin = 'false'`);
    }
    const res = await client.query<T>(sql, params);
    return { rows: res.rows };
  } finally {
    await client.end();
  }
}

/** Setup via superuser (bypassa RLS): inserisce una nota + un allegato per un tenant. */
async function seedNotaSpesa(
  superuserUrl: string,
  args: { notaId: string; allegatoId: string; tenantId: string; userId: string },
): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO note_spese
         (id, tenant_id, user_id, data, tipo_spesa, metodo_pagamento, totale,
          aliquota_iva, deducibilita_fiscale, scopo_missione, updated_at)
       VALUES ($1, $2, $3, CURRENT_DATE, 'vitto', 'contanti', 12.50,
          'iva_10', 'd_100', 'Trasferta test', NOW())`,
      [args.notaId, args.tenantId, args.userId],
    );
    await client.query(
      `INSERT INTO note_spese_allegati
         (id, tenant_id, nota_spesa_id, tipo, storage_key, nome_originale, mime_type, dimensione)
       VALUES ($1, $2, $3, 'giustificativo', 'k/opaque', 'ricevuta.pdf', 'application/pdf', 1024)`,
      [args.allegatoId, args.tenantId, args.notaId],
    );
  } finally {
    await client.end();
  }
}

describe('Note Spese RLS isolation E2E — DB-level come gestionale_app (PR-1)', () => {
  let containers: TestContainers;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let notaAId: string;
  let notaBId: string;

  beforeAll(async () => {
    containers = await startTestContainers();
  });

  afterAll(async () => {
    await stopTestContainers(containers);
  });

  beforeEach(async () => {
    // truncate CASCADE su tenants → pulisce anche note_spese (FK→tenants).
    await truncateDatabase(containers.databaseUrl);
    const A = await seedMinimal(containers.databaseUrl); // tenant A + admin A
    const B = await seedSecondTenant(containers.databaseUrl); // tenant B + admin B
    tenantAId = A.tenantId;
    tenantBId = B.tenantId;
    userAId = A.adminUserId;

    notaAId = crypto.randomUUID();
    notaBId = crypto.randomUUID();
    await seedNotaSpesa(containers.databaseUrl, {
      notaId: notaAId,
      allegatoId: crypto.randomUUID(),
      tenantId: tenantAId,
      userId: A.adminUserId,
    });
    await seedNotaSpesa(containers.databaseUrl, {
      notaId: notaBId,
      allegatoId: crypto.randomUUID(),
      tenantId: tenantBId,
      userId: B.adminUserId,
    });
  });

  it('S0 — la connessione è gestionale_app (NOSUPERUSER/NOBYPASSRLS)', async () => {
    const { rows } = await asAppRole<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      containers.databaseUrl,
      null,
      `SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows[0]?.current_user).toBe(APP_ROLE);
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('S1 — READ note_spese: tenant A vede solo le proprie (non quelle di B)', async () => {
    const { rows } = await asAppRole<{ id: string }>(
      containers.databaseUrl,
      tenantAId,
      `SELECT id FROM note_spese`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(notaAId);
    expect(rows.find((r) => r.id === notaBId)).toBeUndefined();
  });

  it('S2 — READ note_spese_allegati: tenant A vede solo i propri (DB-level)', async () => {
    const { rows } = await asAppRole<{ count: string }>(
      containers.databaseUrl,
      tenantAId,
      `SELECT count(*)::int AS count FROM note_spese_allegati`,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('S3 — WRITE note_spese: tenant A NON può inserire una riga con tenant_id=B (RLS blocca)', async () => {
    await expect(
      asAppRole(
        containers.databaseUrl,
        tenantAId,
        `INSERT INTO note_spese
           (id, tenant_id, user_id, data, tipo_spesa, metodo_pagamento, totale,
            aliquota_iva, deducibilita_fiscale, scopo_missione, updated_at)
         VALUES ($1, $2, $3, CURRENT_DATE, 'vitto', 'contanti', 5.00,
            'iva_22', 'd_100', 'leak', NOW())`,
        [crypto.randomUUID(), tenantBId, userAId],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('S4 — WRITE note_spese_allegati: tenant A NON può inserire con tenant_id=B (RLS blocca)', async () => {
    await expect(
      asAppRole(
        containers.databaseUrl,
        tenantAId,
        `INSERT INTO note_spese_allegati
           (id, tenant_id, nota_spesa_id, tipo, storage_key, nome_originale, mime_type, dimensione)
         VALUES ($1, $2, $3, 'scontrino_pos', 'k/leak', 'x.pdf', 'application/pdf', 1)`,
        [crypto.randomUUID(), tenantBId, notaBId],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
