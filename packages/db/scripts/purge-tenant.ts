// =============================================================================
// purge-tenant.ts — Comando ops: hard-delete di un tenant di test/verifica
// =============================================================================
// I tenant di test ricorrono (fixture, verifiche di deploy, smoke). Questo
// comando li rimuove dal DB prod condiviso in modo ripetibile e con guard-rail,
// invece di scrivere SQL ad-hoc ogni volta.
//
// Guard-rail (NON negoziabili):
//   1. Blocklist well-known: demo / acme / studio-demo / oneplatform NON sono
//      cancellabili. Se uno compare nel set target → abort, nessun DELETE.
//   2. Match ESATTO per slug o id passati esplicitamente (mai pattern LIKE):
//      si cancella ciò che indichi, non una euristica che in futuro cattura altro.
//   3. Dry-run DI DEFAULT: senza `--execute` stampa solo il blast radius e esce.
//   4. Esecuzione transazionale con verifica pre-commit: dentro un'unica
//      transazione, COMMIT solo se ROW_COUNT(tenants) == #target E i figli sono
//      azzerati; altrimenti l'eccezione forza il ROLLBACK.
//
// Connessione: `DIRECT_URL` (ruolo `postgres` superuser, BYPASSRLS) — l'unico
// che può cancellare cross-tenant senza essere filtrato dalla RLS FORCE. NON usa
// la factory `createPrismaClient` (che applica l'estensione RLS sul ruolo app):
// un PrismaClient nudo sul superuser è il canale corretto e prevedibile.
// Il CASCADE delle FK pulisce i figli con il singolo DELETE sul tenant.
//
// Uso (da packages/db/):
//   pnpm purge-tenant --slug verifica-41554              # dry-run (default)
//   pnpm purge-tenant --slug verifica-41554 --execute    # cancella davvero
//   pnpm purge-tenant --id <uuid> --slug <altro> --execute
//
// Exit: 0 = ok (dry-run o delete riuscito); 1 = guard/validazione fallita o
// mismatch pre-commit (rollback); 2 = errore inatteso.
// =============================================================================

import { PrismaClient } from '@prisma/client';

import { assertSafeDbTarget } from '../src/assert-safe-db-target';

const WELL_KNOWN = ['demo', 'acme', 'studio-demo', 'oneplatform'];

/** count(*) ritorna sempre una riga; estrae n in modo type-safe (strict index). */
function n0(rows: Array<{ n: number }>): number {
  return rows[0]?.n ?? 0;
}

interface Args {
  slugs: string[];
  ids: string[];
  execute: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  const ids: string[] = [];
  let execute = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug' || a === '--id') {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} richiede un valore`);
      (a === '--slug' ? slugs : ids).push(v);
    } else if (a === '--execute') execute = true;
    else if (a === '--help' || a === '-h') help = true;
    else throw new Error(`Argomento non riconosciuto: ${a}`);
  }
  return { slugs, ids, execute, help };
}

const USAGE = `purge-tenant — hard-delete guardato di tenant di test sul DB prod

  --slug <s>    slug esatto da cancellare (ripetibile)
  --id <uuid>   id esatto da cancellare (ripetibile)
  --execute     esegue davvero il DELETE (DEFAULT: dry-run, nessuna modifica)
  --help        questo messaggio

Blocklist well-known (mai cancellabili): ${WELL_KNOWN.join(', ')}`;

