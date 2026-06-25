// =============================================================================
// catalogo.module.ts — Catalogo servizi (ADR-0050, Onda 3 Task 1)
// =============================================================================
// DbService è @Global (da @gestionale/db/nest): nessun import esplicito.
// Esporta CatalogoService per eventuale riuso (es. validazione servizioId).
// =============================================================================

import { Module } from '@nestjs/common';

import { CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';

@Module({
  providers: [CatalogoService],
  controllers: [CatalogoController],
  exports: [CatalogoService],
})
export class CatalogoModule {}
