import { Module } from '@nestjs/common';

import { ReferentiController } from './referenti.controller';
import { ReferentiService } from './referenti.service';

// DbService è @Global (da @gestionale/db/nest): nessun import esplicito.
@Module({
  providers: [ReferentiService],
  controllers: [ReferentiController],
  exports: [ReferentiService],
})
export class ReferentiModule {}
