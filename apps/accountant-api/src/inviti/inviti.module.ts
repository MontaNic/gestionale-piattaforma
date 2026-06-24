import { Module } from '@nestjs/common';

import { AuthModule } from '@gestionale/auth';

import { AcceptInviteController } from './accept-invite.controller';
import { InvitiController } from './inviti.controller';
import { InvitiService } from './inviti.service';

// DbService e' @Global (da @gestionale/db/nest). MailService da MailModule
// (globale in app.module). AuthModule importato per iniettare AuthService
// (token-issuance del nuovo cliente in accept-invite).
@Module({
  imports: [AuthModule],
  providers: [InvitiService],
  controllers: [InvitiController, AcceptInviteController],
  exports: [InvitiService],
})
export class InvitiModule {}
