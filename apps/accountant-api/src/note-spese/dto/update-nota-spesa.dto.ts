import {
  AliquotaIvaNotaSpesa,
  DeducibilitaFiscale,
  MetodoPagamentoNotaSpesa,
  TipoSpesa,
} from '@gestionale/db';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// =============================================================================
// update-nota-spesa.dto.ts — PATCH parziale (accountant, PR-2)
// =============================================================================
// Tutti i campi @IsOptional (PartialType-like manuale, no @nestjs/mapped-types —
// coerente con update-scadenza/preventivo). errorCode E_NOTASPESA_* riusati.
// La coerenza mandato/azienda (D6) + stato editabile sono validati nel service.
// `aziendaId`/`mandatoId` nullable esplicito per poterli azzerare in PATCH.
// =============================================================================

export class UpdateNotaSpesaDto {
  @IsOptional()
  @IsDateString({}, { message: 'E_NOTASPESA_DATA_INVALID' })
  data?: string;

  @IsOptional()
  @IsUUID('all', { message: 'E_NOTASPESA_AZIENDA_ID_INVALID' })
  aziendaId?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'E_NOTASPESA_MANDATO_ID_INVALID' })
  mandatoId?: string | null;

  @IsOptional()
  @IsEnum(TipoSpesa, { message: 'E_NOTASPESA_TIPO_SPESA_INVALID' })
  tipoSpesa?: TipoSpesa;

  @IsOptional()
  @IsEnum(MetodoPagamentoNotaSpesa, { message: 'E_NOTASPESA_METODO_INVALID' })
  metodoPagamento?: MetodoPagamentoNotaSpesa;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_NOTASPESA_TOTALE_INVALID' })
  @Min(0, { message: 'E_NOTASPESA_TOTALE_NEGATIVE' })
  totale?: number;

  @IsOptional()
  @IsEnum(AliquotaIvaNotaSpesa, { message: 'E_NOTASPESA_ALIQUOTA_INVALID' })
  aliquotaIva?: AliquotaIvaNotaSpesa;

  @IsOptional()
  @IsEnum(DeducibilitaFiscale, { message: 'E_NOTASPESA_DEDUCIBILITA_INVALID' })
  deducibilitaFiscale?: DeducibilitaFiscale;

  @IsOptional()
  @IsBoolean({ message: 'E_NOTASPESA_FATTURATA_INVALID' })
  fatturataASocieta?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_NOTASPESA_DISTANZA_INVALID' })
  @Min(0, { message: 'E_NOTASPESA_DISTANZA_NEGATIVE' })
  distanzaKm?: number | null;

  @IsOptional()
  @IsString({ message: 'E_NOTASPESA_SCOPO_INVALID' })
  @MinLength(1, { message: 'E_NOTASPESA_SCOPO_REQUIRED' })
  @MaxLength(500, { message: 'E_NOTASPESA_SCOPO_TOO_LONG' })
  scopoMissione?: string;

  @IsOptional()
  @IsString({ message: 'E_NOTASPESA_NOTE_INVALID' })
  @MaxLength(2000, { message: 'E_NOTASPESA_NOTE_TOO_LONG' })
  note?: string | null;
}
