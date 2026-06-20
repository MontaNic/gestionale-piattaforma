// =============================================================================
// @gestionale/db — Prisma data layer entrypoint
// =============================================================================
// Esporta:
// - `id()` helper per UUID v7 (vedi ADR-0005 decisione 2: id obbligatorio in
//   ogni create, forziamo app-side per sortability + cross-DB portability)
// - `uuidv7` raw re-export per uso diretto
// - `createPrismaClient()` factory (per NestJS DI / test isolati)
// - `prisma` singleton lazy (istanza eager, connessione DB lazy — vedi ADR-0005)
// - `PrismaClient`, `Prisma` re-export per consumer che servono i tipi base
// - RLS API: `runInTenantContext`, `withSystemContext`, `withSuperAdminContext`,
//   `getTenantContext`, `TenantContext`, `RlsNoContextError` (vedi ADR-0009)
//
// Extension chain applicata al client:
// 1. `softDeleteExtension` — auto-detect modelli con `deletedAt`, escape
//    semantics, forceDelete via $executeRawUnsafe (./soft-delete.ts + ADR-0005)
// 2. `rlsExtension` — wrappa ogni query in $transaction interactive con
//    SET LOCAL app.tenant_id / app.is_super_admin (./rls.ts + ADR-0009).
//    OUTER: intercetta prima di softDelete, propaga il context a tutta la
//    catena. Per-operation tx (pattern S2, decisione 1 ADR-0009).

import { PrismaClient, Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

import { rlsExtension } from './rls';
import type { TenantContext } from './rls';
import { softDeleteExtension } from './soft-delete';

/**
 * Genera un UUID v7 (ordinabile per tempo di creazione). Pattern obbligatorio
 * per tutti gli `id` dello schema — passare a `prisma.<model>.create({ data: {
 * id: id(), ... } })`. Omettere `id` provoca errore Prisma (no `@default`).
 */
export const id = (): string => uuidv7();

export { uuidv7 };

/**
 * Crea una nuova istanza PrismaClient con la extension chain completa:
 * `softDeleteExtension` + `rlsExtension`. Usare per dependency injection
 * (NestJS) o test isolati. Per script one-off e codice applicativo "shared"
 * preferire il singleton `prisma` esportato.
 *
 * IMPORTANTE: ogni query Prisma su questo client lancia `RlsNoContextError`
 * se chiamata fuori da `runInTenantContext` / `withSystemContext` /
 * `withSuperAdminContext`. Fail-fast by design (ADR-0009 decisione 11).
 */
export const createPrismaClient = () =>
  new PrismaClient().$extends(softDeleteExtension).$extends(rlsExtension());

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * Singleton istanza Prisma con soft-delete extension applicata.
 *
 * - Istanziato eagerly al primo import del modulo (costo memoria trascurabile)
 * - La connessione TCP al DB e' comunque lazy: Prisma apre la pool solo alla
 *   prima query (vedi ADR-0005)
 *
 * Preferire `createPrismaClient()` factory dove serve isolamento (test,
 * NestJS DI). Importare `prisma` qui per script seed / smoke / utility.
 */
export const prisma: ExtendedPrismaClient = createPrismaClient();

/**
 * Indirezione tenant→client (ADR-0026 §D3 fase 1).
 *
 * FASE 1 (attuale): ritorna SEMPRE l'unico client condiviso, ignorando `ctx`.
 * È un seam additivo che prepara il routing multi-DB senza cambiarlo ora —
 * nessun consumer è ancora rewirato (adozione = fase 2 / passo meccanico).
 *
 * La risoluzione del routing-key (slug→tenant→{mode,connString}) NON vive qui:
 * appartiene al layer tenancy (oggi i lookup in `@gestionale/auth`, futuro
 * `packages/tenancy`), che passa un `ctx` già risolto. `packages/db` lo CONSUMA.
 * Vedi ADR-0026 §D4 (ownership) — addendum 8b-2.
 *
 * @param _ctx contesto tenant (riservato fase 2; ignorato in fase 1)
 */
export function getClientForTenant(_ctx: TenantContext): ExtendedPrismaClient {
  return prisma;
}

export { PrismaClient, Prisma };

// -----------------------------------------------------------------------------
// Domain enum re-exports (consumer-friendly, no direct @prisma/client dep)
// -----------------------------------------------------------------------------
// Pattern: i package consumer (apps/restaurant-api, future apps/restaurant-web SSR) non dichiarano
// @prisma/client come dep diretta — accedono ai tipi/valori via @gestionale/db.
// Le enum Prisma sono sia valore (runtime, per IsEnum class-validator) sia
// tipo. Re-export named per supportare entrambi gli usi.
//
// Quando aggiungi un nuovo enum a schema.prisma, aggiungilo qui per renderlo
// disponibile cross-package senza bumpare dep root.
// -----------------------------------------------------------------------------

export {
  DeviceType,
  Allergen,
  DietaryTag,
  PrintDepartment,
  ArticleAvailability,
  Channel,
  TipoCliente,
  RuoloReferente,
  StatoPreventivo,
  UnitaMisura,
  VisibilitaScadenza,
  ComApertura,
  ComLato,
  ComOrigine,
} from '@prisma/client';

// -----------------------------------------------------------------------------
// Domain model type re-exports (per annotare return type lato consumer e
// evitare TS2742 con tsconfig declaration:true). Tipi only (no runtime).
// -----------------------------------------------------------------------------

export type {
  Tenant,
  Sede,
  User,
  Role,
  Permission,
  SystemRoleTemplate,
  SystemRoleTemplatePermission,
  RolePermission,
  UserRole,
  Session,
  AuditLog,
  Menu,
  MenuCategory,
  Article,
  PriceList,
  ArticlePrice,
  Recipe,
  PricingRule,
  Azienda,
  Referente,
  Preventivo,
  PreventivoVoce,
  Scadenza,
  ScadenzaCategoria,
  Comunicazione,
  ComMessaggio,
  ComAllegato,
  ComCounter,
} from '@prisma/client';

// -----------------------------------------------------------------------------
// RLS API re-exports (ALS context + helpers + error type)
// -----------------------------------------------------------------------------

export {
  getTenantContext,
  runInTenantContext,
  withSystemContext,
  withSuperAdminContext,
  withSystemContextAtomicTx,
  withTenantContextAtomicTx,
  RLS_NO_CONTEXT,
  RlsNoContextError,
  RLS_PG_SETTING_TENANT,
  RLS_PG_SETTING_SUPER_ADMIN,
} from './rls';

export type { TenantContext } from './rls';
