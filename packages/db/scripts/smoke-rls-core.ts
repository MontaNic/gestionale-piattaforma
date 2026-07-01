// =============================================================================
// smoke-rls-core.ts — Prerequisito passo 8 (ADR-0027 §D4 / ADR-0026 §D5)
// =============================================================================
// Test RLS DB-level **core-only** che gira come `gestionale_app` (NOSUPERUSER,
// NOBYPASSRLS) — l'unica connessione che esercita davvero la RLS (il superuser
// `postgres` la bypassa anche con FORCE). Chiude la blind spot ADR-0026 §D5:
// i 56 e2e Testcontainers girano da superuser e NON testano l'enforcement DB.
//
// Scope: SOLO tabelle core multi-tenant (tenants, sedi, users, roles,
// user_roles, audit_logs). Nessuna tabella di dominio (menu/articoli/...).
//
// Non-distruttivo: read sui dati del seed (demo + acme) + write-block
// (insert cross-tenant DEVE essere respinto → non persiste). Idempotente:
// re-run infinito senza side-effect (sul PASS path nessuna riga scritta).
// Safe da girare in CI subito dopo `db:seed`, prima del Playwright.
//
// Connessione: `createPrismaClient()` legge `DATABASE_URL` dall'ambiente. In CI
// (job e2e-playwright) e in dev è il role `gestionale_app` (post-rotate / init
// docker). Eseguire da packages/db/:  pnpm smoke:rls-core
//
// Exit: 0 = tutti PASS; 1 = almeno uno FAIL (gap RLS o regressione policy);
// 2 = errore inatteso (setup/connessione). Uno step CI che fallisce qui è il
// comportamento voluto: segnala una falla di isolamento reale.
// =============================================================================

import {
  createPrismaClient,
  id,
  runInTenantContext,
  withSuperAdminContext,
  withSystemContext,
  RlsNoContextError,
} from '../src/index';

interface ScenarioResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: ScenarioResult[] = [];

