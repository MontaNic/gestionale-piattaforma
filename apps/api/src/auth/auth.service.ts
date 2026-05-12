// =============================================================================
// auth.service.ts — Login, refresh rotation (con theft detection FULL), logout
// =============================================================================
// Pattern (vedi ADR-0008):
// - Password & PIN hashed argon2id (decisione 1)
// - JWT HS256 (decisione 2)
// - Sessioni stateful in tabella `sessions` (decisione 7)
// - Refresh rotation con THEFT DETECTION FULL (D2-vitest update):
//     se un refresh token gia' usato (session is_active=false) torna a
//     riapparire -> revoke ALL sessions del user + audit log con payload
//     forense (revokedSessionCount, suspectedSessionId, attackerIp, ua).
// - Audit log su login success/fail, logout, refresh.success, theft_detected
//   (best effort, non blocca auth).
//
// Verifica "wrong password / wrong email / tenant non trovato" usa SEMPRE
// la stessa exception per evitare info leak (timing attack residuo accettato F1).
// =============================================================================

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { id } from '@gestionale/db';

import { DbService } from '../db/db.service';
import { UsersService } from '../users/users.service';
import type { AuthTokensPayload } from './dto/auth-response.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

// Costanti TTL — coerenti con §B1 brief.
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15min
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d

