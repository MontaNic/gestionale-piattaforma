import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'E_AUTH_INVALID_EMAIL' })
  email!: string;
}
