import { Module } from '@nestjs/common';

import { UsersModule } from '@gestionale/auth';

import { MeController } from './me.controller';

@Module({
  imports: [UsersModule],
  controllers: [MeController],
})
export class MeModule {}
