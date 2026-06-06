// =============================================================================
// permissions.guard.ts — RBAC enforcement Guard globale (APP_GUARD)
// =============================================================================
// Comportamento:
// - Endpoint NO @RequirePermissions metadata → allow (Guard è opt-in)
// - Endpoint HA metadata:
//   - Estrae user da req.user (popolato da JwtAuthGuard upstream)
//   - User mancante → ForbiddenException E_AUTH_NOT_AUTHENTICATED
//   - Loop su permissions con hasPermissionCached (cache Redis → fallback DB)
//   - Mode AND: tutti devono passare (short-circuit primo false)
//   - Mode OR: almeno uno deve passare (short-circuit primo true)
//   - Deny → audit 'auth.permission_denied' (dedupato 60s/userId+endpoint) +
//     ForbiddenException E_AUTH_INSUFFICIENT_PERMISSIONS
//
// Cache Redis (sessione 11 ADR-0017):
//   key   = `permissions:user:<userId>:perm:<permission>`
//   value = '1' (true) | '0' (false)
//   ttl   = env RBAC_CACHE_TTL_S (default 60s)
//   fail-open Redis DOWN → fallback DB lookup, log warn (Pattern fail-open
//   layered B1/B2a/B2b consolidato)
//
// Audit dedupe Redis (sessione 11):
//   key = `audit:permdenied:<userId>:<endpoint>` TTL 60s
//   SET NX atomic per evitare race condition
//   fail-open Redis DOWN → audit insert SEMPRE (better double than missing)
//
// Pattern DI: @Inject(ClassName) defensive su ogni dep (Discovery #29
// PERMANENTE B2b — TD-AE Vitest+SWC gap).
// =============================================================================

import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { id, prisma, runInTenantContext } from '@gestionale/db';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-request.interface';
import { RedisService } from '@gestionale/platform';
import { UsersService } from '../../users/users.service';
import {
  PERMISSIONS_METADATA_KEY,
  type PermissionsMetadata,
} from '../interfaces/permissions-metadata.interface';

