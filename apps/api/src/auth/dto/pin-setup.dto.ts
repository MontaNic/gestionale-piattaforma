import { IsString, Matches, MinLength } from 'class-validator';

export class PinSetupDto {
  // Re-auth pattern OWASP (decisione 4 D2b): verifichiamo la password
  // corrente prima di accettare cambio PIN. Riduce rischio session hijack
  // -> attaccante che ha access token non puo' cambiare PIN senza pwd.
  @IsString()
  @MinLength(8, { message: 'E_AUTH_PASSWORD_TOO_SHORT' })
  currentPassword!: string;

  // 4-6 cifre numeriche. Pattern OWASP-recommended:
  // - Cifre solo (no lettere, no simboli)
  // - Lunghezza minima 4 (standard POS), max 6 (compromesso UX vs entropy)
  @Matches(/^\d{4,6}$/, { message: 'E_AUTH_PIN_INVALID_FORMAT' })
  pin!: string;
}
