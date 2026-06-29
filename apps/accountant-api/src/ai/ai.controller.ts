// =============================================================================
// ai.controller.ts — stato feature AI (ADR-0056)
// =============================================================================
// GET /ai/status è PUBBLICO (@Public): il FE lo interroga per decidere se
// mostrare il bottone "Suggerisci risposta". Non espone segreti — solo il
// booleano derivato dall'esistenza della key. Prefisso /api/v1 da main.ts.
// =============================================================================

import { Controller, Get, Inject } from '@nestjs/common';

import { Public } from '@gestionale/auth';

import { GroqService } from './groq.service';

@Controller('ai')
export class AiController {
  constructor(@Inject(GroqService) private readonly groq: GroqService) {}

  @Public()
  @Get('status')
  status(): { aiEnabled: boolean } {
    return { aiEnabled: this.groq.isAvailable() };
  }
}