function record(scenarioId: string, name: string, pass: boolean, detail: string): void {
  results.push({ id: scenarioId, name, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} [${scenarioId}] ${name}`);
  console.log(`     ${detail}`);
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  console.log('=== RLS core-only enforcement (gestionale_app non-superuser) ===\n');

  // ---------------------------------------------------------------------------
  // Resolve fixture IDs via system context (bypass RLS, lettura cross-tenant)
  // ---------------------------------------------------------------------------
  const { demoId, acmeId, acmeUserId } = await withSystemContext(async () => {
    const demo = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
    const acme = await prisma.tenant.findUnique({ where: { slug: 'acme' } });
    if (!demo || !acme) {
      throw new Error(
        "Tenants 'demo' e 'acme' richiesti. Esegui: pnpm --filter @gestionale/db db:seed",
      );
    }
    const acmeUser = await prisma.user.findFirst({ where: { tenantId: acme.id } });
    if (!acmeUser) throw new Error("Almeno un user per tenant 'acme' richiesto (db:seed).");
    return { demoId: demo.id, acmeId: acme.id, acmeUserId: acmeUser.id };
  });
  console.log(`demoId=${demoId}`);
  console.log(`acmeId=${acmeId}\n`);

  // ---------------------------------------------------------------------------
  // S0 — Identità connessione (preludio): la query gira FUORI da ogni contesto
  //   RLS (raw query → pass-through dell'extension, no fail-fast). Asserisce che
  //   la connessione è davvero `gestionale_app` NOSUPERUSER/NOBYPASSRLS: se
  //   l'env puntasse al superuser, l'intero test sarebbe cieco (RLS bypassata) e
  //   tutti i PASS sotto sarebbero falsi positivi. Il FAIL spiega da sé il problema.
  // ---------------------------------------------------------------------------
  const identityRows = await prisma.$queryRaw<
    Array<{ db_user: string; is_super: boolean; bypass_rls: boolean }>
  >`SELECT current_user AS db_user,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls`;
  const identity = identityRows[0];
  record(
    'S0',
    "identità connessione: current_user == 'gestionale_app', NOSUPERUSER, NOBYPASSRLS",
    identity?.db_user === 'gestionale_app' &&
      identity?.is_super === false &&
      identity?.bypass_rls === false,
    `current_user=${identity?.db_user}, is_super=${identity?.is_super}, bypass_rls=${identity?.bypass_rls} (atteso gestionale_app/false/false — altrimenti l'env punta al ruolo sbagliato e il test è cieco)`,
  );

  // ---------------------------------------------------------------------------
  // S1 — Read isolation (demo): tabelle core ritornano SOLO righe demo
  // ---------------------------------------------------------------------------
  const demo = await runInTenantContext({ tenantId: demoId, isSuperAdmin: false }, async () => ({
    tenants: await prisma.tenant.count(),
    sedi: await prisma.sede.count(),
    users: await prisma.user.count(),
    roles: await prisma.role.count(),
    userRoles: await prisma.userRole.count(),
  }));
  // Conteggi attesi = righe possedute dal solo tenant demo. Il tenant demo seeda
  // 1 sede + 2 utenti (admin@demo.local Super Admin + direzione@demo.local
  // Direzione, ADR-0064) + 2 ruoli tenant-scoped + 2 user_roles. Un eventuale
  // leak da acme spingerebbe i conteggi OLTRE questi valori → l'uguaglianza
  // esatta resta un rilevatore di leak (non solo un check di seed).
  record(
    'S1',
    'read isolation demo: tenants=1/sedi=1/users=2/roles=2, nessun leak acme',
    demo.tenants === 1 &&
      demo.sedi === 1 &&
      demo.users === 2 &&
      demo.roles === 2 &&
      demo.userRoles === 2,
    `demo ctx counts = ${JSON.stringify(demo)} (atteso tenants=1/sedi=1/users=2/roles=2/userRoles=2)`,
  );

  // ---------------------------------------------------------------------------
  // S2 — Read isolation (acme): speculare
  // ---------------------------------------------------------------------------
  const acme = await runInTenantContext({ tenantId: acmeId, isSuperAdmin: false }, async () => ({
    tenants: await prisma.tenant.count(),
    users: await prisma.user.count(),
  }));
  record(
    'S2',
    'read isolation acme: tenants/users == 1',
    acme.tenants === 1 && acme.users === 1,
    `acme ctx counts = ${JSON.stringify(acme)} (atteso 1/1)`,
  );

  // ---------------------------------------------------------------------------
  // S3 — Cross-tenant block (read): demo ctx + UUID acme -> null
  // ---------------------------------------------------------------------------
  const cross = await runInTenantContext({ tenantId: demoId, isSuperAdmin: false }, async () => ({
    user: await prisma.user.findUnique({ where: { id: acmeUserId } }),
    tenant: await prisma.tenant.findUnique({ where: { id: acmeId } }),
  }));
  record(
    'S3',
    'cross-tenant block (read): demo ctx -> acme user/tenant = null',
    cross.user === null && cross.tenant === null,
    `user=${cross.user === null ? 'null' : 'LEAK'}, tenant=${cross.tenant === null ? 'null' : 'LEAK'}`,
  );

  // ---------------------------------------------------------------------------
  // S4 — Write-block cross-tenant (users): demo ctx, INSERT tenant_id=acme
  //   DEVE essere respinto (WITH CHECK). Insert fallito = non persiste.
  // ---------------------------------------------------------------------------
  let s4Blocked = false;
  let s4Detail = '';
  try {
    await runInTenantContext({ tenantId: demoId, isSuperAdmin: false }, () =>
      prisma.user.create({
        data: {
          id: id(),
          tenantId: acmeId, // cross-tenant: deve violare WITH CHECK
          email: `rls-writeblock-${Date.now()}@invalid.local`,
          passwordHash: 'x',
          firstName: 'RLS',
          lastName: 'WriteBlock',
        },
      }),
    );
    s4Detail = 'INSERT cross-tenant NON bloccato (riga acme creata da demo ctx) — GAP';
  } catch (err) {
    s4Blocked = true;
    s4Detail = `INSERT respinto come atteso: ${(err as Error).message.split('\n')[0]}`;
  }
  record(
    'S4',
    'write-block cross-tenant (users): demo ctx + tenant_id=acme respinto',
    s4Blocked,
    s4Detail,
  );

  // ---------------------------------------------------------------------------
  // S5 — Write-block cross-tenant (audit_logs): stesso pattern su tabella core
  //   non pre-popolata dal seed.
  // ---------------------------------------------------------------------------
  let s5Blocked = false;
  let s5Detail = '';
  try {
    await runInTenantContext({ tenantId: demoId, isSuperAdmin: false }, () =>
      prisma.auditLog.create({
        data: { id: id(), tenantId: acmeId, action: 'rls.smoke.writeblock' },
      }),
    );
    s5Detail = 'INSERT cross-tenant NON bloccato (audit_log acme creato da demo ctx) — GAP';
  } catch (err) {
    s5Blocked = true;
    s5Detail = `INSERT respinto come atteso: ${(err as Error).message.split('\n')[0]}`;
  }
  record(
    'S5',
    'write-block cross-tenant (audit_logs): demo ctx + tenant_id=acme respinto',
    s5Blocked,
    s5Detail,
  );

  // ---------------------------------------------------------------------------
  // S6 — System context bypass: vede entrambi i tenant
  // ---------------------------------------------------------------------------
  const sys = await withSystemContext(async () => ({
    tenants: await prisma.tenant.count(),
    users: await prisma.user.count(),
  }));
  record(
    'S6',
    'system context bypass: tenants/users >= 2 (entrambi i tenant)',
    sys.tenants >= 2 && sys.users >= 2,
    `system ctx counts = ${JSON.stringify(sys)} (atteso >= 2/2)`,
  );

  // ---------------------------------------------------------------------------
  // S7 — Super-admin context bypass: demo tenantId + is_super_admin=true -> 2
  // ---------------------------------------------------------------------------
  const superAdminUsers = await withSuperAdminContext(demoId, () => prisma.user.count());
  record(
    'S7',
    'super-admin context bypass: demo tenantId + super_admin -> users >= 2',
    superAdminUsers >= 2,
    `super-admin ctx user.count = ${superAdminUsers} (atteso >= 2)`,
  );

  // ---------------------------------------------------------------------------
  // S8 — Fail-fast: query FUORI da qualunque contesto -> RlsNoContextError
  //   (no contesto = nessun accesso, non accesso totale).
  // ---------------------------------------------------------------------------
  let s8FailFast = false;
  let s8Detail = '';
  try {
    await prisma.user.count();
    s8Detail = 'query senza contesto NON ha lanciato RlsNoContextError — GAP fail-fast';
  } catch (err) {
    s8FailFast = err instanceof RlsNoContextError;
    s8Detail = s8FailFast
      ? 'RlsNoContextError lanciato come atteso'
      : `errore inatteso (non RlsNoContextError): ${(err as Error).message.split('\n')[0]}`;
  }
  record('S8', 'fail-fast: query senza contesto -> RlsNoContextError', s8FailFast, s8Detail);

  await prisma.$disconnect();

  // ---------------------------------------------------------------------------
  // Summary + exit
  // ---------------------------------------------------------------------------
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(
    `\n=== Summary: ${passed}/${total} scenari ${passed === total ? 'PASS' : 'FAIL'} ===`,
  );
  if (passed !== total) {
    console.log('\nScenari falliti (possibile gap RLS — NON ignorare):');
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  [${r.id}] ${r.name} -> ${r.detail}`);
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ Smoke RLS core failure:', err);
  process.exit(2);
});