/** Tabelle tenant-scoped (colonna tenant_id), scoperte a runtime → future-proof. */
async function tenantScopedTables(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'tenant_id'
     ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

/** Conta le righe appese ai tenant target, per tabella (solo le non-zero). */
async function blastRadius(
  prisma: PrismaClient,
  tables: string[],
  ids: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM "${t}" WHERE tenant_id = ANY($1::text[])`,
      ids,
    );
    const n = n0(r);
    if (n > 0) out[t] = n;
  }
  // user_roles non ha tenant_id: si aggancia agli utenti dei tenant target.
  const ur = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM user_roles ur
       JOIN users u ON u.id = ur.user_id WHERE u.tenant_id = ANY($1::text[])`,
    ids,
  );
  const urN = n0(ur);
  if (urN > 0) out['user_roles'] = urN;
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.slugs.length === 0 && args.ids.length === 0) {
    console.error('❌ Nessun target. Indica almeno un --slug o --id.\n');
    console.error(USAGE);
    return 1;
  }
  if (!process.env.DIRECT_URL) {
    console.error('❌ DIRECT_URL assente. Esegui via: pnpm purge-tenant (carica ../../.env)');
    return 2;
  }

  // Guard anti-prod-da-host: questo client NON passa dalla factory, quindi il
  // guard va richiamato qui esplicitamente sull'url effettivo (DIRECT_URL).
  // purge-tenant DEVE poter girare su prod (è il suo scopo) → il wrapper npm
  // lo lancia con ALLOW_PROD_DB_ACCESS=1; lanciato "nudo" aborta. Vedi Sub-A §2.4.
  assertSafeDbTarget(process.env.DIRECT_URL, {
    nodeEnv: process.env.NODE_ENV,
    allowProdDb: process.env.ALLOW_PROD_DB_ACCESS === '1',
  });

  // Superuser, RLS bypassata, nessuna estensione RLS.
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

  try {
    // -------------------------------------------------------------------------
    // 1. Risoluzione target per slug/id ESATTI (invariante 2)
    // -------------------------------------------------------------------------
    const targets = await prisma.$queryRawUnsafe<
      Array<{ id: string; slug: string; name: string; deleted_at: Date | null }>
    >(
      `SELECT id, slug, name, deleted_at FROM tenants
       WHERE slug = ANY($1::text[]) OR id = ANY($2::text[])`,
      args.slugs,
      args.ids,
    );

    // Segnala richieste non risolte (slug/id inesistenti) — refuso o già pulito.
    const foundSlugs = new Set(targets.map((t) => t.slug));
    const foundIds = new Set(targets.map((t) => t.id));
    const missing = [
      ...args.slugs.filter((s) => !foundSlugs.has(s)).map((s) => `slug=${s}`),
      ...args.ids.filter((i) => !foundIds.has(i)).map((i) => `id=${i}`),
    ];
    if (missing.length > 0) {
      console.error(`❌ Target non trovati (nessun tenant): ${missing.join(', ')}`);
      console.error('   Refuso o già rimosso. Nessuna azione (match esatto, niente euristiche).');
      return 1;
    }

    // -------------------------------------------------------------------------
    // 2. INVARIANTE 1 — blocklist well-known (refiuto categorico)
    // -------------------------------------------------------------------------
    const wk = targets.filter((t) => WELL_KNOWN.includes(t.slug));
    if (wk.length > 0) {
      console.error(
        `❌ GUARD well-known: ${wk.map((t) => t.slug).join(', ')} → ABORT, nessun delete.`,
      );
      return 1;
    }

    const ids = targets.map((t) => t.id);
    console.log('=== Target (match esatto) ===');
    for (const t of targets) {
      console.log(
        `  ${t.slug}  (${t.id})  "${t.name}"${t.deleted_at ? '  [già soft-deleted]' : ''}`,
      );
    }

    // -------------------------------------------------------------------------
    // 3. Blast radius
    // -------------------------------------------------------------------------
    const tables = await tenantScopedTables(prisma);
    const radius = await blastRadius(prisma, tables, ids);
    const totalChildren = Object.values(radius).reduce((a, b) => a + b, 0);
    console.log(`\n=== Blast radius (${ids.length} tenant + ${totalChildren} righe figlie) ===`);
    if (totalChildren === 0) console.log('  (nessuna riga figlia)');
    for (const [t, n] of Object.entries(radius).sort()) console.log(`  ${t.padEnd(16)} ${n}`);

    // -------------------------------------------------------------------------
    // 4. Dry-run (DEFAULT) — invariante 3
    // -------------------------------------------------------------------------
    if (!args.execute) {
      console.log('\n🟡 DRY-RUN (default): nessuna modifica. Aggiungi --execute per cancellare.');
      return 0;
    }

    // -------------------------------------------------------------------------
    // 5. Esecuzione transazionale con verifica pre-commit (invariante 4)
    // -------------------------------------------------------------------------
    console.log('\n🔴 ESECUZIONE (--execute): transazione con verifica pre-commit...');
    const deleted = await prisma.$transaction(async (tx) => {
      // re-asserzione guard well-known dentro la transazione
      const reWk = await tx.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM tenants
           WHERE id = ANY($1::text[]) AND slug = ANY($2::text[])`,
        ids,
        WELL_KNOWN,
      );
      const reWkN = n0(reWk);
      if (reWkN !== 0) throw new Error(`GUARD well-known nel set (${reWkN}) → ROLLBACK`);

      // DELETE singolo; CASCADE pulisce i figli
      const rowCount = await tx.$executeRawUnsafe(
        `DELETE FROM tenants WHERE id = ANY($1::text[])`,
        ids,
      );
      if (rowCount !== ids.length) {
        throw new Error(`ROW_COUNT=${rowCount} atteso ${ids.length} → ROLLBACK`);
      }

      // post: figli azzerati (ri-conta dentro la stessa transazione)
      const post = await blastRadius(tx as unknown as PrismaClient, tables, ids);
      const residual = Object.values(post).reduce((a, b) => a + b, 0);
      if (residual !== 0) throw new Error(`figli residui=${residual} → ROLLBACK`);

      return rowCount;
    });

    console.log(`\n✅ COMMIT: ${deleted} tenant + ${totalChildren} righe figlie rimosse.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('\n❌ purge-tenant errore inatteso:', err);
    process.exit(2);
  });
