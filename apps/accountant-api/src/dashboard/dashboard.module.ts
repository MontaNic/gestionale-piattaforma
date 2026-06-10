import { Module } from '@nestjs/common';

import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// DbService e' @Global (da @gestionale/db/nest): nessun import esplicito.
@Module({
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
