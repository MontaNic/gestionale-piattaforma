import { VisibilitaDocumento } from '@gestionale/db';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// =============================================================================
// create-documento.dto.ts — metadati upload documento (verticale accountant, ADR-0044)
// =============================================================================
// Inviato come multipart insieme al `file`. I `message` dei decorator SONO gli
// errorCode E_DOCUMENTO_*. `visibilita` MVP: solo tutti|azienda (no utente).
// =============================================================================

export class CreateDocumentoDto {
  @IsUUID('all', { message: 'E_DOCUMENTO_TIPO_ID_INVALID' })
  tipoId!: string;

  @IsUUID('all', { message: 'E_DOCUMENTO_AZIENDA_ID_INVALID' })
  aziendaId!: string;

  @IsEnum(VisibilitaDocumento, { message: 'E_DOCUMENTO_VISIBILITA_INVALID' })
  visibilita!: VisibilitaDocumento;

  @IsOptional()
  @IsString({ message: 'E_DOCUMENTO_NOTE_INVALID' })
  @MaxLength(2000, { message: 'E_DOCUMENTO_NOTE_TOO_LONG' })
  note?: string;
}