type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.refresh.success'
  | 'auth.theft_detected';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  // ---------------------------------------------------------------------------
  // LOGIN — email + password (tenantId pre-risolto da TenantMiddleware)
  // ---------------------------------------------------------------------------
  async login(
    tenantId: string,
    email: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokensPayload> {
    const user = await this.users.findByTenantEmail(tenantId, email);

    // Single exception per email-non-trovata + password-errata + utente-disabilitato:
    // no info leak su esistenza account, no enumeration attack.
    if (!user || !user.isActive) {
      await this.recordAudit({
        tenantId,
        userId: user?.id,
        action: 'auth.login.failure',
        meta,
        payload: { reason: 'user_not_found_or_inactive' },
      });
      throw new UnauthorizedException('E_AUTH_INVALID_CREDENTIALS');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      await this.users.incrementFailedAttempts(user.id);
      await this.recordAudit({
        tenantId,
        userId: user.id,
        action: 'auth.login.failure',
        meta,
        payload: { reason: 'wrong_password' },
      });
      throw new UnauthorizedException('E_AUTH_INVALID_CREDENTIALS');
    }

    await this.users.recordSuccessfulLogin(user.id);
    return this.issueTokensAndCreateSession(user.id, tenantId, meta);
  }

  // ---------------------------------------------------------------------------
  // REFRESH — rotation + THEFT DETECTION FULL
  // ---------------------------------------------------------------------------
  // Decision tree:
  //   1. Verify JWT signature/expiry/type. Fail -> 401.
  //   2. Lookup session by payload.sessionId.
  //      a. Session absent (DB pulito?) -> 401 generic.
  //      b. Session ACTIVE + hash matches -> rotate (D2a flow).
  //      c. Session NOT ACTIVE + hash matches -> THEFT! Revoke all user
  //         sessions + audit + 401 E_AUTH_THEFT_DETECTED.
  //      d. Session ACTIVE/NOT ACTIVE + hash mismatch -> 401 generic (forged token).
  //      e. Session expired / userId mismatch -> 401 generic.
  async refresh(
    refreshToken: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokensPayload> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('E_AUTH_INVALID_REFRESH_TOKEN');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('E_AUTH_INVALID_REFRESH_TOKEN');
    }

    const session = await this.db.prisma.session.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session || session.userId !== payload.sub || session.expiresAt < new Date()) {
      throw new UnauthorizedException('E_AUTH_INVALID_REFRESH_TOKEN');
    }

    const hashMatches = await argon2.verify(session.refreshTokenHash, refreshToken);
    if (!hashMatches) {
      // Token forged (hash mismatch). Niente theft trigger: il token non
      // proviene da una nostra emissione precedente per questa session.
      throw new UnauthorizedException('E_AUTH_INVALID_REFRESH_TOKEN');
    }

    // ─── THEFT DETECTION ─────────────────────────────────────────────────────
    // Session already rotated (is_active=false) + token corrisponde al hash
    // storico. Significa: qualcuno (legittimo o attaccante) sta riusando
    // un token GIA' ruotato. Defense in depth: revoca tutto.
    if (!session.isActive) {
      const revoked = await this.db.prisma.session.updateMany({
        where: { userId: session.userId, isActive: true },
        data: { isActive: false },
      });
      await this.recordAudit({
        tenantId: payload.tenantId,
        userId: session.userId,
        action: 'auth.theft_detected',
        meta,
        payload: {
          revokedSessionCount: revoked.count,
          suspectedSessionId: session.id,
          attackerIp: meta.ip ?? null,
          attackerUserAgent: meta.userAgent ?? null,
        },
      });
      this.logger.warn(
        `Theft detected on user=${session.userId} session=${session.id} revoked=${revoked.count}`,
      );
      throw new UnauthorizedException('E_AUTH_THEFT_DETECTED');
    }

    // Rotation normale (D2a flow): disattiva session corrente + crea nuova.
    await this.db.prisma.session.update({
      where: { id: session.id },
      data: { isActive: false },
    });

    const tokens = await this.issueTokensAndCreateSession(
      session.userId,
      payload.tenantId,
      meta,
      session.sedeId,
    );
    // Override audit action: la create session ha gia' loggato 'auth.login.success'
    // ma vogliamo distinguere refresh da login fresh per analytics.
    // Soluzione semplice: log esplicito qui sopra (login.success comunque OK
    // per auditability, ma aggiungiamo refresh-specific).
    await this.recordAudit({
      tenantId: payload.tenantId,
      userId: session.userId,
      action: 'auth.refresh.success',
      meta,
      payload: { previousSessionId: session.id },
    });
    return tokens;
  }

  // ---------------------------------------------------------------------------
  // LOGOUT — invalida session corrente
  // ---------------------------------------------------------------------------
  async logout(sessionId: string, userId: string, tenantId: string): Promise<void> {
    await this.db.prisma.session.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
    await this.recordAudit({
      tenantId,
      userId,
      action: 'auth.logout',
      meta: {},
      payload: { sessionId },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private async issueTokensAndCreateSession(
    userId: string,
    tenantId: string,
    meta: { ip?: string; userAgent?: string },
    sedeId: string | null = null,
  ): Promise<AuthTokensPayload> {
    const sessionId = id();
    const accessPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      tenantId,
      sessionId,
      type: 'access',
    };
    const refreshPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      tenantId,
      sessionId,
      type: 'refresh',
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    });

    const refreshTokenHash = await argon2.hash(refreshToken, { type: argon2.argon2id });

    await this.db.prisma.session.create({
      data: {
        id: sessionId,
        userId,
        sedeId,
        deviceId: meta.userAgent?.slice(0, 64) ?? 'unknown',
        deviceType: 'web',
        refreshTokenHash,
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        isActive: true,
      },
    });

    await this.recordAudit({
      tenantId,
      userId,
      action: 'auth.login.success',
      meta,
      payload: { sessionId },
    });

    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  /**
   * Audit log best-effort. Pattern decisione 9 ADR-0008: il fallimento
   * dell'audit log NON blocca l'auth (resiliency by design). Logga warning.
   */
  private async recordAudit(input: {
    tenantId: string;
    userId: string | undefined;
    action: AuditAction;
    meta: { ip?: string; userAgent?: string };
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.prisma.auditLog.create({
        data: {
          id: id(),
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          action: input.action,
          entityType: 'User',
          entityId: input.userId ?? null,
          afterValue: input.payload as object,
          ip: input.meta.ip ?? null,
          userAgent: input.meta.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Audit log failed for ${input.action}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
