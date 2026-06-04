import { IsJWT } from 'class-validator';

export class RefreshDto {
  @IsJWT({ message: 'E_AUTH_INVALID_REFRESH_TOKEN' })
  refreshToken!: string;
}