const DEFAULT_CACHE_TTL_S = 60;
const AUDIT_DEDUPE_TTL_S = 60;

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);
  private readonly cacheTtlS: number;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(UsersService) private readonly usersService: UsersService,
    @Inject(RedisService) private readonly redisService: RedisService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    const ttl = parseInt(this.configService.get<string>('RBAC_CACHE_TTL_S') ?? '', 10);
    this.cacheTtlS = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_CACHE_TTL_S;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<PermissionsMetadata | undefined>(
      PERMISSIONS_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Endpoint NON protetto → allow
    if (!metadata || metadata.permissions.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; route?: { path?: string } }>();
    const user = request.user;

    if (!user) {
      this.logger.warn(
        `PermissionsGuard: req.user mancante su endpoint protetto ${request.method} ${request.url}. ` +
          `Probabile mancanza @UseGuards(JwtAuthGuard) upstream.`,
      );
      throw new ForbiddenException({
        errorCode: 'E_AUTH_NOT_AUTHENTICATED',
        message: 'Autenticazione richiesta.',
      });
    }

    // RLS context wrap: PermissionsGuard fires al guard stage (PRIMA del
    // TenantContextInterceptor globale che setta ALS al controller stage).
    // Le query Prisma downstream (hasPermission lookup, audit insert) hanno
    // bisogno di ALS context, sennò RlsNoContextError. Pattern simmetrico a
    // JwtStrategy.validate() (apps/restaurant-api/src/auth/strategies/jwt.strategy.ts:62-65).
    return runInTenantContext({ tenantId: user.tenantId, isSuperAdmin: false }, () =>
      this.checkPermissions(request, user, metadata),
    );
  }

  /**
   * Body di canActivate post-guard checks. Gira dentro runInTenantContext ALS
   * per soddisfare RLS context requirement delle query Prisma downstream.
   */
  private async checkPermissions(
    request: Request & { route?: { path?: string } },
    user: AuthenticatedUser,
    metadata: PermissionsMetadata,
  ): Promise<boolean> {
    const allowed =
      metadata.mode === 'OR'
        ? await this.checkOr(user.id, metadata.permissions)
        : await this.checkAnd(user.id, metadata.permissions);

    if (!allowed) {
      // request.route.path è il pattern Express (es. '/tenants/:id'), preserva
      // cardinalità low del dedupe key (vs request.url con path params variabili).
      // Edge case: se request.route undefined (es. 404 router non-match upstream),
      // fallback request.url può aumentare cardinalità dedupe per attaccanti con
      // path params variabili. Acceptable scope corrente (POST /tenants pattern
      // stabile); TD candidato se F1+ aggiunge endpoint dinamici con path params.
      const endpoint = `${request.method} ${request.route?.path ?? request.url}`;
      await this.logPermissionDenied(
        user.tenantId,
        user.id,
        endpoint,
        metadata.permissions,
        metadata.mode,
      );
      throw new ForbiddenException({
        errorCode: 'E_AUTH_INSUFFICIENT_PERMISSIONS',
        message: 'Permessi insufficienti per questa operazione.',
      });
    }

    return true;
  }

  /**
   * AND mode: tutte le permissions richieste. Short-circuit al primo false.
   */
  private async checkAnd(userId: string, permissions: readonly string[]): Promise<boolean> {
    for (const perm of permissions) {
      const has = await this.hasPermissionCached(userId, perm);
      if (!has) return false;
    }
    return true;
  }

  /**
   * OR mode: almeno una. Short-circuit al primo true.
   */
  private async checkOr(userId: string, permissions: readonly string[]): Promise<boolean> {
    for (const perm of permissions) {
      const has = await this.hasPermissionCached(userId, perm);
      if (has) return true;
    }
    return false;
  }

  /**
   * Cache Redis layer per hasPermission. Fail-open: Redis DOWN → fallback DB.
   * Pattern coerente con LockoutService B1 / MailService B2a / ThrottlerGuard B2b.
   */
  private async hasPermissionCached(userId: string, permission: string): Promise<boolean> {
    const cacheKey = `permissions:user:${userId}:perm:${permission}`;
    try {
      const cached = await this.redisService.getClient().get(cacheKey);
      if (cached !== null) {
        return cached === '1';
      }
    } catch (err) {
      this.logger.warn(
        `Redis cache GET fail (fail-open → DB lookup) key=${cacheKey}: ${(err as Error).message}`,
      );
    }

    const result = await this.usersService.hasPermission(userId, permission);

    try {
      await this.redisService.getClient().set(cacheKey, result ? '1' : '0', 'EX', this.cacheTtlS);
    } catch (err) {
      // Cache write fail = silent (non blocca request). Prossima lettura → MISS retry.
      this.logger.debug(`Redis cache SET fail (silent) key=${cacheKey}: ${(err as Error).message}`);
    }

    return result;
  }

  /**
   * Audit 'auth.permission_denied' + dedupe Redis (60s) per evitare flood.
   * Log warn SEMPRE (real-time visibility). Audit insert solo se non dedupato
   * (o fail-open Redis DOWN → audit sempre).
   */
  private async logPermissionDenied(
    tenantId: string,
    userId: string,
    endpoint: string,
    requiredPermissions: readonly string[],
    mode: PermissionsMetadata['mode'],
  ): Promise<void> {
    this.logger.warn(
      `Permission denied — user=${userId} endpoint="${endpoint}" mode=${mode} ` +
        `required=[${requiredPermissions.join(',')}]`,
    );

    const dedupeKey = `audit:permdenied:${userId}:${endpoint}`;
    let shouldInsert = true;
    try {
      // SET NX (Not eXists) + EX TTL: atomic dedupe.
      // setResult === 'OK' se inserito (audit OK), null se key esisteva (skip).
      const setResult = await this.redisService
        .getClient()
        .set(dedupeKey, '1', 'EX', AUDIT_DEDUPE_TTL_S, 'NX');
      shouldInsert = setResult === 'OK';
    } catch (err) {
      // Redis DOWN → fail-open: audit insert SEMPRE (better double than missing)
      this.logger.warn(
        `Redis dedupe fail (fail-open → audit insert) key=${dedupeKey}: ${(err as Error).message}`,
      );
      shouldInsert = true;
    }

    if (!shouldInsert) {
      return;
    }

    try {
      await prisma.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'auth.permission_denied',
          entityType: 'AuthorizationCheck',
          entityId: userId,
          afterValue: {
            endpoint,
            mode,
            requiredPermissions: [...requiredPermissions],
          },
        },
      });
    } catch (err) {
      // Audit non-blocking: log error, continua con throw upstream.
      this.logger.error(
        `Audit log fail (non-blocking) action=auth.permission_denied user=${userId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
