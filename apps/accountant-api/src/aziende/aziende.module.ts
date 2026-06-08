import { Module } from '@nestjs/common';

import { AziendeController } from './aziende.controller';
import { AziendeService } from './aziende.service';

// DbService e' @Global (da @gestionale/db/nest): nessun import esplicito.
@Module({
  providers: [AziendeService],
  controllers: [AziendeController],
  exports: [AziendeService],
})
export class AziendeModule {}
