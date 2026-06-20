import { Module } from '@nestjs/common';

import { LocalFilesystemStorageService } from './local-filesystem-storage.service';
import { StorageService } from './storage.service';

// Storage astratto: i consumer iniettano `StorageService` (token astratto), il
// binding concreto è qui. Swap a Cloudflare R2 = cambiare il solo `useClass`.
// ConfigService disponibile via ConfigModule globale (app.module).
@Module({
  providers: [{ provide: StorageService, useClass: LocalFilesystemStorageService }],
  exports: [StorageService],
})
export class StorageModule {}
