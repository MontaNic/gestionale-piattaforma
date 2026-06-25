// =============================================================================
// mandati.module.ts — Mandati / Incarichi (ADR-0051, Onda 3 Task 2)
// =============================================================================
// DbService è @Global (da @gestionale/db/nest): nessun import esplicito.
// =============================================================================

import { Module } from '@nestjs/common';

import { MandatiController } from './mandati.controller';
import { MandatiService } from './mandati.service';

@Module({
  providers: [MandatiService],
  controllers: [MandatiController],
  exports: [MandatiService],
})
export class MandatiModule {}
