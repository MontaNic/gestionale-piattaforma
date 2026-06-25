// =============================================================================
// report.module.ts — Report analitici (ADR-0054, Onda 3 Task 4)
// =============================================================================
// DbService è @Global (da @gestionale/db/nest): nessun import esplicito.
// Primo endpoint: /report/margine. Host per futuri report.
// =============================================================================

import { Module } from '@nestjs/common';

import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  providers: [ReportService],
  controllers: [ReportController],
  exports: [ReportService],
})
export class ReportModule {}
