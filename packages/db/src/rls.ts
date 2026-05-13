// =============================================================================
// rls.ts — Row Level Security context (AsyncLocalStorage) + Prisma extension
// =============================================================================
// Cuore architetturale della D3 RLS reali. 3 responsabilita':
//
// 1. ALS singleton + types: `TenantContext` (tenantId | null, isSuperAdmin) e
//    `getTenantContext()` accessor. Helpers `runInTenantContext`,
//    `withSystemContext`, `withSuperAdminContext`.
//
// 2. RLS Prisma extension factory: wrappa `$allOperations` su tutti i modelli
//    in un `$transaction` interactive che fa `SET LOCAL app.tenant_id` +
//    `SET LOCAL app.is_super_admin` PRIMA di eseguire la query reale. Pattern
//    S2 per-operation tx (decisione ADR-0009 #1).
//
// 3. Fail-fast: se una query Prisma parte fuori da qualunque context (ALS
//    vuoto), throw `RLS_NO_CONTEXT` esplicito. Mai dati vuoti silenti
//    (decisione 11 ADR-0009).
//
// Caveat noti documentati in ADR-0009:
// - `$queryRaw` / `$executeRawUnsafe` bypassano l'extension (intercetta solo
//   operazioni model-based). Chiamanti devono usare withSystemContext o
//   accettare responsabilita' esplicita.
// - PgBouncer transaction mode incompatibile con SET LOCAL cross-statement
//   (tech debt F2).
// - **Explicit `$transaction` NON e' atomico se le operazioni passano per
//   l'extension RLS** (scoperto a STEP 2a D4): l'extension apre un tx separato
//   per ogni operazione via il closure `client` (non il `tx` dell'utente),
//   quindi la rollback del tx esterno non propaga. Per operazioni
//   multi-statement atomic, usa `withSystemContextAtomicTx(fn)` o
//   `withTenantContextAtomicTx(tenantId, fn)` (vedi sotto).
// =============================================================================

import { AsyncLocalStorage } from 'node:async_hooks';

import { Prisma } from '@prisma/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface TenantContext {
  /**
   * Tenant scope per la query.
   * - UUID string -> SET LOCAL app.tenant_id = '<uuid>' nella tx
   * - null -> SET LOCAL app.tenant_id = '' (system context, bypass via is_super_admin)
   */
  tenantId: string | null;

  /**
   * Se true, RLS policy bypassa il check tenant_id (super admin / system ops).
   * Settato true solo da `withSystemContext` / `withSuperAdminContext` server-side.
   * **Mai** true dalla JWT in F1 (vedi ADR-0009 decisione 4).
   */
  isSuperAdmin: boolean;
}

// -----------------------------------------------------------------------------
// AsyncLocalStorage singleton di modulo
// -----------------------------------------------------------------------------

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Legge il context corrente dal frame async attivo. Ritorna `undefined` se
 * nessuna catena `run()` lo ha settato. **NON throwa**: la decisione di
 * fail-fast e' delegata al chiamante (l'extension RLS lo fa esplicitamente).
 */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Esegue `fn` con il context settato. Tutte le query Prisma + await chain
 * downstream vedranno questo context via `getTenantContext()`.
 *
 * Nested calls sovrascrivono il context per la durata interna (pattern
 * "context shadowing"): utile per chiamare withSystemContext da dentro un
 * tenant context (es. login slug lookup pre-auth).
 *
 * **Implementazione critica**: `storage.run` esegue una async function
 * inline. Il `await fn()` esplicito DENTRO il run frame garantisce che ALS
 * propaga al `.then()` del PrismaPromise (che e' lazy: la query parte solo
 * quando qualcuno fa `.then()` su di essa). Pattern `Promise.resolve(storage.
 * run(ctx, fn))` (forma precedente) fallisce empiricamente perche'
 * Promise.resolve scarta il context ALS prima del .then() lazy. Verificato in
 * D3 STOP 1.
 */
export function runInTenantContext<T>(ctx: TenantContext, fn: () => Promise<T> | T): Promise<T> {
  return storage.run(ctx, async () => fn());
}

/**
 * System context: `isSuperAdmin = true`, `tenantId = null`. Da usare in:
 * - seed scripts (`packages/db/prisma/seed.ts`)
 * - bootstrap / startup jobs
 * - health check ($queryRaw, ma per esplicito intent)
 * - script CLI / migration scripts
 *
 * **Non** chiamare da request handler runtime: il flow utente passa per
 * `runInTenantContext` con `isSuperAdmin: false`.
 */
