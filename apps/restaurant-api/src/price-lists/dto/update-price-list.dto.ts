import { Channel } from '@gestionale/db';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdatePriceListDto {
  @IsOptional()
  @IsString({ message: 'E_PRICE_LIST_NAME_INVALID' })
  @MinLength(2, { message: 'E_PRICE_LIST_NAME_TOO_SHORT' })
  @MaxLength(100, { message: 'E_PRICE_LIST_NAME_TOO_LONG' })
  name?: string;

  @IsOptional()
  @IsArray({ message: 'E_PRICE_LIST_CHANNELS_INVALID' })
  @ArrayMinSize(1, { message: 'E_PRICE_LIST_CHANNELS_REQUIRED' })
  @ArrayUnique({ message: 'E_PRICE_LIST_CHANNELS_INVALID' })
  @IsEnum(Channel, { each: true, message: 'E_PRICE_LIST_CHANNELS_INVALID' })
  channels?: Channel[];

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'E_PRICE_LIST_VALID_FROM_INVALID' })
  validFromDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'E_PRICE_LIST_VALID_TO_INVALID' })
  validToDate?: Date;

  @IsOptional()
  @IsInt({ message: 'E_PRICE_LIST_PRIORITY_INVALID' })
  @Min(0, { message: 'E_PRICE_LIST_PRIORITY_INVALID' })
  priority?: number;

  @IsOptional()
  @IsBoolean({ message: 'E_PRICE_LIST_IS_ACTIVE_INVALID' })
  isActive?: boolean;
}
