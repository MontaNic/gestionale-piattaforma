import { Module } from '@nestjs/common';

import { TenantsModule } from '@gestionale/auth';

import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformGuard } from './guards/platform.guard';

// TenantsModule importato per iniettare TenantsService (riuso del bootstrap
// tenant atomico in PlatformService.createTenant). DbService @Global.
@Module({
  imports: [TenantsModule],
  providers: [PlatformService, PlatformGuard],
  controllers: [PlatformController],
})
export class PlatformModule {}
