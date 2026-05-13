// =============================================================================
// smoke-rls-e2e.ts — D3b RLS activation: smoke E2E full
// =============================================================================
// Verifica end-to-end che l'enforcement RLS funzioni runtime con:
// - App role `gestionale_app` (NOSUPERUSER, NOBYPASSRLS) come DATABASE_URL
// - Policy reali `<table>_tenant_isolation` con FORCE ROW LEVEL SECURITY
// - Pattern dual-URL Prisma (directUrl per DDL bypass).
//
// Read-only: solo SELECT/count, niente INSERT/UPDATE/DELETE. Idempotente +
// safe per CI futura. Re-run infinito senza side effects sul DB.
//
// 5 scenari mandatory + 2 extra coverage:
//   1. tenant demo isolation:       user.count = 1 (solo admin@demo)
//   2. tenant acme isolation:       user.count = 1 (solo manager@acme)
//   3. cross-tenant block:          demo context -> manager acme = null
//   4. system context visibility:   user.count = 2 (bypass via is_super_admin)
//   5. super admin context:         demo tenantId + super_admin=true -> 2
//
// Extra coverage (defense in depth):
//   6. roles table isolation:       demo context -> role.count = 1
//   7. audit_logs table isolation:  filtro tenant_id su tabella NOT NULL
//
// Esegui da packages/db/:
//   pnpm smoke:rls-e2e
// =============================================================================

import {
  createPrismaClient,
  runInTenantContext,
  withSuperAdminContext,
  withSystemContext,
} from '../src/index';

interface ScenarioResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: ScenarioResult[] = [];

function record(id: string, name: string, pass: boolean, detail: string): void {
  results.push({ id, name, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} [${id}] ${name}`);
  console.log(`     ${detail}`);
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  console.log('=== D3b RLS Smoke E2E (read-only, idempotent) ===\n');

  // -------------------------------------------------------------------------
  // Resolve fixture IDs via system context (bypass RLS)
  // -------------------------------------------------------------------------
  const { demoId, acmeId, managerAcmeId } = await withSystemContext(async () => {
    const demo = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
    const acme = await prisma.tenant.findUnique({ where: { slug: 'acme' } });
    if (!demo || !acme) {
      throw new Error("Tenants 'demo' and 'acme' required. Run: pnpm db:seed");
    }
    const manager = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: acme.id, email: 'manager@acme.local' } },
    });
    if (!manager) throw new Error("User 'manager@acme.local' required. Run: pnpm db:seed");
    return { demoId: demo.id, acmeId: acme.id, managerAcmeId: manager.id };
  });
  console.log(`demoId=${demoId}`);
  console.log(`acmeId=${acmeId}`);
  console.log(`managerAcmeId=${managerAcmeId}\n`);

  // -------------------------------------------------------------------------
  // Scenario 1 — Tenant demo isolation: user.count = 1 (admin@demo only)
  // -------------------------------------------------------------------------
  const demoUserCount = await runInTenantContext({ tenantId: demoId, isSuperAdmin: false }, () =>
    prisma.user.count(),
  );
  record(
    'S1',
    'tenant demo isolation: user.count == 1',
    demoUserCount === 1,
    `user.count from demo context = ${demoUserCount} (expected 1)`,
  );

  // -------------------------------------------------------------------------
  // Scenario 2 — Tenant acme isolation: user.count = 1 (manager@acme only)
  // -------------------------------------------------------------------------
  const acmeUserCount = await runInTenantContext({ tenantId: acmeId, isSuperAdmin: false }, () =>
    prisma.user.count(),
  );
  record(
    'S2',
    'tenant acme isolation: user.count == 1',
    acmeUserCount === 1,
    `user.count from acme context = ${acmeUserCount} (expected 1)`,
  );

  // -------------------------------------------------------------------------
  // Scenario 3 — Cross-tenant block: demo ctx + manager acme UUID -> null
  // -------------------------------------------------------------------------
  const crossLookup = await runInTenantContext({ tenantId: demoId, isSuperAdmin: false }, () =>
    prisma.user.findUnique({ where: { id: managerAcmeId } }),
  );
  record(
    'S3',
    'cross-tenant block: demo ctx + manager acme UUID',
    crossLookup === null,
    `findUnique result = ${crossLookup === null ? 'null' : 'LEAK ' + JSON.stringify(crossLookup)}`,
  );

  // -------------------------------------------------------------------------
  // Scenario 4 — System context visibility: user.count = 2 (bypass)
  // -------------------------------------------------------------------------
  const systemUserCount = await withSystemContext(() => prisma.user.count());
  record(
    'S4',
    'system context visibility: user.count == 2',
    systemUserCount === 2,
    `user.count from withSystemContext = ${systemUserCount} (expected 2)`,
  );

  // -------------------------------------------------------------------------
  // Scenario 5 — Super admin context: demo tenantId + super_admin=true
  //   Vede 2 user (bypass via is_super_admin) anche se tenantId='demo'.
  //   Semantica: super admin operation cross-tenant con audit-trail su demo.
  // -------------------------------------------------------------------------
  const superAdminUserCount = await withSuperAdminContext(demoId, () => prisma.user.count());
  record(
    'S5',
    'super admin context: demo tenantId + super_admin=true -> 2',
    superAdminUserCount === 2,
    `user.count from withSuperAdminContext(demo) = ${superAdminUserCount} (expected 2)`,
  );

  // -------------------------------------------------------------------------
  // Extra S6 — roles table isolation: demo ctx -> role.count = 1
  //   Defense in depth: verifica RLS non solo su users.
  // -------------------------------------------------------------------------
  const demoRoleCount = await runInTenantContext({ tenantId: demoId, isSuperAdmin: false }, () =>
    prisma.role.count(),
  );
  record(
    'S6',
    'roles isolation: demo ctx -> role.count == 1',
    demoRoleCount === 1,
    `role.count from demo context = ${demoRoleCount} (expected 1: Super Admin demo)`,
  );

  // -------------------------------------------------------------------------
  // Extra S7 — audit_logs isolation: tenant filter su tabella NOT NULL tenant_id.
  //   Conta in system (M_total) e in demo ctx (M_demo). Verifica:
  //   (a) M_demo <= M_total (sotto-set)
  //   (b) M_demo == count(system con filtro tenant_id=demoId) (equivalenza)
  // -------------------------------------------------------------------------
  const auditTotalSystem = await withSystemContext(() => prisma.auditLog.count());
  const auditDemoFromSystem = await withSystemContext(() =>
    prisma.auditLog.count({ where: { tenantId: demoId } }),
  );
  const auditDemoFromCtx = await runInTenantContext({ tenantId: demoId, isSuperAdmin: false }, () =>
    prisma.auditLog.count(),
  );
  const s7Pass = auditDemoFromCtx === auditDemoFromSystem && auditDemoFromCtx <= auditTotalSystem;
  record(
    'S7',
    'audit_logs isolation: demo ctx == system filter on tenant_id=demo',
    s7Pass,
    `system_total=${auditTotalSystem}, system_filter_demo=${auditDemoFromSystem}, demo_ctx=${auditDemoFromCtx}`,
  );

  await prisma.$disconnect();

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(
    `\n=== Summary: ${passed}/${total} scenari ${passed === total ? 'PASS' : 'FAIL'} ===`,
  );
  if (passed !== total) {
    console.log('\nFailed scenarios:');
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  [${r.id}] ${r.name} -> ${r.detail}`);
    }
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('\n❌ Smoke E2E failure:', err);
  process.exit(2);
});
