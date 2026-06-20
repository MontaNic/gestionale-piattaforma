import { Module } from '@nestjs/common';
import { StorageModule } from '@gestionale/platform';

import { DocumentiController } from './documenti.controller';
import { DocumentiService } from './documenti.service';

// DbService è @Global (da @gestionale/db/nest). StorageModule (graduato in
// @gestionale/platform) fornisce il token StorageService per gli upload/download.
@Module({
  imports: [StorageModule],
  providers: [DocumentiService],
  controllers: [DocumentiController],
  exports: [DocumentiService],
})
export class DocumentiModule {}
