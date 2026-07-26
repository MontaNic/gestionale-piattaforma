// =============================================================================
// conti-rls-isolation.e2e-spec.ts (PR-1 blocco COMANDE, ADR-0067) — RLS + soft-delete
// =============================================================================
// PR-1 è SOLO fondamenta dati: nessun endpoint conti esiste ancora (→ PR-2). Il
// GATE verde della migration NON prova l'isolamento — serve un test che lo
// ESERCITA e fallisce chiuso. Questo spec lo fa al layer DB (Prisma extension
// RLS), non via HTTP, bootando un client come ruolo `gestionale_app`
// (NOSUPERUSER, NOBYPASSRLS) → RLS FORCE realmente enforced (gli altri spec E2E
// girano come superuser `postgres` e bypasserebbero la policy).
//
// Copertura:
//   1. RLS read isolation  — tenant B non LEGGE i Conto/ContoRiga di A (fail closed)
//   2. RLS write isolation — tenant B non MODIFICA la riga di A (P2025, no mutation);
//                            insert cross-tenant (tenantId=A da ctx B) bloccato
//   3. Soft-delete invisibility (CHECK-BE-2) — Conto/riga soft-deleted spariscono
//      dalle query normali ma restano fisicamente (deleted_at valorizzato)
//   4. Snapshot pricing (DP-C) — nomeArticolo/prezzoUnitario/reparto della riga
//      sono colonne indipendenti: modificare l'Article sorgente NON li tocca
//   5. RLS su `pagamenti` (Cassa pre-fiscale, ADR-0081) — read + write isolation
//      sulla policy `pagamenti_tenant_isolation`
// =============================================================================

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaClient,
  runInTenantContext,
  id,
  Channel,
  MetodoPagamentoConto,
  PrintDepartment,
  type ExtendedPrismaClient,
} from '@gestionale/db';

import { seedMinimal, seedSecondTenant, truncateDatabase } from './helpers/test-app';
import {
  startTestContainers,
  stopTestContainers,
  type TestContainers,
} from './helpers/test-containers';

// `gestionale_app`: ruolo runtime non-superuser (migration create_app_role_and_grants),
// password placeholder nei Testcontainers (rotazione solo dev/prod). Identico a
// soft-delete-rls.e2e-spec.ts.
const APP_ROLE = 'gestionale_app';
// DP-3 hardening: pw da env, default = placeholder dei Testcontainers non-ruotati.
// Se un domani il substrato ruota la pw dell'app-role, basta TEST_APP_ROLE_PASSWORD.
const APP_ROLE_PASSWORD = process.env.TEST_APP_ROLE_PASSWORD ?? 'PLACEHOLDER_MUST_BE_ROTATED';

function toAppRoleUrl(superuserUrl: string): string {
  const u = new URL(superuserUrl);
  u.username = APP_ROLE;
  u.password = APP_ROLE_PASSWORD;
  return u.toString();
}

/** Conta righe fisiche via superuser + SQL raw (bypassa RLS e soft-delete extension). */
async function rawCount(superuserUrl: string, sql: string): Promise<number> {
  const client = new Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    const res = await client.query(sql);
    return Number(res.rows[0].count);
  } finally {
    await client.end();
  }
}