export function withSystemContext<T>(fn: () => Promise<T> | T): Promise<T> {
  return runInTenantContext({ tenantId: null, isSuperAdmin: true }, fn);
}

/**
 * Super Admin context: `isSuperAdmin = true` + `tenantId = <targetTenant>`.
 * Usato da script ops cross-tenant (admin che fa intervento su tenant X).
 * Il tenantId e' opzionalmente usato dall'audit log per tracciare su quale
 * tenant l'admin stava operando, anche se le query non sono filtrate.
 *
 * **Non** chiamare da JWT flow runtime in F1 (vedi ADR-0009 S5 clarification).
 */
export function withSuperAdminContext<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
  return runInTenantContext({ tenantId, isSuperAdmin: true }, fn);
}

// -----------------------------------------------------------------------------
// Atomic transaction helpers (D4)
// -----------------------------------------------------------------------------
// Pattern: opera multi-statement atomic con RLS context. Necessario perche'
// l'extension RLS auto-wrappa ogni operazione in un tx separato (closure
// client base != user's tx), rompendo atomicity di un `$transaction` esplicito.
//
// Strategia:
//   1. withXxxContext per settare l'ALS ctx (cosi' altre query fuori dal tx
//      vedono il ctx corretto se serve)
//   2. inflightStorage.run(true, ...) per fare in modo che le operazioni
//      dentro al tx bypassino l'auto-wrap (re-entry guard fires)
//   3. prisma.$transaction(async (tx) => ...) - single tx atomic
//   4. SET LOCAL una volta sull'inizio del tx (visibile a tutte le ops
//      successive che girano sulla stessa connection del tx)
//   5. fn(tx) - le ops dell'utente girano sul tx, sono atomic (rollback se
//      qualcosa throwa)
//
// Vedi ADR-0010 sezione "Atomicity" per la considerazione architetturale
// e ADR-0009 v3 Notes per il caveat sulla composizione $transaction + extension.
// -----------------------------------------------------------------------------

// Tipo minimo richiesto dai client (Prisma client extended, tx client):
// solo `$transaction` con callback (interactive form). Generico su TX cosi'
// l'autocomplete sul body di `fn` funziona col tipo reale (Prisma.TransactionClient
// extended con le nostre extension).
interface AtomicTxClient<TX> {
  $transaction: <R>(fn: (tx: TX) => Promise<R>) => Promise<R>;
}

// Helper interno: setta SET LOCAL via il tx.$executeRawUnsafe (raw query
// bypassa l'extension grazie alla guard `model=undefined` post-STEP 0 D4).
// Cast minimo: il tx esposto dai client Prisma reali ha $executeRawUnsafe.
type TxRawExec = { $executeRawUnsafe: (sql: string) => Promise<unknown> };
async function setLocalRlsContext(tx: TxRawExec, ctx: TenantContext): Promise<void> {
  const tenantIdSql = ctx.tenantId === null ? '' : ctx.tenantId;
  const isSuperAdminSql = ctx.isSuperAdmin ? 'true' : 'false';
  await tx.$executeRawUnsafe(`SET LOCAL ${RLS_PG_SETTING_TENANT} = '${tenantIdSql}'`);
  await tx.$executeRawUnsafe(`SET LOCAL ${RLS_PG_SETTING_SUPER_ADMIN} = '${isSuperAdminSql}'`);
}

/**
 * Esegue `fn(tx)` in un singolo `$transaction` Prisma atomic, sotto system
 * context (`is_super_admin = true`, `tenant_id` vuoto). Tutti gli statement
 * dentro `fn` vedono i SET LOCAL e sono atomic — rollback automatico se `fn`
 * throwa.
 *
 * Usa per bootstrap pre-tenant (D4 createTenant), seed multi-statement
 * idempotenti, jobs cross-tenant che richiedono atomicity.
 *
 * Esempio:
 * ```
 * const result = await withSystemContextAtomicTx(prisma, async (tx) => {
 *   const tenant = await tx.tenant.create({ data: { ... } });
 *   const sede = await tx.sede.create({ data: { ... tenantId: tenant.id } });
 *   return { tenant, sede };
 * });
 * ```
 */
