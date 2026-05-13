// =============================================================================
// smoke-soft-delete.ts — Validazione end-to-end della soft-delete extension
// =============================================================================
// Test pragmatico (no Vitest framework yet — vedi ADR-0005 Macro-task B).
// 5 scenari verificano: query injection, escape esplicito, count, forceDelete.
//
// Run:
//   pnpm --filter @gestionale/db smoke:soft-delete
// (lo script wrappa con dotenv-cli per leggere DATABASE_URL dal root .env)
//
// Side effects: crea un tenant `smoke-test`, lo soft-deleta, lo hard-deleta.
// Lo script si autopulisce alla fine; un fallimento intermedio puo' lasciare
// il record in DB — in tal caso eseguirne hard-delete manuale via psql:
//   DELETE FROM tenants WHERE slug='smoke-test';
// =============================================================================

import { id, prisma, withSystemContext } from '../src/index';

const TEST_SLUG = 'smoke-test';
const TEST_NAME = 'Smoke Test Tenant';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    if (detail !== undefined) console.log(`     detail: ${JSON.stringify(detail)}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function cleanupPreviousRun(): Promise<void> {
  // Hard-delete di eventuali residui da run precedenti falliti.
  // Usiamo where esplicito su deletedAt per ignorare soft-delete filter.
  const residuals = await prisma.tenant.findMany({
    where: { slug: TEST_SLUG, deletedAt: { not: undefined } },
  });
  for (const t of residuals) {
    await prisma.tenant.forceDelete({ id: t.id });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== Smoke test: soft-delete extension ===\n');

  await cleanupPreviousRun();

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 1: create + findUnique trova il record
  // ───────────────────────────────────────────────────────────────────────────
  console.log('Scenario 1 — create + findUnique trova il record');
  const tenantId = id();
  await prisma.tenant.create({
    data: { id: tenantId, name: TEST_NAME, slug: TEST_SLUG },
  });
  const found1 = await prisma.tenant.findUnique({ where: { id: tenantId } });
  assert('findUnique trova il tenant appena creato', found1?.id === tenantId);
  assert('deletedAt e null sul tenant fresh', found1?.deletedAt === null);
  console.log('');

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 2: delete -> findUnique ritorna null (soft-delete inject)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('Scenario 2 — delete trasformato in update, findUnique ritorna null');
  await prisma.tenant.delete({ where: { id: tenantId } });
  const found2 = await prisma.tenant.findUnique({ where: { id: tenantId } });
  assert('findUnique ritorna null su tenant soft-deleted', found2 === null);

  // Verifica che la riga ESISTA ancora a livello DB con deletedAt valorizzato
  // (escape esplicito: where include deletedAt -> no injection)
  const found2Raw = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: { not: null } },
  });
  assert(
    "riga ancora in DB con deletedAt != null (verifica e' soft non hard)",
    found2Raw?.id === tenantId && found2Raw?.deletedAt !== null,
  );
  console.log('');

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 3: findMany con escape esplicito (where: { deletedAt: { not: null } })
  // ───────────────────────────────────────────────────────────────────────────
  console.log('Scenario 3 — findMany con escape esplicito trova soft-deleted');
  const trashed = await prisma.tenant.findMany({
    where: { slug: TEST_SLUG, deletedAt: { not: null } },
  });
  assert(
    'findMany del cestino include il record soft-deleted',
    trashed.some((t) => t.id === tenantId),
  );
  console.log('');

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 4: count esclude soft-deleted by default
  // ───────────────────────────────────────────────────────────────────────────
  console.log('Scenario 4 — count esclude soft-deleted by default');
  const countActive = await prisma.tenant.count({ where: { slug: TEST_SLUG } });
  const countAll = await prisma.tenant.count({
    where: { slug: TEST_SLUG, deletedAt: { not: undefined } },
  });
  assert('count default = 0 (record e soft-deleted)', countActive === 0, { countActive });
  assert('count con escape = 1 (vede il soft-deleted)', countAll === 1, { countAll });
  console.log('');

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 5: forceDelete -> hard delete, findMany totale ora vuoto
  // ───────────────────────────────────────────────────────────────────────────
  console.log('Scenario 5 — forceDelete -> hard delete via $executeRawUnsafe');
  const affected = await prisma.tenant.forceDelete({ id: tenantId });
  assert('forceDelete ritorna 1 riga affected', affected === 1, { affected });

  // Verifica hard-delete: niente record con quello slug in DB, escape incluso
  const afterForce = await prisma.tenant.findMany({
    where: { slug: TEST_SLUG, deletedAt: { not: undefined } },
  });
  assert('nessun residuo dopo forceDelete (escape incluso)', afterForce.length === 0, {
    residuals: afterForce.length,
  });
  console.log('');

  // ───────────────────────────────────────────────────────────────────────────
  // Risultato
  // ───────────────────────────────────────────────────────────────────────────
  console.log('=== Risultato ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failed > 0) {
    throw new Error(`${failed} assertion(s) failed`);
  }
  console.log('  🎉 Tutti gli scenari verdi.');
}

// Wrap in system context: RLS framework D3a richiede tenant context per ogni
// query. Smoke gira come ops/script -> system bypass via is_super_admin=true.
withSystemContext(() => main())
  .catch(async (err) => {
    console.error('\n❌ Smoke test failure:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
