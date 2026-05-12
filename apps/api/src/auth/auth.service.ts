// =============================================================================
// auth.service.ts — Login, refresh rotation, logout
// =============================================================================
// Pattern (vedi ADR-0008):
// - Password & PIN hashed argon2id (decisione 1)
// - JWT HS256 (decisione 2)
// - Sessioni stateful in tabella `sessions` (decisione 7)
// - Refresh rotation BASE in D2a: vecchia session disattivata + nuova creata
//   (theft detection full -> rimandato a D2-vitest, ADR-0008 sezione "D2b/D2-vitest")
// - Audit log su login success/fail e logout (best effort, decisione 9)
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
      await this.recordAuditLogin(
        tenantId,
        user?.id,
        meta,
        'failure',
        'user_not_found_or_inactive',
      );
      throw new UnauthorizedException('E_AUTH_INVALID_CREDENTIALS');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      await this.users.incrementFailedAttempts(user.id);
      await this.recordAuditLogin(tenantId, user.id, meta, 'failure', 'wrong_password');
      throw new UnauthorizedException('E_AUTH_INVALID_CREDENTIALS');
    }

    await this.users.recordSuccessfulLogin(user.id);
    return this.issueTokensAndCreateSession(user.id, tenantId, meta);
  }

  // ---------------------------------------------------------------------------
  // REFRESH — rotation: invalida session corrente, crea nuova
  // ---------------------------------------------------------------------------
  // Theft detection BASE (D2a): se il refresh token non corrisponde a una
  // session attiva, ritorna 401. La detection FULL (revoke all sessions on
  // rotated-token reuse) e' rimandata a D2-vitest (vedi ADR-0008).
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

    if (
      !session ||
      !session.isActive ||
      session.expiresAt < new Date() ||
      session.userId !== payload.sub
    ) {
      throw new UnauthorizedException('E_AUTH_INVALID_REFRESH_TOKEN');
    }

    // Verify che il token corrisponda effettivamente all'hash della session
    const matches = await argon2.verify(session.refreshTokenHash, refreshToken);
    if (!matches) {
      throw new UnauthorizedException('E_AUTH_INVALID_REFRESH_TOKEN');
    }

    // Rotation: disattiva session corrente + crea nuova (transactional)
    await this.db.prisma.session.update({
      where: { id: session.id },
      data: { isActive: false },
    });

    return this.issueTokensAndCreateSession(session.userId, payload.tenantId, meta, session.sedeId);
  }

  // ---------------------------------------------------------------------------
  // LOGOUT — invalida session corrente
  // ---------------------------------------------------------------------------
  async logout(sessionId: string, userId: string, tenantId: string): Promise<void> {
    await this.db.prisma.session.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
    await this.recordAuditLogin(tenantId, userId, {}, 'logout', 'user_initiated');
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

    await this.recordAuditLogin(tenantId, userId, meta, 'success', 'login_completed');

    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  private async recordAuditLogin(
    tenantId: string,
    userId: string | undefined,
    meta: { ip?: string; userAgent?: string },
    outcome: 'success' | 'failure' | 'logout',
    reason: string,
  ): Promise<void> {
    try {
      await this.db.prisma.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId: userId ?? null,
          action: `auth.${outcome === 'success' ? 'login.success' : outcome === 'logout' ? 'logout' : 'login.failure'}`,
          entityType: 'User',
          entityId: userId ?? null,
          afterValue: { reason },
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });
    } catch (err) {
      // Best effort: il fallimento dell'audit log non blocca l'auth (decisione 9
      // ADR-0008). Logga ma non rilancia.
      this.logger.warn(
        `Audit log failed for ${outcome}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