export function withSystemContextAtomicTx<TX, T>(
  client: AtomicTxClient<TX>,
  fn: (tx: TX) => Promise<T>,
): Promise<T> {
  return withSystemContext(() =>
    inflightStorage.run(true, () =>
      client.$transaction(async (tx) => {
        // SET LOCAL una volta sul tx. inflight guard previene re-wrap dell'
        // extension sulle ops dentro fn(tx) (passano through query(args)).
        await setLocalRlsContext(tx as unknown as TxRawExec, {
          tenantId: null,
          isSuperAdmin: true,
        });
        return fn(tx);
      }),
    ),
  );
}

/**
 * Esegue `fn(tx)` in un singolo `$transaction` Prisma atomic, sotto tenant
 * context (`is_super_admin = false`, `tenant_id = <tenantId>`). RLS attivo:
 * le query dentro `fn` filtrate dal tenantId. Atomic: rollback se `fn` throwa.
 *
 * Usa per operazioni runtime multi-statement tenant-scoped: aggiornamento
 * sede + utenti + audit in un colpo, bulk import, ecc.
 *
 * Esempio:
 * ```
 * await withTenantContextAtomicTx(prisma, tenantId, async (tx) => {
 *   await tx.sede.update({ where: { id }, data: { ... } });
 *   await tx.user.updateMany({ where: { sedeId: id }, data: { ... } });
 *   await tx.auditLog.create({ data: { action: 'sede.bulk_update', ... } });
 * });
 * ```
 */
export function withTenantContextAtomicTx<TX, T>(
  client: AtomicTxClient<TX>,
  tenantId: string,
  fn: (tx: TX) => Promise<T>,
): Promise<T> {
  assertValidUuid(tenantId);
  return runInTenantContext({ tenantId, isSuperAdmin: false }, () =>
    inflightStorage.run(true, () =>
      client.$transaction(async (tx) => {
        await setLocalRlsContext(tx as unknown as TxRawExec, {
          tenantId,
          isSuperAdmin: false,
        });
        return fn(tx);
      }),
    ),
  );
}

// -----------------------------------------------------------------------------
// Error codes
// -----------------------------------------------------------------------------

/**
 * Errore lanciato quando una query Prisma parte fuori da qualunque context.
 * Fail-fast (decisione 11 ADR-0009): meglio errore 500 esplicito che dati
 * vuoti silenti (RLS strict ritornerebbe [] ma il bug architetturale resterebbe
 * invisibile).
 */
export const RLS_NO_CONTEXT = 'RLS_NO_CONTEXT';

export class RlsNoContextError extends Error {
  constructor(operation: string, model?: string) {
    super(
      `${RLS_NO_CONTEXT}: Prisma operation '${model ?? '<raw>'}.${operation}' executed outside any tenant context. Wrap call in runInTenantContext / withSystemContext / withSuperAdminContext.`,
    );
    this.name = 'RlsNoContextError';
  }
}

// -----------------------------------------------------------------------------
// PostgreSQL settings: nomi canonici
// -----------------------------------------------------------------------------

export const RLS_PG_SETTING_TENANT = 'app.tenant_id';
export const RLS_PG_SETTING_SUPER_ADMIN = 'app.is_super_admin';

// -----------------------------------------------------------------------------
// UUID validation (anti-SQL injection in SET LOCAL)
// -----------------------------------------------------------------------------
// SET LOCAL non accetta parametri ($1 bind), serve interpolazione literal.
// Per evitare SQL injection se tenantId arrivasse da fonte non trusted (non
// dovrebbe mai, ma defense in depth), validiamo strict UUID format.
//
// UUID v7 ha lo stesso shape di v4 dal punto di vista regex: 8-4-4-4-12 hex.
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidUuid(uuid: string): void {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error(`RLS: invalid UUID for SET LOCAL: '${uuid}'`);
  }
}

// -----------------------------------------------------------------------------
// Prisma extension factory
// -----------------------------------------------------------------------------

