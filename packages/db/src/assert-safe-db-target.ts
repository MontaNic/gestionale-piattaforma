// =============================================================================
// assert-safe-db-target.ts — guard anti-prod-da-host (TD-dev-env-punta-prod / Sub-A)
// =============================================================================
// Chiude il vettore del near-incident: un processo Node lanciato DA HOST
// (`next dev` / `nest start` / script one-off) che eredita il `.env` root e si
// connette al DB di PRODUZIONE con `NODE_ENV` non-production deve ABORTIRE
// prima di qualsiasi query, invece di operare su prod.
//
// Difesa MECCANIZZATA, non disciplina umana. Funzione PURA (nessuna connessione,
// nessun side-effect oltre il throw) → interamente testabile senza DB.
//
// Innesto: `createPrismaClient()` (src/index.ts) prima di istanziare il client,
// e `purge-tenant.ts` prima del client diretto. Vedi STOP 1 Sub-A.
//
// NB: NON copre `prisma migrate deploy` / `prisma studio` (Prisma CLI, engine
// proprio, non attraversano questo codice) → TD-prisma-studio-prod-unguarded.
// =============================================================================

export interface SafeDbCtx {
  /** `process.env.NODE_ENV` — se `'production'` il guard è inerte (contesto container legittimo). */
  nodeEnv: string | undefined;
  /** `process.env.ALLOW_PROD_DB_ACCESS === '1'` — whitelist manutenzione intenzionale. */
  allowProdDb: boolean;
}

/**
 * Errore di abort quando un target di PRODUZIONE viene raggiunto da un contesto
 * non-production senza whitelist esplicita. Messaggio azionabile (cosa + come
 * sbloccare); NESSUNA password nel messaggio (host/porta/db sono locali, non
 * segreti).
 */
export class ProdDbAccessBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProdDbAccessBlockedError';
  }
}

// Target di produzione da proteggere. Il match è su host:porta:db, NON sul
// ruolo (utente/password ignorati) → copre sia DATABASE_URL (app role) sia
// DIRECT_URL (superuser), entrambi puntano allo stesso DB prod.
const PROD_HOSTS = new Set(['127.0.0.1', 'localhost']);
const PROD_DB = 'gestionale';

/**
 * Aborta (throw `ProdDbAccessBlockedError`) se `databaseUrl` punta al DB di
 * produzione (`{127.0.0.1|localhost}:5432/gestionale`) da un contesto
 * non-production e non whitelistato. Altrimenti ritorna senza effetti.
 *
 * @param databaseUrl connection string effettivamente usata dal client
 * @param ctx         NODE_ENV + flag whitelist (iniettati dal chiamante, così
 *                    la funzione resta pura e testabile senza `process.env`)
 */
export function assertSafeDbTarget(databaseUrl: string, ctx: SafeDbCtx): void {
  // 1. Contesto prod legittimo (container con NODE_ENV=production) → nessun controllo.
  if (ctx.nodeEnv === 'production') return;

  // 2. Manutenzione intenzionale whitelistata → nessun controllo.
  if (ctx.allowProdDb) return;

  // 3. Parsa il target. Validare l'URL NON è compito del guard: se malformato,
  //    non abortiamo — lasciamo fallire il client Prisma a valle con l'errore
  //    di connessione appropriato.
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return;
  }

  // 4. Normalizza. `URL.port` è '' quando la porta è omessa → default 5432.
  const host = parsed.hostname;
  const port = parsed.port === '' ? '5432' : parsed.port;
  const db = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  const isProdTarget = PROD_HOSTS.has(host) && port === '5432' && db === PROD_DB;
  if (!isProdTarget) return;

  // 5. Match → abort con messaggio azionabile.
  throw new ProdDbAccessBlockedError(
    `FATAL: connessione al DB di PRODUZIONE (${host}:${port}/${db}) con NODE_ENV=${
      ctx.nodeEnv ?? '(unset)'
    }.\n` +
      `Se è un dev server hai quasi puntato dev a prod: usa un DB isolato.\n` +
      `Se è manutenzione intenzionale su prod: rilancia con ALLOW_PROD_DB_ACCESS=1.`,
  );
}
