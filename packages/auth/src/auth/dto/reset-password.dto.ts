import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  // Token in chiaro ricevuto via email (lookup per hash sha256 server-side).
  @IsString()
  @MinLength(1, { message: 'E_AUTH_RESET_TOKEN_INVALID' })
  token!: string;

  // Min length 8 coerente con LoginDto. NB: la ValidationPipe NON gira negli
  // E2E (vedi test-app.ts) → AuthService.resetPassword ri-valida la lunghezza
  // server-side (difesa in profondità + test E2E significativi).
  @IsString()
  @MinLength(8, { message: 'E_AUTH_PASSWORD_TOO_SHORT' })
  newPassword!: string;
}
