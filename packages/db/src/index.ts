// =============================================================================
// @gestionale/db — Prisma data layer per il monorepo Gestionale
// =============================================================================
// Stub iniziale: re-export del client Prisma generato. La extension client-side
// per soft-delete (where automatico su deleted_at IS NULL + delete -> update)
// e il helper uuidv7 wrapper verranno aggiunti nel prossimo macro-task.
// Vedi ADR-0005 per il piano completo.

export { PrismaClient, Prisma } from '@prisma/client';
