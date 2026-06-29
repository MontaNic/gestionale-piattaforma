// =============================================================================
// tariffe.module.ts — Tariffario orario (ADR-0055, Onda 4 Task 3b)
// =============================================================================
// DbService è @Global (da @gestionale/db/nest): nessun import esplicito.
// Esporta TariffeService → PrestazioniModule lo inietta per derivare l'importo.
// =============================================================================

import { Module } from '@nestjs/common';

import { TariffeController } from './tariffe.controller';
import { TariffeService } from './tariffe.service';

@Module({
  providers: [TariffeService],
  controllers: [TariffeController],
  exports: [TariffeService],
})
export class TariffeModule {}
