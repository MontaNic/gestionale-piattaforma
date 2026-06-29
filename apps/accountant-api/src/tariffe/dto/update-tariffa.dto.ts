// =============================================================================
// update-tariffa.dto.ts — Body PATCH /tariffe/:id (ADR-0055, Onda 4 Task 3b)
// =============================================================================
// Lo SCOPE è immutabile (cambiare ruolo/utente = soft-delete + nuova tariffa):
// si modificano solo importo orario, stato attivo e note.
// =============================================================================

import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateTariffaDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_TARIFFA_ORARIA_INVALID' })
  @Min(0, { message: 'E_TARIFFA_ORARIA_INVALID' })
  tariffaOraria?: number;

  @IsOptional()
  @IsBoolean({ message: 'E_TARIFFA_ATTIVO_INVALID' })
  attivo?: boolean;

  @IsOptional()
  @IsString({ message: 'E_TARIFFA_NOTE_INVALID' })
  @MaxLength(2000, { message: 'E_TARIFFA_NOTE_TOO_LONG' })
  note?: string;
}
