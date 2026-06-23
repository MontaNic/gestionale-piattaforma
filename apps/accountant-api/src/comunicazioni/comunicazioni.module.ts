import { Module } from '@nestjs/common';

import { StorageModule } from '@gestionale/platform';

import { ComunicazioniController } from './comunicazioni.controller';
import { ComunicazioniService } from './comunicazioni.service';
import { PortaleComunicazioniController } from './portale-comunicazioni.controller';

// DbService è @Global (da @gestionale/db/nest). StorageModule importato per il
// token astratto StorageService (allegati). Due controller sullo stesso service:
// studio (operatore, /comunicazioni) + portale (cliente, /portale/comunicazioni,
// ADR-0047).
@Module({
  imports: [StorageModule],
  providers: [ComunicazioniService],
  controllers: [ComunicazioniController, PortaleComunicazioniController],
  exports: [ComunicazioniService],
})
export class ComunicazioniModule {}
