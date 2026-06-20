import { ComApertura } from '@gestionale/db';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// =============================================================================
// create-comunicazione.dto.ts — apertura thread studio↔cliente (ADR-0043)
// =============================================================================
// Convenzione accountant: i `message` dei decorator SONO gli errorCode E_COM_*.
// L'apertura crea ATOMICAMENTE la testata + il primo messaggio (`testo`), il cui
// `lato` deriva da `apertaDa` (studio→studio, cliente→cliente). Lato operatore
// `apertaDa` è sempre `studio`; `cliente` è predisposto per il portale (livello 2).
// =============================================================================

export class CreateComunicazioneDto {
  @IsUUID('all', { message: 'E_COM_AZIENDA_ID_INVALID' })
  aziendaId!: string;

  @IsOptional()
  @IsUUID('all', { message: 'E_COM_REFERENTE_ID_INVALID' })
  referenteId?: string;

  @IsOptional()
  @IsEnum(ComApertura, { message: 'E_COM_APERTA_DA_INVALID' })
  apertaDa?: ComApertura;

  @IsString({ message: 'E_COM_OGGETTO_INVALID' })
  @MinLength(1, { message: 'E_COM_OGGETTO_REQUIRED' })
  @MaxLength(255, { message: 'E_COM_OGGETTO_TOO_LONG' })
  oggetto!: string;

  @IsString({ message: 'E_COM_TESTO_INVALID' })
  @MinLength(1, { message: 'E_COM_TESTO_REQUIRED' })
  testo!: string;

  @IsOptional()
  @IsBoolean({ message: 'E_COM_URGENTE_INVALID' })
  urgente?: boolean;

  @IsOptional()
  @IsUUID('all', { message: 'E_COM_OPERATORE_ID_INVALID' })
  operatoreAssegnatoId?: string;
}
