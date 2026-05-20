import {
  ArticleAvailability,
  Allergen,
  Channel,
  DietaryTag,
  PrintDepartment,
} from '@gestionale/db';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const VAT_RATES = [4, 10, 22] as const;

export class UpdateArticleDto {
  @IsOptional()
  @IsUUID('all', { message: 'E_ARTICLE_CATEGORY_ID_INVALID' })
  categoryId?: string;

  @IsOptional()
  @IsString({ message: 'E_ARTICLE_NAME_INVALID' })
  @MinLength(2, { message: 'E_ARTICLE_NAME_TOO_SHORT' })
  @MaxLength(120, { message: 'E_ARTICLE_NAME_TOO_LONG' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'E_ARTICLE_DESCRIPTION_SHORT_INVALID' })
  @MinLength(1, { message: 'E_ARTICLE_DESCRIPTION_SHORT_REQUIRED' })
  @MaxLength(200, { message: 'E_ARTICLE_DESCRIPTION_SHORT_TOO_LONG' })
  descriptionShort?: string;

  @IsOptional()
  @IsString({ message: 'E_ARTICLE_DESCRIPTION_LONG_INVALID' })
  @MaxLength(2000, { message: 'E_ARTICLE_DESCRIPTION_LONG_TOO_LONG' })
  descriptionLong?: string;

  @IsOptional()
  @IsString({ message: 'E_ARTICLE_PHOTO_URL_INVALID' })
  @MaxLength(500, { message: 'E_ARTICLE_PHOTO_URL_TOO_LONG' })
  photoUrl?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_ARTICLE_BASE_PRICE_INVALID' })
  @Min(0, { message: 'E_ARTICLE_BASE_PRICE_INVALID' })
  @Type(() => Number)
  basePrice?: number;

  @IsOptional()
  @IsInt({ message: 'E_ARTICLE_VAT_INVALID' })
  @IsIn(VAT_RATES as unknown as number[], { message: 'E_ARTICLE_VAT_INVALID' })
  vatPercent?: number;

  @IsOptional()
  @IsArray({ message: 'E_ARTICLE_ALLERGENS_INVALID' })
  @ArrayUnique({ message: 'E_ARTICLE_ALLERGENS_INVALID' })
  @IsEnum(Allergen, { each: true, message: 'E_ARTICLE_ALLERGENS_INVALID' })
  allergens?: Allergen[];

  @IsOptional()
  @IsArray({ message: 'E_ARTICLE_DIETARY_TAGS_INVALID' })
  @ArrayUnique({ message: 'E_ARTICLE_DIETARY_TAGS_INVALID' })
  @IsEnum(DietaryTag, { each: true, message: 'E_ARTICLE_DIETARY_TAGS_INVALID' })
  dietaryTags?: DietaryTag[];

  @IsOptional()
  @IsEnum(PrintDepartment, { message: 'E_ARTICLE_PRINT_DEPARTMENT_INVALID' })
  printDepartment?: PrintDepartment;

  @IsOptional()
  @IsInt({ message: 'E_ARTICLE_PREP_TIME_INVALID' })
  @Min(0, { message: 'E_ARTICLE_PREP_TIME_INVALID' })
  preparationTimeMinutes?: number;

  @IsOptional()
  @IsEnum(ArticleAvailability, { message: 'E_ARTICLE_AVAILABILITY_INVALID' })
  availability?: ArticleAvailability;

  @IsOptional()
  @IsInt({ message: 'E_ARTICLE_SORT_ORDER_INVALID' })
  @Min(0, { message: 'E_ARTICLE_SORT_ORDER_INVALID' })
  sortOrder?: number;

  @IsOptional()
  @IsArray({ message: 'E_ARTICLE_CHANNEL_VISIBILITY_INVALID' })
  @ArrayUnique({ message: 'E_ARTICLE_CHANNEL_VISIBILITY_INVALID' })
  @IsEnum(Channel, { each: true, message: 'E_ARTICLE_CHANNEL_VISIBILITY_INVALID' })
  channelVisibility?: Channel[];
}
