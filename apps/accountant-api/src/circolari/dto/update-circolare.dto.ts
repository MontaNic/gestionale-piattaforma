import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CreateDestinatarioDto } from './create-circolare.dto';

// =============================================================================
// update-circolare.dto.ts — modifica bozza circolare (verticale accountant, ADR-0045)
// =============================================================================
// Tutti i campi opzionali (patch). `destinatari`, se presente, è un REPLACE
// integrale (delete + insert in transazione, pattern PreventivoVoce). La modifica
// è ammessa solo su stato='bozza' (guard nel service → 422).
// =============================================================================

export class UpdateCircolareDto {
  @IsOptional()
  @IsString({ message: 'E_CIRCOLARE_TITOLO_INVALID' })
  @MinLength(1, { message: 'E_CIRCOLARE_TITOLO_REQUIRED' })
  @MaxLength(200, { message: 'E_CIRCOLARE_TITOLO_TOO_LONG' })
  titolo?: string;

  @IsOptional()
  @IsString({ message: 'E_CIRCOLARE_OGGETTO_INVALID' })
  @MinLength(1, { message: 'E_CIRCOLARE_OGGETTO_REQUIRED' })
  @MaxLength(200, { message: 'E_CIRCOLARE_OGGETTO_TOO_LONG' })
  oggettoEmail?: string;

  @IsOptional()
  @IsString({ message: 'E_CIRCOLARE_BODY_INVALID' })
  @MinLength(1, { message: 'E_CIRCOLARE_BODY_REQUIRED' })
  bodyHtml?: string;

  @IsOptional()
  @IsInt({ message: 'E_CIRCOLARE_PRIORITA_INVALID' })
  @Min(0, { message: 'E_CIRCOLARE_PRIORITA_INVALID' })
  @Max(10, { message: 'E_CIRCOLARE_PRIORITA_INVALID' })
  priorita?: number;

  @IsOptional()
  @IsISO8601({}, { message: 'E_CIRCOLARE_SCADE_IL_INVALID' })
  scadeIl?: string;

  // [livello 2 — portale cliente, ADR-0048] richiede presa-visione esplicita.
  @IsOptional()
  @IsBoolean({ message: 'E_CIRCOLARE_RICHIEDE_CONFERMA_INVALID' })
  richiedeConferma?: boolean;

  @IsOptional()
  @IsArray({ message: 'E_CIRCOLARE_DESTINATARI_INVALID' })
  @ArrayMinSize(1, { message: 'E_CIRCOLARE_DESTINATARI_REQUIRED' })
  @ValidateNested({ each: true })
  @Type(() => CreateDestinatarioDto)
  destinatari?: CreateDestinatarioDto[];
}
