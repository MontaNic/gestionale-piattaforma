import { VisibilitaScadenza } from '@gestionale/db';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// =============================================================================
// update-scadenza.dto.ts — tutti i campi opzionali (PATCH parziale)
// =============================================================================
// Stesso pattern di update-azienda.dto.ts: campi espliciti tutti @IsOptional (no
// PartialType), errorCode E_SCADENZA_* riusati dal create. La regola
// visibilita='azienda' ⇒ aziendaId resta validata nel service.
// =============================================================================

export class UpdateScadenzaDto {
  @IsOptional()
  @IsString({ message: 'E_SCADENZA_TITOLO_INVALID' })
  @MinLength(1, { message: 'E_SCADENZA_TITOLO_REQUIRED' })
  @MaxLength(255, { message: 'E_SCADENZA_TITOLO_TOO_LONG' })
  titolo?: string;

  @IsOptional()
  @IsString({ message: 'E_SCADENZA_DESCRIZIONE_INVALID' })
  descrizione?: string;

  @IsOptional()
  @IsDateString({}, { message: 'E_SCADENZA_DATA_SCADENZA_INVALID' })
  dataScadenza?: string;

  @IsOptional()
  @IsUUID('all', { message: 'E_SCADENZA_CATEGORIA_ID_INVALID' })
  categoriaId?: string;

  @IsOptional()
  @IsEnum(VisibilitaScadenza, { message: 'E_SCADENZA_VISIBILITA_INVALID' })
  visibilita?: VisibilitaScadenza;

  @IsOptional()
  @IsUUID('all', { message: 'E_SCADENZA_AZIENDA_ID_INVALID' })
  aziendaId?: string;

  @IsOptional()
  @IsBoolean({ message: 'E_SCADENZA_ATTIVO_INVALID' })
  attivo?: boolean;
}
