// =============================================================================
// db.module.ts — Provider centralizzato del Prisma client
// =============================================================================
// @Global() rende DbService disponibile in qualsiasi modulo senza re-import.
// Lifecycle gestito da NestJS: $connect su init, $disconnect su destroy
// (vedi DbService + ADR-0007 decisione E).
// =============================================================================

import { Global, Module } from '@nestjs/common';

import { DbService } from './db.service';

@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
