import { Module } from '@nestjs/common';

import { ScadenzeController } from './scadenze.controller';
import { ScadenzeService } from './scadenze.service';

// DbService è @Global (da @gestionale/db/nest): nessun import esplicito.
@Module({
  providers: [ScadenzeService],
  controllers: [ScadenzeController],
  exports: [ScadenzeService],
})
export class ScadenzeModule {}
