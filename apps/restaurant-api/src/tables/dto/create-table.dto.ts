import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTableDto {
  @IsString({ message: 'E_TABLE_NUMERO_INVALID' })
  @MinLength(1, { message: 'E_TABLE_NUMERO_REQUIRED' })
  @MaxLength(50, { message: 'E_TABLE_NUMERO_TOO_LONG' })
  numero!: string;

  @IsInt({ message: 'E_TABLE_CAPIENZA_INVALID' })
  @Min(1, { message: 'E_TABLE_CAPIENZA_INVALID' })
  capienza!: number;

  @IsOptional()
  @IsNumber({}, { message: 'E_TABLE_POS_INVALID' })
  posX?: number;

  @IsOptional()
  @IsNumber({}, { message: 'E_TABLE_POS_INVALID' })
  posY?: number;
}
