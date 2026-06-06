import { Module } from '@nestjs/common';

import { MenuCategoriesController } from './menu-categories.controller';
import { MenuCategoriesService } from './menu-categories.service';

@Module({
  providers: [MenuCategoriesService],
  controllers: [MenuCategoriesController],
  exports: [MenuCategoriesService],
})
export class MenuCategoriesModule {}
