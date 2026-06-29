// =============================================================================
// ai.module.ts — feature AI trasversale (ADR-0056)
// =============================================================================
// GroqService è esportato per l'iniezione in altri moduli (ComunicazioniModule
// → bozza risposta). ConfigService è globale (ConfigModule.forRoot in
// app.module): nessun import esplicito necessario.
// =============================================================================

import { Module } from '@nestjs/common';

import { AiController } from './ai.controller';
import { GroqService } from './groq.service';

@Module({
  providers: [GroqService],
  controllers: [AiController],
  exports: [GroqService],
})
export class AiModule {}
