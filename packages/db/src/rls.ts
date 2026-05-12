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
 */
const inflightStorage = new AsyncLocalStorage<true>();

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
          if (!model) {
            // Operazioni non-model (es. raw, $executeRaw) non sono qui:
            // $allOperations le filtra. Se arrivasse, fail-safe.
            throw new Error('RLS: $allOperations received empty model name');
          }
          const modelLower = model.charAt(0).toLowerCase() + model.slice(1);

          return inflightStorage.run(true, () =>
            client.$transaction(async (tx) => {
              await tx.$executeRawUnsafe(`SET LOCAL ${RLS_PG_SETTING_TENANT} = '${tenantIdSql}'`);
              await tx.$executeRawUnsafe(
                `SET LOCAL ${RLS_PG_SETTING_SUPER_ADMIN} = '${isSuperAdminSql}'`,
              );
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (tx as any)[modelLower][operation](args);
            }),
          );
        },
      },
    });
  });
}
