// =============================================================================
// @gestionale/platform — superficie pubblica (ADR-0027 §D5 passo 6)
// Infra cross-cutting NestJS: redis, mail, throttler, common.
// `health` NON è estratto (differito, STOP 1 1A).
// =============================================================================

// redis
export { RedisModule } from './redis/redis.module';
export { RedisService } from './redis/redis.service';

// mail
export { MailModule } from './mail/mail.module';
export { MailService } from './mail/mail.service';

// throttler — i metadata const sono definiti in throttler.module.ts (non nei
// decorator: divergenza dalla bozza STOP 1, allineata al filesystem reale).
export {
  AppThrottlerModule,
  AUTH_STRICT_METADATA,
  TENANT_CREATE_METADATA,
  LOGIN_PIN_METADATA,
} from './throttler/throttler.module';
export { AppThrottlerGuard } from './throttler/guards/app-throttler.guard';
export { AuthStrict } from './throttler/decorators/auth-strict.decorator';
export { TenantCreate } from './throttler/decorators/tenant-create.decorator';
export { LoginPinThrottle } from './throttler/decorators/login-pin.decorator';
export { skipIfMetadataAbsent } from './throttler/utils/skip-if-metadata.util';
export { extractSubFromAuthHeader } from './throttler/utils/jwt-decode.util';

// common
export { GlobalHttpExceptionFilter } from './common/filters/global-http-exception.filter';
export { catchUniqueViolation } from './common/prisma-errors';

// storage — astrazione provider-agnostica + impl filesystem locale (graduata da
// apps/accountant-api al 2° consumer, TD-storage-platform ADR-0043).
export { StorageService, STORAGE_MAX_UPLOAD_BYTES } from './storage/storage.service';
export type { StoragePutInput, StoragePutResult, StorageObject } from './storage/storage.service';
export { LocalFilesystemStorageService } from './storage/local-filesystem-storage.service';
export { StorageModule } from './storage/storage.module';
