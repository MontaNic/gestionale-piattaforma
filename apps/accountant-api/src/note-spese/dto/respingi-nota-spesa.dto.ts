import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

// =============================================================================
// respingi-nota-spesa.dto.ts — rifiuto nota spese (accountant, PR-3)
// =============================================================================
// `motivo` OBBLIGATORIO (§2/§6): non vuoto, non solo whitespace. Il `message`
// dei decorator È l'errorCode E_NOTASPESA_*. Trim in ingresso (whitespace-only →
// stringa vuota → MinLength(1) fallisce). Il service riapplica lo stesso guard
// (defense-in-depth: la ValidationPipe non è esercitata negli e2e service-level,
// TD-BS Sub-2).
// =============================================================================

export class RespingiNotaSpesaDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'E_NOTASPESA_MOTIVO_RICHIESTO' })
  @MinLength(1, { message: 'E_NOTASPESA_MOTIVO_RICHIESTO' })
  @MaxLength(1000, { message: 'E_NOTASPESA_MOTIVO_TROPPO_LUNGO' })
  motivo!: string;
}
