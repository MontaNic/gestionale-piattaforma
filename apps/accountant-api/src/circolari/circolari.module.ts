import { Module } from '@nestjs/common';

import { CircolariController } from './circolari.controller';
import { CircolariService } from './circolari.service';
import { PortaleCircolariController } from './portale-circolari.controller';

// DbService è @Global (da @gestionale/db/nest). Nessuno StorageModule: l'MVP
// circolari non gestisce allegati (broadcast testo-only, ADR-0045). Due controller
// sullo stesso service: studio (operatore, /circolari) + portale (cliente,
// /portale/circolari, ADR-0048).
@Module({
  providers: [CircolariService],
  controllers: [CircolariController, PortaleCircolariController],
  exports: [CircolariService],
})
export class CircolariModule {}
