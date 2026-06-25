// =============================================================================
// create-prestazione.dto.ts — Body POST /mandati/:id/prestazioni (ADR-0053)
// =============================================================================
// `userId` NON è nel DTO: assegnato server-side all'utente autenticato (autore).
// `ore` obbligatorio; `importo` manuale opzionale (nessun calcolo automatico).
// `voceId` opzionale → voce del preventivo del mandato (validata nel service).
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

export class CreatePrestazioneDto {
  @IsDateString({}, { message: 'E_PRESTAZIONE_DATA_INVALID' })
  data!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_PRESTAZIONE_ORE_INVALID' })
  @Min(0, { message: 'E_PRESTAZIONE_ORE_INVALID' })
  ore!: number;

  @IsString({ message: 'E_PRESTAZIONE_DESCRIZIONE_INVALID' })
  @MinLength(1, { message: 'E_PRESTAZIONE_DESCRIZIONE_REQUIRED' })
  @MaxLength(500, { message: 'E_PRESTAZIONE_DESCRIZIONE_TOO_LONG' })
  descrizione!: string;

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
