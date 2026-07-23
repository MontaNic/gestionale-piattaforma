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
// create-nota-spesa.dto.ts — creazione nota spese (accountant, PR-2)
// =============================================================================
// I `message` dei decorator SONO gli errorCode E_NOTASPESA_*. Body JSON (gli
// allegati si caricano via endpoint dedicato). §4.5: il BE non applica regole
// fiscali — valida solo tipo/enum. D4/§4.6: `distanzaKm` nessuna validazione BE
// (soft-warning FE). D6: coerenza mandato/azienda nel service.
// =============================================================================

export class CreateNotaSpesaDto {
  @IsDateString({}, { message: 'E_NOTASPESA_DATA_INVALID' })
  data!: string;

  @IsOptional()
  @IsUUID('all', { message: 'E_NOTASPESA_AZIENDA_ID_INVALID' })
  aziendaId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'E_NOTASPESA_MANDATO_ID_INVALID' })
  mandatoId?: string;

  @IsEnum(TipoSpesa, { message: 'E_NOTASPESA_TIPO_SPESA_INVALID' })
  tipoSpesa!: TipoSpesa;

  @IsEnum(MetodoPagamentoNotaSpesa, { message: 'E_NOTASPESA_METODO_INVALID' })
  metodoPagamento!: MetodoPagamentoNotaSpesa;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_NOTASPESA_TOTALE_INVALID' })
  @Min(0, { message: 'E_NOTASPESA_TOTALE_NEGATIVE' })
  totale!: number;

  @IsEnum(AliquotaIvaNotaSpesa, { message: 'E_NOTASPESA_ALIQUOTA_INVALID' })
  aliquotaIva!: AliquotaIvaNotaSpesa;

  @IsEnum(DeducibilitaFiscale, { message: 'E_NOTASPESA_DEDUCIBILITA_INVALID' })
  deducibilitaFiscale!: DeducibilitaFiscale;

  @IsOptional()
  @IsBoolean({ message: 'E_NOTASPESA_FATTURATA_INVALID' })
  fatturataASocieta?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'E_NOTASPESA_DISTANZA_INVALID' })
  @Min(0, { message: 'E_NOTASPESA_DISTANZA_NEGATIVE' })
  distanzaKm?: number;

  @IsString({ message: 'E_NOTASPESA_SCOPO_INVALID' })
  @MinLength(1, { message: 'E_NOTASPESA_SCOPO_REQUIRED' })
  @MaxLength(500, { message: 'E_NOTASPESA_SCOPO_TOO_LONG' })
  scopoMissione!: string;

  @IsOptional()
  @IsString({ message: 'E_NOTASPESA_NOTE_INVALID' })
  @MaxLength(2000, { message: 'E_NOTASPESA_NOTE_TOO_LONG' })
  note?: string;
}
