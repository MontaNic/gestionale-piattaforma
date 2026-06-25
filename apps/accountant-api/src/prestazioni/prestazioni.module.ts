// =============================================================================
// prestazioni.module.ts — Timesheet / Prestazioni (ADR-0053, Onda 3 Task 3)
// =============================================================================
// DbService è @Global (da @gestionale/db/nest): nessun import esplicito.
// =============================================================================

import { Module } from '@nestjs/common';

import { PrestazioniController } from './prestazioni.controller';
import { PrestazioniService } from './prestazioni.service';

@Module({
  providers: [PrestazioniService],
  controllers: [PrestazioniController],
  exports: [PrestazioniService],
})
export class PrestazioniModule {}
