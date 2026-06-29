// =============================================================================
// create-tariffa.dto.ts — Body POST /tariffe (ADR-0055, Onda 4 Task 3b)
// =============================================================================
// Scope esclusivo: ESATTAMENTE uno tra `roleId` (tariffa-ruolo, default) e
// `userId` (override per-utente). Il vincolo XOR è validato nel service
// (E_TARIFFA_SCOPE_INVALID) e a livello DB (CHECK tariffe_orarie_scope_xor).
// =============================================================================

import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateTariffaDto {
  @IsOptional()
  @IsUUID('all', { message: 'E_TARIFFA_ROLE_ID_INVALID' })
  roleId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'E_TARIFFA_USER_ID_INVALID' })
  userId?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_TARIFFA_ORARIA_INVALID' })
  @Min(0, { message: 'E_TARIFFA_ORARIA_INVALID' })
  tariffaOraria!: number;

  @IsOptional()
  @IsString({ message: 'E_TARIFFA_NOTE_INVALID' })
  @MaxLength(2000, { message: 'E_TARIFFA_NOTE_TOO_LONG' })
  note?: string;
}
