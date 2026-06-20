import { Module } from '@nestjs/common';

import { ComunicazioniController } from './comunicazioni.controller';
import { ComunicazioniService } from './comunicazioni.service';
import { StorageModule } from '../storage/storage.module';

// DbService è @Global (da @gestionale/db/nest). StorageModule importato per il
// token astratto StorageService (allegati).
@Module({
  imports: [StorageModule],
  providers: [ComunicazioniService],
  controllers: [ComunicazioniController],
  exports: [ComunicazioniService],
})
export class ComunicazioniModule {}
