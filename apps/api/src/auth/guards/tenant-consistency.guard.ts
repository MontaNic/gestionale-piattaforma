// =============================================================================
// tenant-consistency.guard.ts — Defense-in-depth cross-tenant access prevention
// =============================================================================
// Closure TD-7 (ADR-0012 §TD-7, Discovery #50 capture sessione 15).
//
// Background:
// - F1-shell AuthGate (sessione 14) ha parzialmente chiuso il gap UI: redirect
//   implicito quando l'utente apre /t/<altro-slug>/... in browser.
// - Backend `/me` (e ogni futuro endpoint protetto) NON valida il header
//   X-Tenant-Slug contro `req.user.tenantId`: con JWT valido + header arbitrario
//   un client non-browser (curl, mobile app future, integrazione API) potrebbe
//   leggere risorse cross-tenant — gap defense-in-depth ancora aperto.
//
// Strategia:
// - APP_GUARD globale POST-JwtAuthGuard PRE-PermissionsGuard (vedi app.module.ts
//   ordine ADR-0017 lines 53-70).
// - JwtStrategy.validate() popola `req.user.tenantId` dal payload JWT (fonte
//   autorevole, anti-spoofing ADR-0008 dec. B). Questo Guard confronta con il
//   tenantId derivato dal header X-Tenant-Slug.
//
// Logica (5 branch):
//   1. Skip se @Public (login, refresh, login-pin, root, health) — Reflector lookup
//   2. Skip se req.user assente (JwtAuthGuard ha gia' rejected o endpoint pubblico)
//   3. Skip se header X-Tenant-Slug assente (backward-compat: client legacy non
//      passano header — invariante mantenuta, NO breaking change)
//   4. Lookup tenantId by slug (cache Redis TTL 60s con fallback Postgres)
//   5. Compara → mismatch → 401 E_AUTH_TENANT_MISMATCH (NO 403 per evitare
//      info leak "tenant esiste ma JWT non autorizzato"; 401 generic e' piu'
//      sicuro e coerente con tenant.middleware.ts pre-auth taxonomy)
//
// Cache TTL 60s razionale:
// - Tenant slug→id mapping e' praticamente immutabile (rename slug operazione rara)
// - TTL breve evita stale cache su tenant soft-delete (invalidation automatica
//   entro 60s, accettabile per security-non-critical operation)
// - Riusa RedisService singleton (no overhead connection)
// - Negative cache (slug inesistente) con sentinel `__NULL__` per evitare
//   DB lookup hammering su slug invalido ripetuto
//
// Performance steady-state: 1 Redis GET per request post-auth con header
// (~99% cache hit). Cache miss: 1 Postgres SELECT (indexed unique <5ms).
//
// Resiliency: Redis down → fallback Postgres diretto, NO auth break.
//
// Refs: ADR-0012 §TD-7 sessione 15 update, Discovery #50, ADR-0008 dec. B
// (JWT-as-authoritative-source), ADR-0017 (APP_GUARD ordering).
// =============================================================================

import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { withSystemContext } from '@gestionale/db';
import type { Request } from 'express';

import { DbService } from '../../db/db.service';
import { RedisService } from '../../redis/redis.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

interface RequestWithUser extends Request {
  user?: { tenantId?: string };
}

@Injectable()
export class TenantConsistencyGuard implements CanActivate {
  private readonly logger = new Logger(TenantConsistencyGuard.name);

  private static readonly CACHE_TTL_SECONDS = 60;
  private static readonly CACHE_KEY_PREFIX = 'tenant:slug:';
  private static readonly CACHE_NULL_SENTINEL = '__NULL__';

  // @Inject esplicito: Discovery #29 B2b — Vitest+esbuild non emette
  // design:paramtypes metadata, NestJS DI riceve undefined per i constructor
  // args inferred. Annotazione esplicita registra il token in
  // PARAMTYPES_METADATA bypassando il lookup design:paramtypes.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DbService) private readonly db: DbService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Branch 1: Skip @Public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // Branch 2: Skip se req.user assente
    const userTenantId = request.user?.tenantId;
    if (!userTenantId) {
      return true;
    }

    // Branch 3: Skip se header X-Tenant-Slug assente (backward-compat)
    const headerSlug = this.extractTenantSlugHeader(request);
    if (headerSlug === null) {
      return true;
    }

    // Branch 4: Lookup tenantId by slug (cache + Postgres fallback)
    const slugTenantId = await this.resolveTenantIdBySlug(headerSlug);

    // Branch 5: Compara
    if (slugTenantId === null) {
      this.logger.warn(
        `Slug "${headerSlug}" not found (JWT tenantId=${userTenantId}) — possible cross-tenant probe`,
      );
      throw new UnauthorizedException('E_AUTH_TENANT_MISMATCH');
    }

    if (slugTenantId !== userTenantId) {
      this.logger.warn(
        `Mismatch JWT.tenantId=${userTenantId} vs header slug "${headerSlug}" → ${slugTenantId}`,
      );
      throw new UnauthorizedException('E_AUTH_TENANT_MISMATCH');
    }

    return true;
  }

  private extractTenantSlugHeader(request: Request): string | null {
    const raw = request.headers['x-tenant-slug'];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim().toLowerCase();
    }
    return null;
  }

  private async resolveTenantIdBySlug(slug: string): Promise<string | null> {
    const cacheKey = `${TenantConsistencyGuard.CACHE_KEY_PREFIX}${slug}`;
    const client = this.redis.getClient();

    // Cache hit path
    try {
      const cached = await client.get(cacheKey);
      if (cached === TenantConsistencyGuard.CACHE_NULL_SENTINEL) {
        return null;
      }
      if (cached) {
        return cached;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis cache GET failed for slug=${slug}, fallback Postgres: ${msg}`);
      // Resiliency: Redis down NON deve rompere auth. Si procede al lookup DB.
    }

    // Cache miss: Postgres lookup via withSystemContext (bypass RLS, slug
    // resolution e' cross-tenant by-design — coerente con tenant.middleware.ts
    // pre-auth lookup).
    const tenant = await withSystemContext(() =>
      this.db.prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, isActive: true, deletedAt: true },
      }),
    );

    const tenantId = tenant && tenant.isActive && tenant.deletedAt === null ? tenant.id : null;

    // Populate cache (positive ID o sentinel negativo)
    try {
      await client.set(
        cacheKey,
        tenantId ?? TenantConsistencyGuard.CACHE_NULL_SENTINEL,
        'EX',
        TenantConsistencyGuard.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis cache SET failed for slug=${slug}: ${msg}`);
      // Silent fail: cache best-effort, prossima request fallira' di nuovo
      // sul GET e dovra' rifare il DB lookup (idempotente).
    }

    return tenantId;
  }
}
