import { DirezioneDocumento, VisibilitaDocumento } from '@gestionale/db';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// =============================================================================
// create-documento-tipo.dto.ts — tipo documento custom per-tenant (ADR-0044)
// =============================================================================
// I 16 tipi platform (tenantId NULL) sono seedati; qui lo studio crea i propri.
// =============================================================================

export class CreateDocumentoTipoDto {
  @IsString({ message: 'E_DOCUMENTO_TIPO_NOME_INVALID' })
  @MinLength(1, { message: 'E_DOCUMENTO_TIPO_NOME_REQUIRED' })
  @MaxLength(100, { message: 'E_DOCUMENTO_TIPO_NOME_TOO_LONG' })
  nome!: string;

  @IsEnum(DirezioneDocumento, { message: 'E_DOCUMENTO_TIPO_DIREZIONE_INVALID' })
  direzione!: DirezioneDocumento;

  @IsOptional()
  @IsEnum(VisibilitaDocumento, { message: 'E_DOCUMENTO_TIPO_VISIBILITA_INVALID' })
  visibilitaDefault?: VisibilitaDocumento;
}
