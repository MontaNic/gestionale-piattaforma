import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Subset di DeviceType (Prisma enum) — login PIN solo su touch/POS, non web.
// 'web' escluso (decisione D D2b): browser desktop deve usare email+password.
export type PinLoginDeviceType = 'pos_tablet' | 'pos_desktop' | 'mobile';
const PIN_DEVICE_TYPES: PinLoginDeviceType[] = ['pos_tablet', 'pos_desktop', 'mobile'];

export class LoginPinDto {
  @Matches(/^\d{4,6}$/, { message: 'E_AUTH_PIN_INVALID_FORMAT' })
  pin!: string;

  // Identificativo dispositivo (UUID, MAC anonimizzato, fingerprint browser).
  // Persistito in sessions.device_id per audit + future revoca per device.
  @IsString()
  @MinLength(1)
  @MaxLength(64, { message: 'E_AUTH_DEVICE_ID_TOO_LONG' })
  deviceId!: string;

  @IsIn(PIN_DEVICE_TYPES, { message: 'E_AUTH_DEVICE_TYPE_INVALID' })
  deviceType!: PinLoginDeviceType;
}
