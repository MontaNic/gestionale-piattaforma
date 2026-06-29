import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateTableDto {
  @IsOptional()
  @IsString({ message: 'E_TABLE_NUMERO_INVALID' })
  @MinLength(1, { message: 'E_TABLE_NUMERO_REQUIRED' })
  @MaxLength(50, { message: 'E_TABLE_NUMERO_TOO_LONG' })
  numero?: string;

  @IsOptional()
  @IsInt({ message: 'E_TABLE_CAPIENZA_INVALID' })
  @Min(1, { message: 'E_TABLE_CAPIENZA_INVALID' })
  capienza?: number;

  // posX/posY inclusi nell'update: il drag-drop persiste la posizione via lo
  // stesso PATCH /tables/:id (no endpoint dedicato position — YAGNI, ADR-0058).
  @IsOptional()
  @IsNumber({}, { message: 'E_TABLE_POS_INVALID' })
  posX?: number;

  @IsOptional()
  @IsNumber({}, { message: 'E_TABLE_POS_INVALID' })
  posY?: number;
}
