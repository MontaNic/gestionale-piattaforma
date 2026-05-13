import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [UsersModule], // UsersService.hasPermission DI per permission check
  providers: [TenantsService],
  controllers: [TenantsController],
})
export class TenantsModule {}