/** Crea Menu→Categoria→Articolo + Conto + ContoRiga per un tenant (nel suo context). */
async function seedContoFor(
  prisma: ExtendedPrismaClient,
  tenantId: string,
): Promise<{ articleId: string; contoId: string; rigaId: string; pagamentoId: string }> {
  return runInTenantContext({ tenantId, isSuperAdmin: false }, async () => {
    const menu = await prisma.menu.create({ data: { id: id(), tenantId, name: 'Menu Test' } });
    const category = await prisma.menuCategory.create({
      data: { id: id(), tenantId, menuId: menu.id, name: 'Primi' },
    });
    const article = await prisma.article.create({
      data: {
        id: id(),
        tenantId,
        categoryId: category.id,
        name: 'Spaghetti',
        descriptionShort: 'Al pomodoro',
        basePrice: 8.5,
        vatPercent: 10,
        printDepartment: PrintDepartment.cucina,
        allergens: [],
        dietaryTags: [],
        channelVisibility: [],
      },
    });
    const conto = await prisma.conto.create({
      data: { id: id(), tenantId, channel: Channel.cassa, coperti: 4 },
    });
    const riga = await prisma.contoRiga.create({
      data: {
        id: id(),
        tenantId,
        contoId: conto.id,
        articleId: article.id,
        nomeArticolo: article.name,
        prezzoUnitario: 8.5,
        vatPercent: article.vatPercent, // #161 ADR-0070: snapshot required, no default (bit-rot fix)
        quantita: 2,
        reparto: article.printDepartment,
      },
    });
    // Pagamento sul conto (Cassa pre-fiscale, ADR-0081): la tabella `pagamenti` è
    // tenant-scoped con RLS FORCE come conti/conti_righe → va esercitata qui.
    const pagamento = await prisma.pagamento.create({
      data: {
        id: id(),
        tenantId,
        contoId: conto.id,
        metodo: MetodoPagamentoConto.contanti,
        importo: 17,
      },
    });
    return {
      articleId: article.id,
      contoId: conto.id,
      rigaId: riga.id,
      pagamentoId: pagamento.id,
    };
  });
}

