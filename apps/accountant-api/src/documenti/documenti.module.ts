import { Module } from '@nestjs/common';
import { StorageModule } from '@gestionale/platform';

import { DocumentiController } from './documenti.controller';
import { DocumentiService } from './documenti.service';
import { PortaleDocumentiController } from './portale-documenti.controller';

// DbService è @Global (da @gestionale/db/nest). StorageModule (graduato in
// @gestionale/platform) fornisce il token StorageService per gli upload/download.
// Due controller sullo stesso service: studio (operatore, /documenti) + portale
// (cliente read-only, /portale/documenti, ADR-0046).
@Module({
  imports: [StorageModule],
  providers: [DocumentiService],
  controllers: [DocumentiController, PortaleDocumentiController],
  exports: [DocumentiService],
})
export class DocumentiModule {}
