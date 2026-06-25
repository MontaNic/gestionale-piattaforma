// =============================================================================
// create-servizio-categoria.dto.ts — Body POST /catalogo/categorie (ADR-0050)
// =============================================================================
// Pattern create-scadenza-categoria. errorCode E_SERVIZIO_CATEGORIA_*.
// =============================================================================

import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateServizioCategoriaDto {
  @IsString({ message: 'E_SERVIZIO_CATEGORIA_NOME_INVALID' })
  @MinLength(1, { message: 'E_SERVIZIO_CATEGORIA_NOME_REQUIRED' })
  @MaxLength(100, { message: 'E_SERVIZIO_CATEGORIA_NOME_TOO_LONG' })
  nome!: string;

  @IsOptional()
  @IsString({ message: 'E_SERVIZIO_CATEGORIA_DESCRIZIONE_INVALID' })
  @MaxLength(500, { message: 'E_SERVIZIO_CATEGORIA_DESCRIZIONE_TOO_LONG' })
  descrizione?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'E_SERVIZIO_CATEGORIA_COLORE_INVALID' })
  colore?: string;

  @IsOptional()
  @IsInt({ message: 'E_SERVIZIO_CATEGORIA_ORDINE_INVALID' })
  ordine?: number;

  @IsOptional()
  @IsBoolean({ message: 'E_SERVIZIO_CATEGORIA_ATTIVO_INVALID' })
  attivo?: boolean;
}
