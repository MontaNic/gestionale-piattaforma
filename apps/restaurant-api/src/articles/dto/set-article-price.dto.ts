import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * POST /articles/:articleId/prices — upsert price per (article, priceList).
 * Audit action: 'article_price.set' (create or update).
 */
export class SetArticlePriceDto {
  @IsUUID('all', { message: 'E_ARTICLE_PRICE_LIST_ID_INVALID' })
  priceListId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_ARTICLE_PRICE_INVALID' })
  @Min(0, { message: 'E_ARTICLE_PRICE_INVALID' })
  @Type(() => Number)
  price!: number;
}

/**
 * PATCH /articles/:articleId/prices/:id — update price by ArticlePrice.id.
 */
export class UpdateArticlePriceDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_ARTICLE_PRICE_INVALID' })
  @Min(0, { message: 'E_ARTICLE_PRICE_INVALID' })
  @Type(() => Number)
  price?: number;
}
