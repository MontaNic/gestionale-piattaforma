import { Module } from '@nestjs/common';

import { ArticlePricesController } from './article-prices.controller';
import { ArticlePricesService } from './article-prices.service';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';

@Module({
  providers: [ArticlesService, ArticlePricesService],
  controllers: [ArticlesController, ArticlePricesController],
  exports: [ArticlesService, ArticlePricesService],
})
export class ArticlesModule {}
