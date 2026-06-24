// =============================================================================
// platform.guard.ts — accesso al livello superadmin di piattaforma (Task 3)
// =============================================================================
// Autorizza gli endpoint /platform/* SOLO agli utenti del tenant di piattaforma
// `oneplatform` (decisione opzione b: nessuna identità platform separata, il
// superadmin è un utente speciale di quel tenant). Confronta req.user.tenantId
// con PLATFORM_TENANT_ID (env). Gira DOPO JwtAuthGuard globale (req.user già
// popolato). Defense-in-depth: i controller aggiungono anche
// @RequirePermissions('sistema.tenant.gestisci').
// =============================================================================

import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedRequest } from '@gestionale/auth';

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const platformTenantId = this.config.get<string>('PLATFORM_TENANT_ID');

    // Misconfigurazione: senza PLATFORM_TENANT_ID nessuno è superadmin (fail-closed).
    if (!platformTenantId) {
      throw new ForbiddenException({
        errorCode: 'E_PLATFORM_NOT_CONFIGURED',
        message: 'Platform tenant not configured',
      });
    }

    if (!req.user || req.user.tenantId !== platformTenantId) {
      throw new ForbiddenException({
        errorCode: 'E_PLATFORM_FORBIDDEN',
        message: 'Platform access denied',
      });
    }

    return true;
  }
}