describe('Conti RLS isolation + soft-delete E2E — layer DB come gestionale_app (ADR-0067)', () => {
  let containers: TestContainers;
  let prisma: ExtendedPrismaClient;
  let demoTenantId: string;
  let acmeTenantId: string;
  let demo: { articleId: string; contoId: string; rigaId: string; pagamentoId: string };

  beforeAll(async () => {
    containers = await startTestContainers();
    // Client bootato come ruolo app non-superuser → RLS FORCE enforced.
    process.env.DATABASE_URL = toAppRoleUrl(containers.databaseUrl);
    prisma = createPrismaClient();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopTestContainers(containers);
  });

  beforeEach(async () => {
    await truncateDatabase(containers.databaseUrl);
    const demoSeed = await seedMinimal(containers.databaseUrl);
    const acmeSeed = await seedSecondTenant(containers.databaseUrl);
    demoTenantId = demoSeed.tenantId;
    acmeTenantId = acmeSeed.tenantId;
    demo = await seedContoFor(prisma, demoTenantId);
  });

  // ---------------------------------------------------------------------------
  // 1. RLS READ isolation — fail closed
  // ---------------------------------------------------------------------------
  it('1a. tenant acme NON legge i Conto di demo (findMany isolato)', async () => {
    const contiAcme = await runInTenantContext(
      { tenantId: acmeTenantId, isSuperAdmin: false },
      () => prisma.conto.findMany(),
    );
    expect(contiAcme.find((c) => c.id === demo.contoId)).toBeUndefined();
    expect(contiAcme).toHaveLength(0);
  });

  it('1b. tenant acme NON legge il Conto di demo per id (findUnique → null)', async () => {
    const found = await runInTenantContext({ tenantId: acmeTenantId, isSuperAdmin: false }, () =>
      prisma.conto.findUnique({ where: { id: demo.contoId } }),
    );
    expect(found).toBeNull();
  });

  it('1c. tenant acme NON legge le ContoRiga di demo (findMany isolato)', async () => {
    const righeAcme = await runInTenantContext(
      { tenantId: acmeTenantId, isSuperAdmin: false },
      () => prisma.contoRiga.findMany(),
    );
    expect(righeAcme.find((r) => r.id === demo.rigaId)).toBeUndefined();
    expect(righeAcme).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 2. RLS WRITE isolation — fail closed
  // ---------------------------------------------------------------------------
  it('2a. tenant acme NON modifica il Conto di demo (update → P2025, riga demo intatta)', async () => {
    await expect(
      runInTenantContext({ tenantId: acmeTenantId, isSuperAdmin: false }, () =>
        prisma.conto.update({ where: { id: demo.contoId }, data: { stato: 'chiuso' } }),
      ),
    ).rejects.toThrow();

    // demo vede ancora il suo conto 'aperto': nessuna mutazione cross-tenant.
    const contoDemo = await runInTenantContext(
      { tenantId: demoTenantId, isSuperAdmin: false },
      () => prisma.conto.findUnique({ where: { id: demo.contoId } }),
    );
    expect(contoDemo?.stato).toBe('aperto');
  });

  it('2b. tenant acme NON crea un Conto con tenantId=demo (WITH CHECK RLS blocca)', async () => {
    await expect(
      runInTenantContext({ tenantId: acmeTenantId, isSuperAdmin: false }, () =>
        prisma.conto.create({
          data: { id: id(), tenantId: demoTenantId, channel: Channel.asporto },
        }),
      ),
    ).rejects.toThrow();

    // Nessuna riga spuria comparsa nel tenant demo.
    const total = await rawCount(
      containers.databaseUrl,
      `SELECT count(*)::int AS count FROM conti WHERE tenant_id = '${demoTenantId}'`,
    );
    expect(total).toBe(1); // solo quello seedato in beforeEach
  });

  // ---------------------------------------------------------------------------
  // 3. Soft-delete invisibility (CHECK-BE-2)
  // ---------------------------------------------------------------------------
  // NB: si valorizza `deletedAt` via update() — NON via `.delete()`. Sotto RLS
  // non-superuser il rewrite delete→update della softDeleteExtension gira su un
  // delegate FUORI dalla tx RLS per-operazione → la riga è RLS-hidden → P2025
  // (caveat ADR-0021). Il path corretto di soft-delete è `withTenantContextAtomicTx`
  // + `tx.update({ deletedAt })`, che vive nel service → PR-2. Qui PR-1 verifica
  // la PROPRIETÀ di invisibilità data la colonna `deletedAt` (ciò che chiede
  // CHECK-BE-2), indipendente dal wrapper di servizio.
  it('3a. Conto soft-deleted sparisce dalle query normali ma resta fisicamente', async () => {
    await runInTenantContext({ tenantId: demoTenantId, isSuperAdmin: false }, () =>
      prisma.conto.update({ where: { id: demo.contoId }, data: { deletedAt: new Date() } }),
    );

    const visibili = await runInTenantContext({ tenantId: demoTenantId, isSuperAdmin: false }, () =>
      prisma.conto.findMany(),
    );
    expect(visibili.find((c) => c.id === demo.contoId)).toBeUndefined();

    // Fisicamente presente con deleted_at valorizzato (soft, non hard delete).
    const soft = await rawCount(
      containers.databaseUrl,
      `SELECT count(*)::int AS count FROM conti WHERE id = '${demo.contoId}' AND deleted_at IS NOT NULL`,
    );
    expect(soft).toBe(1);
  });

  it('3b. ContoRiga soft-deleted sparisce dalle query normali ma resta fisicamente', async () => {
    await runInTenantContext({ tenantId: demoTenantId, isSuperAdmin: false }, () =>
      prisma.contoRiga.update({ where: { id: demo.rigaId }, data: { deletedAt: new Date() } }),
    );

    const visibili = await runInTenantContext({ tenantId: demoTenantId, isSuperAdmin: false }, () =>
      prisma.contoRiga.findMany(),
    );
    expect(visibili.find((r) => r.id === demo.rigaId)).toBeUndefined();

    const soft = await rawCount(
      containers.databaseUrl,
      `SELECT count(*)::int AS count FROM conti_righe WHERE id = '${demo.rigaId}' AND deleted_at IS NOT NULL`,
    );
    expect(soft).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 4. Snapshot pricing (DP-C) — colonne indipendenti, no derivazione live
  // ---------------------------------------------------------------------------
  it('4. modificare l Article sorgente NON altera lo snapshot della ContoRiga', async () => {
    await runInTenantContext({ tenantId: demoTenantId, isSuperAdmin: false }, () =>
      prisma.article.update({
        where: { id: demo.articleId },
        data: {
          name: 'Spaghetti RINOMINATO',
          basePrice: 99.99,
          printDepartment: PrintDepartment.bar,
        },
      }),
    );

    const riga = await runInTenantContext({ tenantId: demoTenantId, isSuperAdmin: false }, () =>
      prisma.contoRiga.findUniqueOrThrow({ where: { id: demo.rigaId } }),
    );
    expect(riga.nomeArticolo).toBe('Spaghetti'); // snapshot congelato
    expect(Number(riga.prezzoUnitario)).toBe(8.5); // snapshot congelato
    expect(riga.reparto).toBe(PrintDepartment.cucina); // snapshot congelato
  });

  // ---------------------------------------------------------------------------
  // 5. RLS su `pagamenti` (Cassa pre-fiscale, ADR-0081)
  // ---------------------------------------------------------------------------
  // La policy `pagamenti_tenant_isolation` è nuova: va esercitata come
  // `gestionale_app` (non-superuser) o il FORCE non prova nulla. `pagamenti` NON
  // ha `deletedAt` (storno via `stornato`) → nessun test di soft-delete qui.
  it('5a. tenant acme NON legge i Pagamento di demo (findMany + findUnique isolati)', async () => {
    const pagamentiAcme = await runInTenantContext(
      { tenantId: acmeTenantId, isSuperAdmin: false },
      () => prisma.pagamento.findMany(),
    );
    expect(pagamentiAcme.find((p) => p.id === demo.pagamentoId)).toBeUndefined();
    expect(pagamentiAcme).toHaveLength(0);

    const found = await runInTenantContext({ tenantId: acmeTenantId, isSuperAdmin: false }, () =>
      prisma.pagamento.findUnique({ where: { id: demo.pagamentoId } }),
    );
    expect(found).toBeNull();

    // …mentre demo lo vede: il fail-closed non è un falso negativo generale.
    const pagamentiDemo = await runInTenantContext(
      { tenantId: demoTenantId, isSuperAdmin: false },
      () => prisma.pagamento.findMany(),
    );
    expect(pagamentiDemo.map((p) => p.id)).toEqual([demo.pagamentoId]);
  });

  it('5b. tenant acme NON storna il Pagamento di demo (update → throw, riga intatta)', async () => {
    await expect(
      runInTenantContext({ tenantId: acmeTenantId, isSuperAdmin: false }, () =>
        prisma.pagamento.update({
          where: { id: demo.pagamentoId },
          data: { stornato: true, stornatoIl: new Date() },
        }),
      ),
    ).rejects.toThrow();

    const pagamentoDemo = await runInTenantContext(
      { tenantId: demoTenantId, isSuperAdmin: false },
      () => prisma.pagamento.findUnique({ where: { id: demo.pagamentoId } }),
    );
    expect(pagamentoDemo?.stornato).toBe(false);
  });

  it('5c. tenant acme NON crea un Pagamento con tenantId=demo (WITH CHECK RLS blocca)', async () => {
    await expect(
      runInTenantContext({ tenantId: acmeTenantId, isSuperAdmin: false }, () =>
        prisma.pagamento.create({
          data: {
            id: id(),
            tenantId: demoTenantId,
            contoId: demo.contoId,
            metodo: MetodoPagamentoConto.carta,
            importo: 1,
          },
        }),
      ),
    ).rejects.toThrow();

    const total = await rawCount(
      containers.databaseUrl,
      `SELECT count(*)::int AS count FROM pagamenti WHERE tenant_id = '${demoTenantId}'`,
    );
    expect(total).toBe(1); // solo quello seedato in beforeEach
  });
});
