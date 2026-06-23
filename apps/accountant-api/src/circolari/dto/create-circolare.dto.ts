import { DestinatarioTipo } from '@gestionale/db';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// =============================================================================
// create-circolare.dto.ts — nuova bozza circolare (verticale accountant, ADR-0045)
// =============================================================================
// I `message` dei decorator SONO gli errorCode E_CIRCOLARE_*. La regola
// cross-field (tipo='azienda' → aziendaId obbligatorio, tipo='tutti' → assente)
// è validata nel service (coerente con pattern repo: DocumentoTipo/ScadenzaCategoria).
// `tipo='utente'` è enum-value forward (livello 2): rifiutato nel service.
// =============================================================================

export class CreateDestinatarioDto {
  @IsEnum(DestinatarioTipo, { message: 'E_CIRCOLARE_DESTINATARIO_TIPO_INVALID' })
  tipo!: DestinatarioTipo;

  @IsOptional()
  @IsUUID('all', { message: 'E_CIRCOLARE_DESTINATARIO_AZIENDA_ID_INVALID' })
  aziendaId?: string;
}

export class CreateCircolareDto {
  @IsString({ message: 'E_CIRCOLARE_TITOLO_INVALID' })
  @MinLength(1, { message: 'E_CIRCOLARE_TITOLO_REQUIRED' })
  @MaxLength(200, { message: 'E_CIRCOLARE_TITOLO_TOO_LONG' })
  titolo!: string;

  @IsString({ message: 'E_CIRCOLARE_OGGETTO_INVALID' })
  @MinLength(1, { message: 'E_CIRCOLARE_OGGETTO_REQUIRED' })
  @MaxLength(200, { message: 'E_CIRCOLARE_OGGETTO_TOO_LONG' })
  oggettoEmail!: string;

  @IsString({ message: 'E_CIRCOLARE_BODY_INVALID' })
  @MinLength(1, { message: 'E_CIRCOLARE_BODY_REQUIRED' })
  bodyHtml!: string;

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

  @IsArray({ message: 'E_CIRCOLARE_DESTINATARI_INVALID' })
  @ArrayMinSize(1, { message: 'E_CIRCOLARE_DESTINATARI_REQUIRED' })
  @ValidateNested({ each: true })
  @Type(() => CreateDestinatarioDto)
  destinatari!: CreateDestinatarioDto[];
}
