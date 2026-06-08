import { TipoCliente } from '@gestionale/db';
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
// update-azienda.dto.ts — tutti i campi opzionali (PATCH parziale)
// =============================================================================
// Stesso pattern di update-menu.dto.ts: campi espliciti tutti @IsOptional (no
// PartialType), errorCode E_AZIENDA_* riusati dal create.
// =============================================================================

export class UpdateAziendaDto {
  @IsOptional()
  @IsString({ message: 'E_AZIENDA_CODICE_INVALID' })
  @MinLength(1, { message: 'E_AZIENDA_CODICE_REQUIRED' })
  @MaxLength(20, { message: 'E_AZIENDA_CODICE_TOO_LONG' })
  codice?: string;

  @IsOptional()
  @IsString({ message: 'E_AZIENDA_NOME_INVALID' })
  @MinLength(1, { message: 'E_AZIENDA_NOME_REQUIRED' })
  @MaxLength(200, { message: 'E_AZIENDA_NOME_TOO_LONG' })
  nome?: string;

  @IsOptional()
  @IsEnum(TipoCliente, { message: 'E_AZIENDA_TIPO_CLIENTE_INVALID' })
  tipoCliente?: TipoCliente;

  @IsOptional()
  @IsString({ message: 'E_AZIENDA_PARTITA_IVA_INVALID' })
  @MaxLength(20, { message: 'E_AZIENDA_PARTITA_IVA_TOO_LONG' })
  partitaIva?: string;

  @IsOptional()
  @IsString({ message: 'E_AZIENDA_CODICE_FISCALE_INVALID' })
  @MaxLength(20, { message: 'E_AZIENDA_CODICE_FISCALE_TOO_LONG' })
  codiceFiscale?: string;

  @IsOptional()
  @IsString({ message: 'E_AZIENDA_CODICE_ATECO_INVALID' })
  @MaxLength(20, { message: 'E_AZIENDA_CODICE_ATECO_TOO_LONG' })
  codiceAteco?: string;

  @IsOptional()
  @IsEmail({}, { message: 'E_AZIENDA_EMAIL_INVALID' })
  @MaxLength(255, { message: 'E_AZIENDA_EMAIL_TOO_LONG' })
  email?: string;

  @IsOptional()
  @IsEmail({}, { message: 'E_AZIENDA_EMAIL_OPERATIVA_INVALID' })
  @MaxLength(255, { message: 'E_AZIENDA_EMAIL_OPERATIVA_TOO_LONG' })
  emailOperativa?: string;

  @IsOptional()
  @IsEmail({}, { message: 'E_AZIENDA_PEC_INVALID' })
  @MaxLength(255, { message: 'E_AZIENDA_PEC_TOO_LONG' })
  pec?: string;

  @IsOptional()
  @IsString({ message: 'E_AZIENDA_SITO_WEB_INVALID' })
  @MaxLength(255, { message: 'E_AZIENDA_SITO_WEB_TOO_LONG' })
  sitoWeb?: string;

  @IsOptional()
  @IsString({ message: 'E_AZIENDA_TELEFONO_INVALID' })
  @MaxLength(40, { message: 'E_AZIENDA_TELEFONO_TOO_LONG' })
  telefono?: string;

  @IsOptional()
  @IsString({ message: 'E_AZIENDA_TELEFONO_2_INVALID' })
  @MaxLength(40, { message: 'E_AZIENDA_TELEFONO_2_TOO_LONG' })
  telefono2?: string;

  @IsOptional()
  @IsString({ message: 'E_AZIENDA_INDIRIZZO_INVALID' })
  @MaxLength(255, { message: 'E_AZIENDA_INDIRIZZO_TOO_LONG' })
  indirizzo?: string;

  @IsOptional()
  @IsString({ message: 'E_AZIENDA_NOTE_OPERATIVE_INVALID' })
  noteOperative?: string;

  @IsOptional()
  @IsBoolean({ message: 'E_AZIENDA_ATTIVO_INVALID' })
  attivo?: boolean;
}
