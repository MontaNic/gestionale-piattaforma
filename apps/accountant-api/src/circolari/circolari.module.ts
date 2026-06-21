import { Module } from '@nestjs/common';

import { CircolariController } from './circolari.controller';
import { CircolariService } from './circolari.service';

// DbService è @Global (da @gestionale/db/nest). Nessuno StorageModule: l'MVP
// circolari non gestisce allegati (broadcast testo-only, ADR-0045).
@Module({
  providers: [CircolariService],
  controllers: [CircolariController],
  exports: [CircolariService],
})
export class CircolariModule {}
