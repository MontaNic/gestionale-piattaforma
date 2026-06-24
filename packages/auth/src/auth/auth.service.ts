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

import crypto from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { id, prisma, runInTenantContext } from '@gestionale/db';

import { AuthErrorCode } from '@gestionale/shared';
import { MailService } from '@gestionale/platform';
import { UsersService } from '../users/users.service';
import type { AuthErrorResponse } from './dto/auth-error-response.dto';
import type { AuthTokensPayload } from './dto/auth-response.dto';
import type { PinLoginDeviceType } from './dto/login-pin.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import { LockoutService } from './lockout.service';
import { validatePin } from './utils/pin-validator';

// Costanti TTL — coerenti con §B1 brief.
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15min
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d
// Reset password: TTL token monouso (1h, allineato al testo email) +
// lunghezza minima password (coerente con LoginDto/MinLength(8)).
const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1h
const MIN_PASSWORD_LENGTH = 8;

export type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.refresh.success'
  | 'auth.theft_detected'
  // D2b additions:
  | 'auth.pin.setup' // first-time PIN setup (user.pinHash era null)
  | 'auth.pin.reset' // PIN overwrite (user.pinHash !== null pre-call)
  | 'auth.login_pin.success'
  | 'auth.login_pin.failure'
  // B1 (sessione 8) — lockout transition:
  | 'auth.account_locked' // promoted to lockout: count >= threshold
  // Reset password (forgot/reset flow):
  | 'auth.password_reset.requested' // forgot-password ricevuto (email esiste o no)
  | 'auth.password_reset.completed' // reset-password andato a buon fine
  | 'auth.password_reset.failure' // token invalido/scaduto/usato o password corta
  // RBAC (sessione 11 ADR-0017) — emesso da PermissionsGuard su deny path,
  // con dedupe Redis 60s/(userId,endpoint) per evitare flood audit log.
  | 'auth.permission_denied';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // @Inject esplicito per ogni dep — Discovery #29 B2b (TD-AE permanente):
  // SWC config completa (.swcrc + inline keepClassNames + decoratorMetadata)
  // emette metadata correttamente per i service root, ma NestJS testing DI
  // ancora non risolve `class` deps via design:paramtypes nei test E2E.
  // Tentativi rollback STOP 3 (sub-prompt) → fail con
  // "Cannot read properties of undefined (reading 'checkLockout')". Pattern
  // @Inject mantenuto come defensive (production-safe, zero impatto runtime).
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(LockoutService) private readonly lockout: LockoutService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  // Durata lockout in minuti, usata per UI message email. Allineata a
  // LOCKOUT_DURATION_MS (15min default LockoutService). Hardcoded qui per
  // semplicita' messaggio email; tuning env-driven gia' nel LockoutService.
  private readonly LOCKOUT_DURATION_MIN = 15;

  // Lockout key helpers (B1 STOP 3 + TD-H resolution sessione 12 PR 2).
  // Prefix per namespacing: garantisce isolamento tra login (tenant+email) e
  // login-pin (tenant+device) sui buckets Redis senza collisione fortuita.
  // TD-H risolto: chiave login include tenantId → un attacker che conosce
  // un'email NON può bloccarla cross-tenant (DoS-by-account-name mitigato per
  // tenant scope). Composizione opaque mantiene LockoutService API stabile.
  private readonly LOCKOUT_KEY_LOGIN = (tenantId: string, email: string): string =>
    `tenant:${tenantId}:email:${email}`;
  private readonly LOCKOUT_KEY_LOGIN_PIN = (tenantId: string, deviceId: string): string =>
    `pin:tenant:${tenantId}:device:${deviceId}`;

  // Hash sha256 (8 char) della lockout key per audit/log: l'audit afterValue
  // e' leggibile da Super Admin, mai esporre l'email/deviceId plain text.
  private lockoutKeyDigest(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
  }

  private throwAccountLocked(): never {
    // 429 (NOT 401): distinguibile lato client per UX e auto-retry policy.
    // Body errorCode (TD-AY: ex `code:`, allineato a taxonomy cross-endpoint)
    // letto da LockoutExceptionFilter per Retry-After: 900.
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AuthErrorCode.ACCOUNT_LOCKED,
        message: 'Account temporaneamente bloccato per troppi tentativi falliti',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // TD-AJ resolution (PR 2): emit body 401 con `errorCode` esplicito + timestamp
  // (vedi AuthErrorResponse DTO). Sostituisce `throw new UnauthorizedException(code)`
  // che metteva il code nel campo `message` (frontend fallback E_UNKNOWN).
  // Scope DP3.1: solo `/auth/login`. Altri 401 endpoint → TD-AY.
  private throwInvalidCredentials(): never {
    const body: AuthErrorResponse = {
      statusCode: HttpStatus.UNAUTHORIZED,
      errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      message: 'Credenziali non valide',
      timestamp: new Date().toISOString(),
    };
    throw new HttpException(body, HttpStatus.UNAUTHORIZED);
  }

  // ---------------------------------------------------------------------------
  // LOGIN — email + password (tenantId pre-risolto da TenantMiddleware)
  // ---------------------------------------------------------------------------
  async login(
    tenantId: string,
    email: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokensPayload> {
    // (B1 STOP 3 + TD-H resolution PR 2) Lockout check PRIMA del DB lookup:
    // evita timing leak fra utenti esistenti e non. Key composta `tenant:<id>:
    // email:<email>` → isolamento cross-tenant garantito (un attacker che
    // conosce un'email NON la blocca su altri tenant).
    const lockoutKey = this.LOCKOUT_KEY_LOGIN(tenantId, email);
    if (await this.lockout.checkLockout(lockoutKey)) {
      this.throwAccountLocked();
    }

    const user = await this.users.findByTenantEmail(tenantId, email);

    // Single exception per email-non-trovata + password-errata + utente-disabilitato:
    // no info leak su esistenza account, no enumeration attack.
    if (!user || !user.isActive) {
      const result = await this.lockout.recordFailedAttempt(lockoutKey);
      await this.recordAudit({
        tenantId,
        userId: user?.id,
        action: 'auth.login.failure',
        meta,
        payload: { reason: 'user_not_found_or_inactive' },
      });
      if (result.promotedToLockout) {
        // No user identificabile (email non esiste o utente disabilitato):
        // niente recipient affidabile, skip mail send. Mantieni audit row
        // con emailSent: false + reason esplicito per analytics.
        await this.recordAudit({
          tenantId,
          userId: user?.id,
          action: 'auth.account_locked',
          meta,
          payload: {
            source: 'login',
            lockoutKeyHash: this.lockoutKeyDigest(lockoutKey),
            emailSent: false,
            emailReason: 'no_user',
          },
        });
        // Promosso a lockout DA QUESTA chiamata: la prossima request sara'
        // bloccata da checkLockout(). Per coerenza UX su QUESTA chiamata
        // (l'utente vede 429 invece di 401) rispondiamo subito con 429.
        this.throwAccountLocked();
      }
      this.throwInvalidCredentials();
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      await this.users.incrementFailedAttempts(user.id);
      const result = await this.lockout.recordFailedAttempt(lockoutKey);
      await this.recordAudit({
        tenantId,
        userId: user.id,
        action: 'auth.login.failure',
        meta,
        payload: { reason: 'wrong_password' },
      });
      if (result.promotedToLockout) {
        // User esiste → tentativo invio email notifica lockout. MailService
        // sendSafe fail-open: return false su SMTP down, true su success.
        const emailSent = await this.mail.sendAccountLockedEmail({
          to: user.email,
          identifierHash: this.lockoutKeyDigest(lockoutKey),
          tenantSlug: null, // tenant slug propagation: TD-AZ candidate (post-multi-tenant routing)
          source: 'login',
          lockoutDurationMin: this.LOCKOUT_DURATION_MIN,
        });
        await this.recordAudit({
          tenantId,
          userId: user.id,
          action: 'auth.account_locked',
          meta,
          payload: {
            source: 'login',
            lockoutKeyHash: this.lockoutKeyDigest(lockoutKey),
            emailSent,
            emailReason: emailSent ? null : 'send_failed',
          },
        });
        this.throwAccountLocked();
      }
      this.throwInvalidCredentials();
    }

    // Success: reset Redis counter + DB counter (recordSuccessfulLogin lo
    // azzera + aggiorna lastLoginAt).
    await this.lockout.resetAttempts(lockoutKey);
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

    // /auth/refresh non passa per TenantMiddleware (no header X-Tenant-Slug
    // sui refresh — tenantId arriva dal payload JWT). Wrap esplicito in ALS
    // RLS context dal payload.tenantId per il resto del flusso DB. Decisione
    // 10 ADR-0009.
    return runInTenantContext({ tenantId: payload.tenantId, isSuperAdmin: false }, () =>
      this.refreshInContext(refreshToken, payload, meta),
    );
  }

  /**
   * Body del refresh flow, gira sempre dentro ALS tenant context (vedi sopra).
   * Estratto come metodo privato per leggibilita' (no deep-indent del flow).
   */
  private async refreshInContext(
    refreshToken: string,
    payload: JwtPayload,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokensPayload> {
    const session = await prisma.session.findUnique({
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
    //
    // B2a: aggiunta notifica email all'user legittimo (recupero email via
    // session.userId). Ordine: detect → revoke → email → audit (con flag
    // emailSent) → throw. Email PRIMA di throw, ma DOPO revoke per
    // garantire la security action anche se mail fail (sendSafe fail-open
    // interno comunque, ma defensive).
    if (!session.isActive) {
      const revoked = await prisma.session.updateMany({
        where: { userId: session.userId, isActive: true },
        data: { isActive: false },
      });

      // Riusa `auth.theft_detected` esistente (D2-vitest) — semanticamente
      // copre gia' il refresh-token reuse case. NO nuova action (scoperta
      // empirica #23 STOP 3 B2a).
      const victim = await this.users.findById(session.userId);
      const emailSent = victim?.email
        ? await this.mail.sendRefreshTokenTheftEmail({
            to: victim.email,
            attackerIp: meta.ip ?? null,
            attackerUserAgent: meta.userAgent ?? null,
            revokedSessionCount: revoked.count,
          })
        : false;

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
          emailSent,
          emailReason: emailSent ? null : victim?.email ? 'send_failed' : 'no_email',
        },
      });
      this.logger.warn(
        `Theft detected on user=${session.userId} session=${session.id} revoked=${revoked.count} emailSent=${emailSent}`,
      );
      throw new UnauthorizedException('E_AUTH_THEFT_DETECTED');
    }

    // Rotation normale (D2a flow): disattiva session corrente + crea nuova.
    await prisma.session.update({
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
  // PIN SETUP — re-auth pattern (password) + uniqueness check + hash + save
  // ---------------------------------------------------------------------------
  // Flusso (decisioni 4/5 D2b):
  //   1. Verifica currentPassword via argon2 (anti session-hijack abuse)
  //   2. Valida pattern PIN (validatePin: forbidden patterns)
  //   3. Uniqueness check: argon2.verify loop su tutti i user del tenant con
  //      pin_hash (escluso self). O(N) costo per F1 ok. Tech debt HMAC F2+.
  //   4. Hash PIN con argon2id + persist user.pin_hash
  //   5. Audit log: action = 'auth.pin.setup' (first time) o 'auth.pin.reset'
  //      (overwrite) — determinato a runtime via stato pre-call di pinHash.
  async setupPin(
    userId: string,
    tenantId: string,
    currentPassword: string,
    pin: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ success: true }> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive || user.tenantId !== tenantId) {
      throw new UnauthorizedException(AuthErrorCode.INVALID_CREDENTIALS);
    }

    // Re-auth con password corrente (decisione 4 D2b)
    const passwordOk = await argon2.verify(user.passwordHash, currentPassword);
    if (!passwordOk) {
      await this.recordAudit({
        tenantId,
        userId,
        action: 'auth.login.failure',
        meta,
        payload: { reason: 'pin_setup_password_check_failed' },
      });
      throw new UnauthorizedException(AuthErrorCode.INVALID_CREDENTIALS);
    }

    // Pattern check (decisione 2 D2b)
    const validation = validatePin(pin);
    if (!validation.valid) {
      throw new BadRequestException(validation.reason ?? 'E_AUTH_PIN_FORBIDDEN_PATTERN');
    }

    // Uniqueness check applicativa (decisione 5/6 D2b: F1 loop argon2.verify)
    const peers = await this.users.findAllWithPinByTenant(tenantId, userId);
    for (const peer of peers) {
      if (!peer.pinHash) continue;
      const collision = await argon2.verify(peer.pinHash, pin);
      if (collision) {
        throw new ConflictException('E_AUTH_PIN_TAKEN');
      }
    }

    // Hash + save (idempotente per overwrite)
    const wasReset = user.pinHash !== null;
    const pinHash = await argon2.hash(pin, { type: argon2.argon2id });
    await this.users.setPinHash(userId, pinHash);

    // Audit action discriminata (decisione C D2b pre-flight)
    await this.recordAudit({
      tenantId,
      userId,
      action: wasReset ? 'auth.pin.reset' : 'auth.pin.setup',
      meta,
      payload: { wasReset },
    });

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // LOGIN PIN — scan candidati nel tenant + session POS
  // ---------------------------------------------------------------------------
  // Flusso (decisione 6 D2b, no failed_attempts increment — decisione B):
  //   1. Carica tutti gli user del tenant con pin_hash != null
  //   2. Loop argon2.verify finche' trova match (O(N) costo)
  //   3. Match -> recordSuccessfulLogin + create session POS + JWT pair
  //   4. No match -> audit auth.login_pin.failure + 401 generic
  //
  // Anti-brute baseline: argon2.verify e' lento (rate limiting naturale).
  // Lockout reale tracciato in Auth hardening macro-task (ADR-0008 D2b).
  async loginPin(
    tenantId: string,
    pin: string,
    deviceId: string,
    deviceType: PinLoginDeviceType,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokensPayload> {
    // (B1 STOP 3) Lockout check PRIMA del candidates scan. Key tenant+device
    // (ADR-0008 D2b §8). Anti-DoS sul device legittimo: un attacker che
    // conosce deviceId puo' bloccarlo, ma il lockout 15min e' time-limited.
    // NB: NO DB counter increment per login-pin per design D2b §8 (TD-K).
    const lockoutKey = this.LOCKOUT_KEY_LOGIN_PIN(tenantId, deviceId);
    if (await this.lockout.checkLockout(lockoutKey)) {
      this.throwAccountLocked();
    }

    const candidates = await this.users.findAllWithPinByTenant(tenantId);

    let matchedUserId: string | null = null;
    for (const candidate of candidates) {
      if (!candidate.pinHash) continue;
      const isMatch = await argon2.verify(candidate.pinHash, pin);
      if (isMatch) {
        matchedUserId = candidate.id;
        break;
      }
    }

    if (!matchedUserId) {
      const result = await this.lockout.recordFailedAttempt(lockoutKey);
      await this.recordAudit({
        tenantId,
        userId: undefined,
        action: 'auth.login_pin.failure',
        meta,
        payload: { reason: 'no_pin_match', deviceId, deviceType },
      });
      if (result.promotedToLockout) {
        // No user identificabile (pin no match → non sappiamo a chi era
        // diretto il tentativo). Skip mail send. Audit flag esplicito per
        // analytics: distingue da `no_email` (user senza email registrata).
        await this.recordAudit({
          tenantId,
          userId: undefined,
          action: 'auth.account_locked',
          meta,
          payload: {
            source: 'login-pin',
            deviceId,
            deviceType,
            lockoutKeyHash: this.lockoutKeyDigest(lockoutKey),
            emailSent: false,
            emailReason: 'no_user_pin_lockout',
          },
        });
        this.throwAccountLocked();
      }
      throw new UnauthorizedException(AuthErrorCode.INVALID_CREDENTIALS);
    }

    await this.lockout.resetAttempts(lockoutKey);
    await this.users.recordSuccessfulLogin(matchedUserId);

    const tokens = await this.issueTokensAndCreateSession(matchedUserId, tenantId, meta, null, {
      deviceId,
      deviceType,
    });

    await this.recordAudit({
      tenantId,
      userId: matchedUserId,
      action: 'auth.login_pin.success',
      meta,
      payload: { deviceId, deviceType },
    });

    return tokens;
  }

  // ---------------------------------------------------------------------------
  // LOGOUT — invalida session corrente
  // ---------------------------------------------------------------------------
  async logout(sessionId: string, userId: string, tenantId: string): Promise<void> {
    await prisma.session.update({
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
  // FORGOT PASSWORD — genera token monouso + invia email (no oracle)
  // ---------------------------------------------------------------------------
  // (ADR-0008) Sicurezza:
  //   - Response SEMPRE { success: true } indipendentemente dall'esistenza
  //     dell'email: niente enumeration (parità con login no-info-leak).
  //   - Token = 32 byte random hex; in DB salviamo SOLO sha256(token).
  //   - I reset pendenti precedenti dello stesso user vengono invalidati
  //     (un solo link valido alla volta).
  //   - Email inviata solo se l'utente esiste ed è attivo (no destinatario → no send).
  //   - tenantId pre-risolto da TenantMiddleware (endpoint @Public pre-auth).
  async forgotPassword(
    tenantId: string,
    tenantSlug: string,
    email: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ success: true }> {
    const user = await this.users.findByTenantEmail(tenantId, email);

    if (!user || !user.isActive) {
      // No oracle: stessa response. Audit del tentativo senza recipient reale.
      await this.recordAudit({
        tenantId,
        userId: undefined,
        action: 'auth.password_reset.requested',
        meta,
        payload: { emailSent: false, reason: 'user_not_found_or_inactive' },
      });
      return { success: true };
    }

    // Invalida eventuali token pendenti dello stesso user (single-active-link).
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);

    await prisma.passwordReset.create({
      data: {
        id: id(),
        tenantId,
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    // Link tenant-scoped: la route FE è /t/<slug>/reset-password (multi-tenant
    // path-based, TD-2 ADR-0012). Lo slug arriva dal controller (X-Tenant-Slug
    // validato da TenantMiddleware) — il service ha solo il tenantId.
    const resetLink = `${this.resetUrlBase()}/t/${tenantSlug}/reset-password?token=${token}`;
    const emailSent = await this.mail.sendPasswordResetEmail({
      to: user.email,
      resetLink,
      firstName: user.firstName,
    });

    await this.recordAudit({
      tenantId,
      userId: user.id,
      action: 'auth.password_reset.requested',
      meta,
      payload: { emailSent, emailReason: emailSent ? null : 'send_failed' },
    });

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // RESET PASSWORD — consuma token monouso + set nuova password
  // ---------------------------------------------------------------------------
  // Flusso:
  //   1. Re-valida lunghezza password server-side (ValidationPipe non gira in E2E).
  //   2. Lookup per sha256(token) scoped al tenant. Assente/usato → INVALID.
  //   3. Scaduto → EXPIRED (distinto solo per UX).
  //   4. User assente/disattivo/cross-tenant → INVALID (no leak).
  //   5. Tx atomica: update password + mark token used + revoke TUTTE le
  //      sessioni attive + reset failed counter. Cambio password = logout globale.
  async resetPassword(
    tenantId: string,
    token: string,
    newPassword: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ success: true }> {
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(AuthErrorCode.PASSWORD_TOO_SHORT);
    }

    const tokenHash = this.hashToken(token);
    const reset = await prisma.passwordReset.findFirst({
      where: { tokenHash, tenantId },
    });

    if (!reset || reset.usedAt) {
      await this.recordAudit({
        tenantId,
        userId: reset?.userId,
        action: 'auth.password_reset.failure',
        meta,
        payload: { reason: reset ? 'token_used' : 'token_not_found' },
      });
      throw new BadRequestException(AuthErrorCode.RESET_TOKEN_INVALID);
    }

    if (reset.expiresAt < new Date()) {
      await this.recordAudit({
        tenantId,
        userId: reset.userId,
        action: 'auth.password_reset.failure',
        meta,
        payload: { reason: 'token_expired' },
      });
      throw new BadRequestException(AuthErrorCode.RESET_TOKEN_EXPIRED);
    }

    const user = await this.users.findById(reset.userId);
    if (!user || !user.isActive || user.tenantId !== tenantId) {
      await this.recordAudit({
        tenantId,
        userId: reset.userId,
        action: 'auth.password_reset.failure',
        meta,
        payload: { reason: 'user_invalid' },
      });
      throw new BadRequestException(AuthErrorCode.RESET_TOKEN_INVALID);
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });

    // Tx atomica: password + token usato + sessioni revocate (logout globale
    // post cambio password) + reset contatore tentativi falliti.
    const revoked = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginAttempts: 0 },
      });
      await tx.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      });
      const sessions = await tx.session.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false },
      });
      return sessions.count;
    });

    await this.recordAudit({
      tenantId,
      userId: user.id,
      action: 'auth.password_reset.completed',
      meta,
      payload: { revokedSessionCount: revoked },
    });

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** sha256 hex del token: in DB sta solo l'hash, mai il plaintext. */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Base URL del FE per costruire il reset link. Env `PASSWORD_RESET_URL_BASE`
   * (dedicato) → fallback `CORS_ORIGIN` (già configurato) → default dev.
   * Trailing slash normalizzato.
   */
  private resetUrlBase(): string {
    const base =
      this.config.get<string>('PASSWORD_RESET_URL_BASE') ??
      this.config.get<string>('CORS_ORIGIN') ??
      'http://localhost:3003';
    return base.replace(/\/+$/, '');
  }

  private async issueTokensAndCreateSession(
    userId: string,
    tenantId: string,
    meta: { ip?: string; userAgent?: string },
    sedeId: string | null = null,
    deviceOverride?: { deviceId: string; deviceType: PinLoginDeviceType },
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

    await prisma.session.create({
      data: {
        id: sessionId,
        userId,
        sedeId,
        // Login email/password: device_type='web' + device_id derivato da UA.
        // Login PIN: device_type='pos_tablet'/'pos_desktop'/'mobile' + device_id
        // dal client (DTO).
        deviceId: deviceOverride?.deviceId ?? meta.userAgent?.slice(0, 64) ?? 'unknown',
        deviceType: deviceOverride?.deviceType ?? 'web',
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
      await prisma.auditLog.create({
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
