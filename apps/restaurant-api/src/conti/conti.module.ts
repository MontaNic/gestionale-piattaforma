import { Module } from '@nestjs/common';

import { PricingModule } from '../pricing/pricing.module';
import { ContiController } from './conti.controller';
import { ContiService } from './conti.service';

@Module({
  imports: [PricingModule],
  providers: [ContiService],
  controllers: [ContiController],
})
export class ContiModule {}
