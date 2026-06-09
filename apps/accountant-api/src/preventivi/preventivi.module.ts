import { Module } from '@nestjs/common';

import { PreventiviController } from './preventivi.controller';
import { PreventiviService } from './preventivi.service';

// DbService è @Global (da @gestionale/db/nest): nessun import esplicito.
@Module({
  providers: [PreventiviService],
  controllers: [PreventiviController],
  exports: [PreventiviService],
})
export class PreventiviModule {}
