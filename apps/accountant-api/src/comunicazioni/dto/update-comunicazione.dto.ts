import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// =============================================================================
// update-comunicazione.dto.ts — patch testata (assegnazione, chiusura, urgenza)
// =============================================================================
// `operatoreAssegnatoId: null` esplicito = rilascio (torna "da prendere"). La
// presa-in-carico (self-assign) ha un endpoint dedicato (POST :id/prendi).
// =============================================================================

export class UpdateComunicazioneDto {
  @IsOptional()
  @IsString({ message: 'E_COM_OGGETTO_INVALID' })
  @MinLength(1, { message: 'E_COM_OGGETTO_REQUIRED' })
  @MaxLength(255, { message: 'E_COM_OGGETTO_TOO_LONG' })
  oggetto?: string;

  @IsOptional()
  @IsBoolean({ message: 'E_COM_URGENTE_INVALID' })
  urgente?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'E_COM_CHIUSA_INVALID' })
  chiusa?: boolean;

  // null ammesso = rilascio assegnazione. undefined = invariato.
  @IsOptional()
  @IsUUID('all', { message: 'E_COM_OPERATORE_ID_INVALID' })
  operatoreAssegnatoId?: string | null;
}
