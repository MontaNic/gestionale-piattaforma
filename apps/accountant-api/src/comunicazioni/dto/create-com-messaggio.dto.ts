import { ComLato } from '@gestionale/db';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

// =============================================================================
// create-com-messaggio.dto.ts — nuovo messaggio in un thread (ADR-0043)
// =============================================================================
// Lato operatore sono ammessi SOLO `studio` (visibile al cliente) e `interno`
// (nota tra operatori, mai visibile in ottica cliente). `cliente` è riservato al
// portale (livello 2) e rifiutato dal service sugli endpoint operatore.
// =============================================================================

export class CreateComMessaggioDto {
  @IsString({ message: 'E_COM_MSG_TESTO_INVALID' })
  @MinLength(1, { message: 'E_COM_MSG_TESTO_REQUIRED' })
  testo!: string;

  @IsOptional()
  @IsEnum(ComLato, { message: 'E_COM_MSG_LATO_INVALID' })
  lato?: ComLato;
}
