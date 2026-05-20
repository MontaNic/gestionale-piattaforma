import { Module } from '@nestjs/common';

import { PriceListsController } from './price-lists.controller';
import { PriceListsService } from './price-lists.service';

@Module({
  providers: [PriceListsService],
  controllers: [PriceListsController],
  exports: [PriceListsService],
})
export class PriceListsModule {}