/**
 * Factory dell'extension RLS. Da applicare al PrismaClient extended via
 * `.$extends(rlsExtension())`. Wrappa **ogni operazione su ogni model** in
 * un `$transaction` interactive che setta SET LOCAL prima della query.
 *
 * Note implementative:
 * - `$allOperations` riceve `({ args, query, model, operation })`. La firma
 *   `query(args)` ri-esegue l'operazione passandola attraverso eventuali altre
 *   extension nella catena (es. softDeleteExtension). Empiricamente verificato
 *   a STOP 1 D3 che `query(args)` dentro `$transaction` callback **vede** le
 *   SET LOCAL impostate sul tx (Prisma 5+ propaga il tx context via interno
 *   itxClientDenyList — vedi commento sotto se la verifica fallisce).
 * - `$queryRaw` / `$executeRaw` NON sono intercettati da $allOperations
 *   (intercetta solo model operations). Chiamanti $queryRaw devono wrappare
 *   manualmente o accettare bypass (vedi caveat ADR-0009).
 *
 * R3 fallback (se la verifica empirica STOP 1 fallisce):
 * - opzione F1: invece di `query(args)`, usare `(tx as any)[model][operation](args)`
 *   con cast unsafe. Funziona ma rompe la catena di altre extension.
 * - opzione F2: tornare al pattern $use middleware (deprecato Prisma 5+).
 * - opzione F3: HTTP-scoped tx (S3). Refactor service DI. Scartato F1 per R5.
 */
/**
 * Re-entrancy guard: marca la chiamata corrente come "gia' dentro a un tx
 * RLS-wrapped". Quando `tx[model][operation](args)` retrigge $allOperations
 * sul tx client (perche' tx ha tutte le extension applicate), il guard
 * evita di aprire un secondo $transaction nested.
 *
 * **Internal**: usato da Atomic helpers (`withSystemContextAtomicTx`,
 * `withTenantContextAtomicTx`) per fare in modo che le operazioni dentro al
 * `$transaction` user-side bypassino l'auto-wrap della extension (atomicity
 * preserved). NON chiamare direttamente da fuori `packages/db` — pattern
 * convenzione "internal" Go-style.
 */
export const inflightStorage = new AsyncLocalStorage<true>();

export function rlsExtension() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      name: 'rls-tenant-isolation',
      query: {
        $allOperations({ args, query, model, operation }) {
          // Re-entry: chiamata interna su tx, il SET LOCAL e' gia' attivo.
          // Esegui la query normalmente senza wrap extra.
          if (inflightStorage.getStore()) {
            return query(args);
          }

          // Raw queries: $queryRaw / $executeRaw / $queryRawUnsafe / $executeRawUnsafe
          // arrivano a $allOperations con `model=undefined` (Prisma 6.19.3, verificato
          // a STEP 0 D4). Per design (caveat documentato nel file header + ADR-0009 sezione
          // "Notes"), bypassano l'extension RLS: il chiamante e' responsabile del proprio
          // context. Pass-through senza wrap + niente fail-fast.
          if (!model) {
            return query(args);
          }

          const ctx = getTenantContext();

          if (!ctx) {
            throw new RlsNoContextError(operation, model);
          }

          // Validate inputs PRIMA di SET LOCAL (no injection)
          if (ctx.tenantId !== null) {
            assertValidUuid(ctx.tenantId);
          }

          // Setting values come literal stringhe SQL-safe
          const tenantIdSql = ctx.tenantId === null ? '' : ctx.tenantId;
          const isSuperAdminSql = ctx.isSuperAdmin ? 'true' : 'false';

          // $transaction interactive: SET LOCAL + query nello stesso tx.
          // Pattern: bypass query() (che non eredita il tx context per via R3
          // verificato in STOP 1) ed esegue l'operazione direttamente sul `tx`
          // via `tx[modelLower][operation](args)`. La re-entry sul tx fa
          // ritriggerare $allOperations ma il guard inflightStorage la
          // riconosce e lascia passare query(args) senza nuovo wrap.
          // Nota: model qui e' garantito non-undefined per la guard early-return
          // su raw queries sopra.
          const modelLower = model.charAt(0).toLowerCase() + model.slice(1);

          return inflightStorage.run(true, () =>
            // Extended client (post-$extends) strippa `$executeRawUnsafe` dal
            // tipo Tx; runtime ce l'ha sempre. Cast unico per entrambi gli
            // accessi raw + l'invocazione dinamica per modello/operation.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            client.$transaction(async (tx: any) => {
              await tx.$executeRawUnsafe(`SET LOCAL ${RLS_PG_SETTING_TENANT} = '${tenantIdSql}'`);
              await tx.$executeRawUnsafe(
                `SET LOCAL ${RLS_PG_SETTING_SUPER_ADMIN} = '${isSuperAdminSql}'`,
              );
              return tx[modelLower][operation](args);
            }),
          );
        },
      },
    });
  });
}
