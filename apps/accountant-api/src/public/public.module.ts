// =============================================================================
// public.module.ts — Superficie pubblica non autenticata (ADR-0049)
// =============================================================================
// Endpoint @Public() tenant-facing (landing /t/<slug>). Nessuna dipendenza da
// guard/permessi: la sicurezza è nel select esplicito + filtro attivo del
// service (vedi public.service.ts). Importato in app.module.ts.
// =============================================================================

import { Module } from '@nestjs/common';

import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
