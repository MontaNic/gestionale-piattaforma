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
//
// La extension `softDeleteExtension` (auto-detect modelli con `deletedAt`,
// forceDelete via $executeRawUnsafe, escape semantics) e' applicata
// automaticamente al client. Dettagli: ./soft-delete.ts + ADR-0005.

import { PrismaClient, Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

import { softDeleteExtension } from './soft-delete';

/**
 * Genera un UUID v7 (ordinabile per tempo di creazione). Pattern obbligatorio
 * per tutti gli `id` dello schema — passare a `prisma.<model>.create({ data: {
 * id: id(), ... } })`. Omettere `id` provoca errore Prisma (no `@default`).
 */
export const id = (): string => uuidv7();

export { uuidv7 };

/**
 * Crea una nuova istanza PrismaClient con la `softDeleteExtension` applicata.
 * Usare per dependency injection (NestJS) o test isolati. Per script one-off
 * e codice applicativo "shared" preferire il singleton `prisma` esportato.
 */
export const createPrismaClient = () => new PrismaClient().$extends(softDeleteExtension);

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

export { PrismaClient, Prisma };
