// =============================================================================
// soft-delete.ts — Prisma client extension per soft-delete trasparente
// =============================================================================
// Comportamento (vedi ADR-0005 decisione 4 + sezione "Macro-task B"):
//
// 1. Auto-detect: i modelli con campo `deletedAt` sono identificati al boot
//    dell'extension via `Prisma.dmmf.datamodel.models`. Niente lista hardcoded.
//
// 2. Query intercept (findUnique, findFirst, findMany, count, aggregate,
//    groupBy): se il modello ha `deletedAt` E il `where` del chiamante NON
//    esplicita `deletedAt`, l'extension inietta `where.deletedAt = null`.
//    => Le query "leggi" non vedono i record soft-deleted by default.
//
// 3. Escape esplicito: se il chiamante passa `where: { deletedAt: ... }`
//    (qualunque check: `null`, `{ not: null }`, `{ lte: date }`, ecc.),
//    l'extension NON inietta. Permette query del "cestino".
//
// 4. Delete intercept (delete, deleteMany): trasformati in update/updateMany
//    con `data: { deletedAt: new Date() }`. WARNING su deleteMany senza where:
//    soft-delete TOTALE del modello (vedi blocco INTERCEPT_DELETE_MANY).
//
// 5. forceDelete(where: { id: string }) — model extension aggiuntiva per
//    hard-delete intenzionale che bypassa la query extension via SQL raw
//    parametrizzato. ON DELETE CASCADE/SET NULL del DB e' rispettato.
// =============================================================================

import { Prisma } from '@prisma/client';

// -----------------------------------------------------------------------------
// Auto-detect modelli con campo `deletedAt`
// -----------------------------------------------------------------------------
const modelsWithDeletedAt = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'deletedAt'))
    .map((m) => m.name),
);

// Lookup tableName (snake_case @@map) per `$executeRawUnsafe` in forceDelete.
const modelToTableName = new Map<string, string>(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, m.dbName ?? m.name]),
);

// -----------------------------------------------------------------------------
// Helper: il `where` esplicita gia' un check su `deletedAt`?
// -----------------------------------------------------------------------------
const explicitDeletedAt = (where: unknown): boolean =>
  where != null && typeof where === 'object' && 'deletedAt' in (where as object);

// -----------------------------------------------------------------------------
// Helper: clona `args` iniettando `where.deletedAt = null` preservando il
// resto. Cast `as any` interni necessari perche' `$allModels` ha tipo where
// come union di TUTTI i WhereInput, e modelli senza `deletedAt` (AuditLog,
// Permission, SystemRoleTemplate, *_permissions, UserRole, Session) non
// l'accettano nel tipo. L'iniezione e' runtime-safe perche' gated dal check
// `modelsWithDeletedAt.has(model)` lato chiamante.
// -----------------------------------------------------------------------------
function withSoftDeleteFilter<T>(args: T | undefined): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = (args ?? {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...base, where: { ...(base.where ?? {}), deletedAt: null } } as any as T;
}

