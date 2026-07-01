import type { ExtendedPrismaClient } from '@gestionale/db';

/**
 * Tipo del client transazionale ESTESO (soft-delete + RLS extension) esposto nel
 * callback di `withTenantContextAtomicTx`. `Prisma.TransactionClient` (base) NON
 * è assignabile: il client esteso ha metodi extra (es. `forceDelete`) e
 * `InternalArgs` diversi. L'`Omit` rimuove i soli metodi top-level-only (non
 * disponibili dentro una tx), lasciando i delegate dei modelli col tipo reale.
 */
export type TenantTx = Omit<
  ExtendedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
