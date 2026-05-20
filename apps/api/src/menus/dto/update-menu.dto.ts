import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateMenuDto {
  @IsOptional()
  @IsString({ message: 'E_MENU_NAME_INVALID' })
  @MinLength(2, { message: 'E_MENU_NAME_TOO_SHORT' })
  @MaxLength(100, { message: 'E_MENU_NAME_TOO_LONG' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'E_MENU_DESCRIPTION_INVALID' })
  @MaxLength(500, { message: 'E_MENU_DESCRIPTION_TOO_LONG' })
  description?: string;

  @IsOptional()
  @IsBoolean({ message: 'E_MENU_IS_ACTIVE_INVALID' })
  isActive?: boolean;

  @IsOptional()
  @IsInt({ message: 'E_MENU_SORT_ORDER_INVALID' })
  @Min(0, { message: 'E_MENU_SORT_ORDER_INVALID' })
  sortOrder?: number;
}
