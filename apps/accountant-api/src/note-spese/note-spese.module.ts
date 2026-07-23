import { Module } from '@nestjs/common';
import { UsersModule } from '@gestionale/auth';
import { StorageModule } from '@gestionale/platform';

import { NoteSpeseController } from './note-spese.controller';
import { NoteSpeseService } from './note-spese.service';
import { NoteSpeseAllegatiController } from './note-spese-allegati.controller';
import { NoteSpeseAllegatiService } from './note-spese-allegati.service';

// DbService è @Global. UsersModule fornisce UsersService.hasPermission (scoping
// leggi_tutte, stessa fonte del PermissionsGuard). StorageModule fornisce il
// token StorageService per upload/download/delete allegati. Modulo accountant-only.
@Module({
  imports: [UsersModule, StorageModule],
  providers: [NoteSpeseService, NoteSpeseAllegatiService],
  controllers: [NoteSpeseController, NoteSpeseAllegatiController],
  exports: [NoteSpeseService],
})
export class NoteSpeseModule {}