// -----------------------------------------------------------------------------
// Extension
// -----------------------------------------------------------------------------
export const softDeleteExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: 'softDelete',

    // ─────────────────────────────────────────────────────────────────────────
    // Query intercepts: inject `where.deletedAt = null` quando necessario
    // ─────────────────────────────────────────────────────────────────────────
    query: {
      $allModels: {
        async findUnique({ model, args, query }) {
          if (modelsWithDeletedAt.has(model) && !explicitDeletedAt(args.where)) {
            args = withSoftDeleteFilter(args);
          }
          return query(args);
        },

        async findFirst({ model, args, query }) {
          if (modelsWithDeletedAt.has(model) && !explicitDeletedAt(args?.where)) {
            args = withSoftDeleteFilter(args);
          }
          return query(args);
        },

        async findMany({ model, args, query }) {
          if (modelsWithDeletedAt.has(model) && !explicitDeletedAt(args?.where)) {
            args = withSoftDeleteFilter(args);
          }
          return query(args);
        },

        async count({ model, args, query }) {
          if (modelsWithDeletedAt.has(model) && !explicitDeletedAt(args?.where)) {
            args = withSoftDeleteFilter(args);
          }
          return query(args);
        },

        async aggregate({ model, args, query }) {
          if (modelsWithDeletedAt.has(model) && !explicitDeletedAt(args?.where)) {
            args = withSoftDeleteFilter(args);
          }
          return query(args);
        },

        async groupBy({ model, args, query }) {
          if (modelsWithDeletedAt.has(model) && !explicitDeletedAt(args?.where)) {
            args = withSoftDeleteFilter(args);
          }
          return query(args);
        },

        // ─────────────────────────────────────────────────────────────────────
        // INTERCEPT_DELETE — trasforma in update soft
        // ─────────────────────────────────────────────────────────────────────
        async delete({ model, args, query }) {
          if (!modelsWithDeletedAt.has(model)) {
            return query(args);
          }
          // Cast `as any`: il return type di update e' tecnicamente diverso
          // da quello di delete (entrambi tornano il record, ma il typing
          // generico di $allModels non lo cattura). Coerente per uso pratico.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const delegate = (client as any)[lowerFirst(model)];
          return delegate.update({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        },

        // ─────────────────────────────────────────────────────────────────────
        // INTERCEPT_DELETE_MANY — trasforma in updateMany soft
        // ─────────────────────────────────────────────────────────────────────
        // WARNING (decisione C macro-task B): `deleteMany()` senza `where`
        // diventa soft-delete dell'INTERO modello. Coerente con l'intent del
        // chiamante che ha invocato deleteMany senza filtri, ma pattern raro
        // e potenzialmente devastante in dev. Aggiungere where esplicito nei
        // test e nello sviluppo per evitare wipe accidentali.
        async deleteMany({ model, args, query }) {
          if (!modelsWithDeletedAt.has(model)) {
            return query(args);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const delegate = (client as any)[lowerFirst(model)];
          return delegate.updateMany({
            where: args?.where ?? {},
            data: { deletedAt: new Date() },
          });
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Model extension: forceDelete(where: { id })
    // ─────────────────────────────────────────────────────────────────────────
    model: {
      $allModels: {
        /**
         * Hard-delete intenzionale che bypassa la soft-delete extension.
         *
         * Bypass technique: usa `$executeRawUnsafe` con DELETE SQL diretto,
         * cosi' la query extension (che intercetta `delete`/`deleteMany`) non
         * viene triggerata. Niente ricorsione.
         *
         * Use case: cleanup amministrativo, conformita' GDPR
         * (right-to-erasure), pulizia dati di test, rimozione tenant cessato.
         *
         * Garanzie:
         * - `ON DELETE CASCADE` / `ON DELETE SET NULL` del DB sono rispettati
         *   (PostgreSQL applica le FK constraint a qualsiasi DELETE SQL)
         * - Input parametrizzato (`$1`) — niente SQL injection sul campo `id`
         *
         * **WARNING**: usare con cautela. Le righe sparite non sono
         * recuperabili (no soft-delete). Per audit, registrare manualmente
         * un record in `audit_logs` prima della chiamata se necessario.
         *
         * @example
         * await prisma.tenant.forceDelete({ id: 'abc-...' });
         */
        async forceDelete<T>(this: T, where: { id: string }): Promise<number> {
          const context = Prisma.getExtensionContext(this);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const modelName = (context as any).$name as string;
          const tableName = modelToTableName.get(modelName);
          if (!tableName) {
            throw new Error(`forceDelete: model '${modelName}' not found in dmmf`);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (client as any).$executeRawUnsafe(
            `DELETE FROM "${tableName}" WHERE id = $1`,
            where.id,
          );
        },
      },
    },
  }),
);

// -----------------------------------------------------------------------------
// Helper: model name from dmmf is PascalCase (Tenant), delegate is camelCase
// (tenant). Per modelli composti come "SystemRoleTemplate" -> "systemRoleTemplate".
// -----------------------------------------------------------------------------
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
