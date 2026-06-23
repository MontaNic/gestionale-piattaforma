import { IsString, MinLength } from 'class-validator';

// =============================================================================
// reply-cliente.dto.ts — reply lato cliente dal portale (ADR-0047)
// =============================================================================
// Solo `testo`: il `lato` NON è accettato dal client (il service forza sempre
// `cliente`, ADR-0047 §3). Speculare a CreateComMessaggioDto operatore, che vieta
// `lato='cliente'`; qui `studio`/`interno` sono impossibili da iniettare.
// =============================================================================

export class ReplyClienteDto {
  @IsString({ message: 'E_COM_MSG_TESTO_INVALID' })
  @MinLength(1, { message: 'E_COM_MSG_TESTO_REQUIRED' })
  testo!: string;
}
