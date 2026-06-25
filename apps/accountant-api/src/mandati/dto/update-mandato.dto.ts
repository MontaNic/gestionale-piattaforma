// =============================================================================
// update-mandato.dto.ts — Body PATCH /mandati/:id (ADR-0051)
// =============================================================================
// La creazione NON ha body (POST /preventivi/:id/mandato, dati snapshot dal
// preventivo). L'update tocca solo stato / date / note (mai codice / preventivoId
// / importoConcordato — snapshot immutabile). PartialType-like manuale.
// =============================================================================

import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { StatoMandato } from '@gestionale/db';

export class UpdateMandatoDto {
  @IsOptional()
  @IsEnum(StatoMandato, { message: 'E_MANDATO_STATO_INVALID' })
  stato?: StatoMandato;

  @IsOptional()
  @IsDateString({}, { message: 'E_MANDATO_INIZIO_INVALID' })
  inizio?: string;

  @IsOptional()
  @IsDateString({}, { message: 'E_MANDATO_FINE_PREVISTA_INVALID' })
  finePrevista?: string;

  @IsOptional()
  @IsDateString({}, { message: 'E_MANDATO_FINE_EFFETTIVA_INVALID' })
  fineEffettiva?: string;

  @IsOptional()
  @IsString({ message: 'E_MANDATO_NOTE_INVALID' })
  @MaxLength(2000, { message: 'E_MANDATO_NOTE_TOO_LONG' })
  note?: string;
}
