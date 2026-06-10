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
// create-scadenza.dto.ts — scadenza calendario fiscale (verticale accountant,
// STOP-scad1)
// =============================================================================
// Convenzione restaurant/accountant: i `message` dei decorator SONO gli errorCode
// E_SCADENZA_*. L'obbligo `aziendaId` quando visibilita='azienda' NON e' un
// constraint di class-validator (la ValidationPipe non gira in e2e — TD-BS): e'
// validato nel service (BadRequest E_SCADENZA_AZIENDA_REQUIRED) cosi' resta
// esercitabile dagli e2e.
// =============================================================================

export class CreateScadenzaDto {
  @IsString({ message: 'E_SCADENZA_TITOLO_INVALID' })
  @MinLength(1, { message: 'E_SCADENZA_TITOLO_REQUIRED' })
  @MaxLength(255, { message: 'E_SCADENZA_TITOLO_TOO_LONG' })
  titolo!: string;

  @IsOptional()
  @IsString({ message: 'E_SCADENZA_DESCRIZIONE_INVALID' })
  descrizione?: string;

  @IsDateString({}, { message: 'E_SCADENZA_DATA_SCADENZA_INVALID' })
  dataScadenza!: string;

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
