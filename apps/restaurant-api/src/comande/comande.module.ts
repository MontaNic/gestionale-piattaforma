import { Module } from '@nestjs/common';

import { ComandeController } from './comande.controller';
import { ComandeService } from './comande.service';

// Feed KDS + transizioni stato. DbService è globale (DbModule in app.module).
// L'invio comanda vive in ContiModule (opera sul conto): nessuna dipendenza incrociata.
@Module({
  providers: [ComandeService],
  controllers: [ComandeController],
})
export class ComandeModule {}
