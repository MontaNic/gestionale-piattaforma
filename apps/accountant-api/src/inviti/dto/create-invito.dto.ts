import { ClienteRuolo } from '@gestionale/db';
import { IsEmail, IsEnum, IsOptional, MaxLength } from 'class-validator';

// =============================================================================
// create-invito.dto.ts — invito cliente al portale (feat/invito-cliente)
// =============================================================================
// message = errorCode (convenzione verticale). clienteRuolo opzionale: default
// 'utente' applicato nel service (auto-promote ad admin se l'azienda non ha
// ancora un admin attivo).
// =============================================================================

export class CreateInvitoDto {
  @IsEmail({}, { message: 'E_INVITO_EMAIL_INVALID' })
  @MaxLength(255, { message: 'E_INVITO_EMAIL_TOO_LONG' })
  email!: string;

  @IsOptional()
  @IsEnum(ClienteRuolo, { message: 'E_INVITO_RUOLO_INVALID' })
  clienteRuolo?: ClienteRuolo;
}
