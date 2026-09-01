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
// Non-distruttivo: read sui dati del seed (studio-demo + oneplatform) +
// write-block (insert cross-tenant DEVE essere respinto → non persiste).
// Idempotente: re-run infinito senza side-effect (sul PASS path nessuna riga
// scritta). Safe da girare in CI subito dopo `db:seed`.
//
// ⚠️ La coppia di tenant era `demo` + `acme` (verticale ristorazione), rimossi
// con il verticale stesso. Ora è `studio-demo` (il tenant accountant, la forma
// più ricca: 3 utenti / 3 ruoli) + `oneplatform` (tenant di piattaforma,
// minimale: 1 utente / 1 ruolo). La coppia serve solo a dare DUE tenant fra cui
// verificare l'isolamento: il dominio dei due è irrilevante per questo test,
// che tocca esclusivamente tabelle CORE.
//
// ⚠️ I conteggi ESATTI di S1/S2 descrivono un DB **appena seedato** — cioè la
// casa di questo presidio, il job CI `seed-rls-core`, che gira `db:seed` su un
// Postgres vuoto subito prima. Su un DB vissuto (dev con utenti creati a mano,
// prod) i conteggi divergono e S1/S2 falliscono: è una proprietà nota e
// precedente a questa modifica, non una regressione introdotta qui.
//
// Connessione: `createPrismaClient()` legge `DATABASE_URL` dall'ambiente. In CI
// (job `seed-rls-core`) e in dev è il role `gestionale_app` (post-rotate / init
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
  const { studioId, platformId, platformUserId } = await withSystemContext(async () => {
    const studio = await prisma.tenant.findUnique({ where: { slug: 'studio-demo' } });
    const platform = await prisma.tenant.findUnique({ where: { slug: 'oneplatform' } });
    if (!studio || !platform) {
      throw new Error(
        "Tenants 'studio-demo' e 'oneplatform' richiesti. Esegui: pnpm --filter @gestionale/db db:seed",
      );
    }
    const platformUser = await prisma.user.findFirst({ where: { tenantId: platform.id } });
    if (!platformUser) {
      throw new Error("Almeno un user per tenant 'oneplatform' richiesto (db:seed).");
    }
    return { studioId: studio.id, platformId: platform.id, platformUserId: platformUser.id };
  });
  console.log(`studioId=${studioId}`);
  console.log(`platformId=${platformId}\n`);

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
  const studio = await runInTenantContext(
    { tenantId: studioId, isSuperAdmin: false },
    async () => ({
      tenants: await prisma.tenant.count(),
      sedi: await prisma.sede.count(),
      users: await prisma.user.count(),
      roles: await prisma.role.count(),
      userRoles: await prisma.userRole.count(),
    }),
  );
  // Conteggi attesi = righe possedute dal solo tenant studio-demo, appena
  // seedato: 1 sede + 3 utenti (admin@studio.local Super Admin,
  // collaboratore@studio.local Collaboratore, cliente@studio-demo.local Cliente)
  // + 3 ruoli tenant-scoped + 3 user_roles. Un eventuale leak da un altro tenant
  // spingerebbe i conteggi OLTRE questi valori → l'uguaglianza esatta resta un
  // rilevatore di leak, non solo un check di seed.
  record(
    'S1',
    'read isolation studio-demo: tenants=1/sedi=1/users=3/roles=3, nessun leak',
    studio.tenants === 1 &&
      studio.sedi === 1 &&
      studio.users === 3 &&
      studio.roles === 3 &&
      studio.userRoles === 3,
    `studio-demo ctx counts = ${JSON.stringify(studio)} (atteso tenants=1/sedi=1/users=3/roles=3/userRoles=3)`,
  );

  // ---------------------------------------------------------------------------
  // S2 — Read isolation (oneplatform): speculare
  // ---------------------------------------------------------------------------
  const platform = await runInTenantContext(
    { tenantId: platformId, isSuperAdmin: false },
    async () => ({
      tenants: await prisma.tenant.count(),
      users: await prisma.user.count(),
    }),
  );
  record(
    'S2',
    'read isolation oneplatform: tenants/users == 1',
    platform.tenants === 1 && platform.users === 1,
    `oneplatform ctx counts = ${JSON.stringify(platform)} (atteso 1/1)`,
  );

  // ---------------------------------------------------------------------------
  // S3 — Cross-tenant block (read): studio-demo ctx + id oneplatform -> null
  // ---------------------------------------------------------------------------
  const cross = await runInTenantContext({ tenantId: studioId, isSuperAdmin: false }, async () => ({
    user: await prisma.user.findUnique({ where: { id: platformUserId } }),
    tenant: await prisma.tenant.findUnique({ where: { id: platformId } }),
  }));
  record(
    'S3',
    'cross-tenant block (read): studio-demo ctx -> oneplatform user/tenant = null',
    cross.user === null && cross.tenant === null,
    `user=${cross.user === null ? 'null' : 'LEAK'}, tenant=${cross.tenant === null ? 'null' : 'LEAK'}`,
  );

  // ---------------------------------------------------------------------------
  // S4 — Write-block cross-tenant (users): studio-demo ctx, INSERT
  //   tenant_id=oneplatform DEVE essere respinto (WITH CHECK). Insert fallito =
  //   non persiste.
  // ---------------------------------------------------------------------------
  let s4Blocked = false;
  let s4Detail = '';
  try {
    await runInTenantContext({ tenantId: studioId, isSuperAdmin: false }, () =>
      prisma.user.create({
        data: {
          id: id(),
          tenantId: platformId, // cross-tenant: deve violare WITH CHECK
          email: `rls-writeblock-${Date.now()}@invalid.local`,
          passwordHash: 'x',
          firstName: 'RLS',
          lastName: 'WriteBlock',
        },
      }),
    );
    s4Detail =
      'INSERT cross-tenant NON bloccato (riga oneplatform creata da studio-demo ctx) — GAP';
  } catch (err) {
    s4Blocked = true;
    s4Detail = `INSERT respinto come atteso: ${(err as Error).message.split('\n')[0]}`;
  }
  record(
    'S4',
    'write-block cross-tenant (users): studio-demo ctx + tenant_id=oneplatform respinto',
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
    await runInTenantContext({ tenantId: studioId, isSuperAdmin: false }, () =>
      prisma.auditLog.create({
        data: { id: id(), tenantId: platformId, action: 'rls.smoke.writeblock' },
      }),
    );
    s5Detail =
      'INSERT cross-tenant NON bloccato (audit_log oneplatform creato da studio-demo ctx) — GAP';
  } catch (err) {
    s5Blocked = true;
    s5Detail = `INSERT respinto come atteso: ${(err as Error).message.split('\n')[0]}`;
  }
  record(
    'S5',
    'write-block cross-tenant (audit_logs): studio-demo ctx + tenant_id=oneplatform respinto',
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
  // S7 — Super-admin context bypass: studio-demo tenantId + is_super_admin=true
  //   DEVE vedere oltre il proprio tenant.
  //
  //   L'asserzione è RELATIVA al conteggio di S1, non una soglia fissa: una
  //   soglia (`>= 2`) sarebbe soddisfatta dai soli utenti di studio-demo anche
  //   con il bypass rotto — non proverebbe nulla. Il confronto col conteggio
  //   tenant-scoped invece fallisce se il bypass non scavalca il confine, e non
  //   va aggiornato quando il seed cambia forma.
  // ---------------------------------------------------------------------------
  const superAdminUsers = await withSuperAdminContext(studioId, () => prisma.user.count());
  record(
    'S7',
    'super-admin context bypass: studio-demo tenantId + super_admin -> vede oltre il tenant',
    superAdminUsers > studio.users,
    `super-admin ctx user.count = ${superAdminUsers} (atteso > ${studio.users}, cioè oltre i soli utenti di studio-demo)`,
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
