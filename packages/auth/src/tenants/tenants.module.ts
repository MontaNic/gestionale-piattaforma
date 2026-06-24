import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [UsersModule], // UsersService.hasPermission DI per permission check
  providers: [TenantsService],
  controllers: [TenantsController],
  // Esportato per riuso del bootstrap tenant dal modulo platform (superadmin Task 3).
  exports: [TenantsService],
})
export class TenantsModule {}
