// =============================================================================
// update-prestazione.dto.ts — Body PATCH /mandati/:id/prestazioni/:pid (ADR-0053)
// =============================================================================
// PartialType-like manuale: tutti i campi opzionali. Nessun guard `in_corso`
// sull'update (le correzioni restano possibili anche a mandato concluso).
// =============================================================================

import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdatePrestazioneDto {
  @IsOptional()
  @IsDateString({}, { message: 'E_PRESTAZIONE_DATA_INVALID' })
  data?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_PRESTAZIONE_ORE_INVALID' })
  @Min(0, { message: 'E_PRESTAZIONE_ORE_INVALID' })
  ore?: number;

  @IsOptional()
  @IsString({ message: 'E_PRESTAZIONE_DESCRIZIONE_INVALID' })
  @MinLength(1, { message: 'E_PRESTAZIONE_DESCRIZIONE_REQUIRED' })
  @MaxLength(500, { message: 'E_PRESTAZIONE_DESCRIZIONE_TOO_LONG' })
  descrizione?: string;

  @IsOptional()
  @IsBoolean({ message: 'E_PRESTAZIONE_FATTURABILE_INVALID' })
  fatturabile?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_PRESTAZIONE_IMPORTO_INVALID' })
  @Min(0, { message: 'E_PRESTAZIONE_IMPORTO_INVALID' })
  importo?: number;

  @IsOptional()
  @IsUUID('all', { message: 'E_PRESTAZIONE_VOCE_ID_INVALID' })
  voceId?: string;

  @IsOptional()
  @IsString({ message: 'E_PRESTAZIONE_NOTE_INVALID' })
  @MaxLength(2000, { message: 'E_PRESTAZIONE_NOTE_TOO_LONG' })
  note?: string;
}
