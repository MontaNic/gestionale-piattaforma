// =============================================================================
// create-servizio-catalogo.dto.ts — Body POST /catalogo/servizi (ADR-0050)
// =============================================================================
// Decimali in INGRESSO come number (@IsNumber maxDecimalPlaces:2), come
// preventivo-voce.dto. errorCode E_SERVIZIO_*.
// =============================================================================

import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { TipoRicorrenza, UnitaMisura } from '@gestionale/db';

export class CreateServizioCatalogoDto {
  @IsString({ message: 'E_SERVIZIO_CODICE_INVALID' })
  @MinLength(1, { message: 'E_SERVIZIO_CODICE_REQUIRED' })
  @MaxLength(32, { message: 'E_SERVIZIO_CODICE_TOO_LONG' })
  codice!: string;

  @IsString({ message: 'E_SERVIZIO_NOME_INVALID' })
  @MinLength(1, { message: 'E_SERVIZIO_NOME_REQUIRED' })
  @MaxLength(180, { message: 'E_SERVIZIO_NOME_TOO_LONG' })
  nome!: string;

  @IsOptional()
  @IsString({ message: 'E_SERVIZIO_DESCRIZIONE_INVALID' })
  descrizione?: string;

  @IsOptional()
  @IsUUID('all', { message: 'E_SERVIZIO_CATEGORIA_ID_INVALID' })
  categoriaId?: string;

  @IsOptional()
  @IsEnum(UnitaMisura, { message: 'E_SERVIZIO_UNITA_INVALID' })
  unitaMisura?: UnitaMisura;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_SERVIZIO_PREZZO_INVALID' })
  @Min(0, { message: 'E_SERVIZIO_PREZZO_INVALID' })
  prezzoBase!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_SERVIZIO_IVA_INVALID' })
  @Min(0, { message: 'E_SERVIZIO_IVA_INVALID' })
  @Max(100, { message: 'E_SERVIZIO_IVA_INVALID' })
  ivaAliquota?: number;

  @IsOptional()
  @IsEnum(TipoRicorrenza, { message: 'E_SERVIZIO_RICORRENZA_INVALID' })
  tipoRicorrenza?: TipoRicorrenza;

  @IsOptional()
  @IsBoolean({ message: 'E_SERVIZIO_ATTIVO_INVALID' })
  attivo?: boolean;

  @IsOptional()
  @IsInt({ message: 'E_SERVIZIO_ORDINE_INVALID' })
  @Min(0, { message: 'E_SERVIZIO_ORDINE_INVALID' })
  ordine?: number;
}
