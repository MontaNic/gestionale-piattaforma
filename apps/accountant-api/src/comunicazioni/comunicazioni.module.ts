import { Module } from '@nestjs/common';

import { StorageModule } from '@gestionale/platform';

import { ComunicazioniController } from './comunicazioni.controller';
import { ComunicazioniService } from './comunicazioni.service';

// DbService è @Global (da @gestionale/db/nest). StorageModule importato per il
// token astratto StorageService (allegati).
@Module({
  imports: [StorageModule],
  providers: [ComunicazioniService],
  controllers: [ComunicazioniController],
  exports: [ComunicazioniService],
})
export class ComunicazioniModule {}
