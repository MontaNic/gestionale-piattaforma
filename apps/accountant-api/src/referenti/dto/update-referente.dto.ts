import { RuoloReferente } from '@gestionale/db';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// =============================================================================
// update-referente.dto.ts — tutti i campi opzionali (PATCH parziale)
// =============================================================================

export class UpdateReferenteDto {
  @IsOptional()
  @IsString({ message: 'E_REFERENTE_NOME_INVALID' })
  @MinLength(1, { message: 'E_REFERENTE_NOME_REQUIRED' })
  @MaxLength(150, { message: 'E_REFERENTE_NOME_TOO_LONG' })
  nome?: string;

  @IsOptional()
  @IsEnum(RuoloReferente, { message: 'E_REFERENTE_RUOLO_INVALID' })
  ruolo?: RuoloReferente;

  @IsOptional()
  @IsEmail({}, { message: 'E_REFERENTE_EMAIL_INVALID' })
  @MaxLength(255, { message: 'E_REFERENTE_EMAIL_TOO_LONG' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'E_REFERENTE_TELEFONO_INVALID' })
  @MaxLength(40, { message: 'E_REFERENTE_TELEFONO_TOO_LONG' })
  telefono?: string;

  @IsOptional()
  @IsString({ message: 'E_REFERENTE_NOTE_INVALID' })
  @MaxLength(255, { message: 'E_REFERENTE_NOTE_TOO_LONG' })
  note?: string;

  @IsOptional()
  @IsBoolean({ message: 'E_REFERENTE_ATTIVO_INVALID' })
  attivo?: boolean;
}
