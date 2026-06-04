import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MailService } from './mail.service';

// =============================================================================
// MailModule — @Global, espone MailService per notifiche security (B2a)
// =============================================================================
// Pattern simmetrico a RedisModule (B1): @Global per esporre il transporter
// unico ai consumer (AuthService) senza re-import.
//
// `imports: [ConfigModule]` esplicito (anche se ConfigModule.forRoot e'
// globale in AppModule): allineato a RedisModule post Discovery #29 B2b
// per testability deterministica in Test.createTestingModule.
// =============================================================================
@Global()
@Module({
  imports: [ConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
