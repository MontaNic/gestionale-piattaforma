import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StatoPreventivo } from '@gestionale/db';
import { PreventivoVoceDto } from './preventivo-voce.dto';

export class CreatePreventivoDto {
  @IsString({ message: 'E_PREVENTIVO_CODICE_INVALID' })
  @MinLength(1, { message: 'E_PREVENTIVO_CODICE_REQUIRED' })
  @MaxLength(32, { message: 'E_PREVENTIVO_CODICE_TOO_LONG' })
  codice!: string;

  @IsString({ message: 'E_PREVENTIVO_OGGETTO_INVALID' })
  @MinLength(1, { message: 'E_PREVENTIVO_OGGETTO_REQUIRED' })
  @MaxLength(200, { message: 'E_PREVENTIVO_OGGETTO_TOO_LONG' })
  oggetto!: string;

  @IsOptional()
  @IsString({ message: 'E_PREVENTIVO_COVER_INVALID' })
  coverLetter?: string;

  @IsOptional()
  @IsString({ message: 'E_PREVENTIVO_NOTE_INVALID' })
  noteInterne?: string;

  @IsOptional()
  @IsEnum(StatoPreventivo, { message: 'E_PREVENTIVO_STATO_INVALID' })
  stato?: StatoPreventivo;

  @IsOptional()
  @IsString({ message: 'E_PREVENTIVO_VALIDO_FINO_INVALID' })
  validoFino?: string; // ISO date string; il service la converte a Date

  @IsArray({ message: 'E_PREVENTIVO_VOCI_INVALID' })
  @ArrayMinSize(1, { message: 'E_PREVENTIVO_VOCI_REQUIRED' })
  @ValidateNested({ each: true })
  @Type(() => PreventivoVoceDto)
  voci!: PreventivoVoceDto[];
}
