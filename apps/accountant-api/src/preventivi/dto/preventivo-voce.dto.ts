import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { UnitaMisura } from '@gestionale/db';

// Voce annidata nel payload del preventivo. totaleRiga NON è input (server-calc).
export class PreventivoVoceDto {
  @IsString({ message: 'E_PREVENTIVO_VOCE_NOME_INVALID' })
  @MinLength(1, { message: 'E_PREVENTIVO_VOCE_NOME_REQUIRED' })
  @MaxLength(180, { message: 'E_PREVENTIVO_VOCE_NOME_TOO_LONG' })
  nome!: string;

  @IsOptional()
  @IsString({ message: 'E_PREVENTIVO_VOCE_DESCRIZIONE_INVALID' })
  descrizione?: string;

  @IsEnum(UnitaMisura, { message: 'E_PREVENTIVO_VOCE_UNITA_INVALID' })
  unitaMisura!: UnitaMisura;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_PREVENTIVO_VOCE_QUANTITA_INVALID' })
  @Min(0, { message: 'E_PREVENTIVO_VOCE_QUANTITA_INVALID' })
  quantita!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_PREVENTIVO_VOCE_PREZZO_INVALID' })
  @Min(0, { message: 'E_PREVENTIVO_VOCE_PREZZO_INVALID' })
  prezzoUnitario!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_PREVENTIVO_VOCE_SCONTO_INVALID' })
  @Min(0, { message: 'E_PREVENTIVO_VOCE_SCONTO_INVALID' })
  @Max(100, { message: 'E_PREVENTIVO_VOCE_SCONTO_INVALID' })
  scontoPct!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_PREVENTIVO_VOCE_IVA_INVALID' })
  @Min(0, { message: 'E_PREVENTIVO_VOCE_IVA_INVALID' })
  @Max(100, { message: 'E_PREVENTIVO_VOCE_IVA_INVALID' })
  ivaAliquota!: number;

  @IsOptional()
  @IsInt({ message: 'E_PREVENTIVO_VOCE_ORDINE_INVALID' })
  @Min(0, { message: 'E_PREVENTIVO_VOCE_ORDINE_INVALID' })
  ordine?: number;

  @IsOptional()
  @IsString({ message: 'E_PREVENTIVO_VOCE_NOTE_INVALID' })
  @MaxLength(255, { message: 'E_PREVENTIVO_VOCE_NOTE_TOO_LONG' })
  note?: string;
}
