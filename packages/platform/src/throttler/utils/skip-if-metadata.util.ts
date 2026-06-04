import type { ExecutionContext } from '@nestjs/common';

// =============================================================================
// skip-if-metadata.util.ts — Higher-order skipIf builder (B1 STOP 1)
// =============================================================================
// Pattern opt-in via metadata flag (vedi throttler.module.ts):
// - Throttler `auth-strict` e `tenant-create` registrati globalmente con
//   `skipIf` che ritorna `true` (skip) a meno che l'handler/class non abbia
//   il metadata flag attivato.
// - Custom decorator (@AuthStrict, @TenantCreate) applica SetMetadata che
//   attiva il throttler solo dove serve.
//
// Estratto come utility testabile in isolation (no ThrottlerModule.forRoot
// instantiation richiesta nei test).
// =============================================================================

/**
 * Factory: ritorna una callback `skipIf` compatibile con @nestjs/throttler.
 *
 * @param metadataKey chiave Reflect.metadata da cercare su handler/class
 * @returns callback che ritorna `true` (skip throttler) quando metadata
 *   NON e' attivo, `false` (esegui throttler) quando metadata flag e' `true`.
 */
export const skipIfMetadataAbsent =
  (metadataKey: string) =>
  (ctx: ExecutionContext): boolean => {
    const handler = ctx.getHandler();
    const cls = ctx.getClass();
    const hasFlag =
      Reflect.getMetadata(metadataKey, handler) === true ||
      Reflect.getMetadata(metadataKey, cls) === true;
    return !hasFlag;
  };
