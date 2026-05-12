import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [DbModule, HealthModule],
  controllers: [AppController],
})
export class AppModule {}
