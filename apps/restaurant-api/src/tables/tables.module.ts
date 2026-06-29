import { Module } from '@nestjs/common';

import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

@Module({
  providers: [TablesService],
  controllers: [TablesController],
  exports: [TablesService],
})
export class TablesModule {}
