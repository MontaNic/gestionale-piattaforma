import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateMenuCategoryDto {
  @IsOptional()
  @IsString({ message: 'E_MENU_CATEGORY_NAME_INVALID' })
  @MinLength(2, { message: 'E_MENU_CATEGORY_NAME_TOO_SHORT' })
  @MaxLength(100, { message: 'E_MENU_CATEGORY_NAME_TOO_LONG' })
  name?: string;

  @IsOptional()
  @IsInt({ message: 'E_MENU_CATEGORY_SORT_ORDER_INVALID' })
  @Min(0, { message: 'E_MENU_CATEGORY_SORT_ORDER_INVALID' })
  sortOrder?: number;
}
