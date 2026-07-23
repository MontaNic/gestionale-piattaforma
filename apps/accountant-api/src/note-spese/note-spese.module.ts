import { Module } from '@nestjs/common';
import { UsersModule } from '@gestionale/auth';

import { NoteSpeseController } from './note-spese.controller';
import { NoteSpeseService } from './note-spese.service';

// DbService è @Global. UsersModule fornisce UsersService.hasPermission (scoping
// leggi_tutte, stessa fonte del PermissionsGuard). Gli allegati (+ StorageModule)
// arrivano nel commit successivo. Modulo accountant-only.
@Module({
  imports: [UsersModule],
  providers: [NoteSpeseService],
  controllers: [NoteSpeseController],
  exports: [NoteSpeseService],
})
export class NoteSpeseModule {}
