import { IsString, MaxLength, MinLength } from 'class-validator';

// =============================================================================
// accept-invite.dto.ts — accettazione invito (registrazione utente-portale)
// =============================================================================
// @Public: il token arriva dal link email; password + nome/cognome impostati
// dal cliente. La lunghezza password è ri-validata server-side in InvitiService
// (la ValidationPipe non gira in E2E — vedi test-app.ts).
// =============================================================================

export class AcceptInviteDto {
  @IsString()
  @MinLength(1, { message: 'E_INVITO_TOKEN_INVALID' })
  token!: string;

  @IsString()
  @MinLength(8, { message: 'E_AUTH_PASSWORD_TOO_SHORT' })
  password!: string;

  @IsString({ message: 'E_INVITO_NOME_INVALID' })
  @MinLength(1, { message: 'E_INVITO_NOME_REQUIRED' })
  @MaxLength(100, { message: 'E_INVITO_NOME_TOO_LONG' })
  firstName!: string;

  @IsString({ message: 'E_INVITO_COGNOME_INVALID' })
  @MinLength(1, { message: 'E_INVITO_COGNOME_REQUIRED' })
  @MaxLength(100, { message: 'E_INVITO_COGNOME_TOO_LONG' })
  lastName!: string;
}
