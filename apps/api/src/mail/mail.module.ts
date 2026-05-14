import { Global, Module } from '@nestjs/common';

import { MailService } from './mail.service';

// =============================================================================
// MailModule — @Global, espone MailService per notifiche security (B2a)
// =============================================================================
// Pattern simmetrico a RedisModule (B1): @Global per esporre il transporter
// unico ai consumer (AuthService) senza re-import.
//
// ConfigModule e' globale (registrato in AppModule), quindi ConfigService
// e' DI-iniettabile direttamente in MailService.
// =============================================================================
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
