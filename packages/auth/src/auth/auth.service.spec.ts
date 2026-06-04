// =============================================================================
// auth.service.spec.ts — Test essential su AuthService (D2-vitest)
// =============================================================================
// 4 test:
//   1. login success           -> JWT pair returned + session created
//   2. login wrong password    -> throws + failed_login_attempts++
//   3. login tenant invalid    -> throws E_AUTH_INVALID_CREDENTIALS (no leak)
//   4. refresh theft detection -> revoke all sessions + audit forense
//
// Mock strategy: vi.fn() su DbService + UsersService + JwtService via
// Test.createTestingModule({providers: useValue}). Argon2 mocked module-level
// per controllo deterministico delle verify (no hashing in-test).
// =============================================================================

// Nota: bypassiamo Test.createTestingModule() perche' Vitest/esbuild non emette
// `emitDecoratorMetadata`, quindi il DI container Nest non puo' risolvere i
// providers via reflection (stesso problema scoperto in D1 con tsx, ADR-0007).
// Instanziamo AuthService manualmente con i mock cast a tipo dei collaboratori.
// Niente perdita di significato: stiamo testando la business logic, non il DI.

import type { JwtService } from '@nestjs/jwt';
import type { MailService } from '@gestionale/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type { LockoutService } from './lockout.service';

// Mock argon2 module-level: verify() configurabile per test, hash() ritorna
// stub deterministico per evitare cost CPU del KDF reale durante i test.
vi.mock('argon2', () => ({
  default: {
    verify: vi.fn(),
    hash: vi.fn().mockResolvedValue('argon2$mocked$hash'),
    argon2id: 2,
  },
}));

// Mock @gestionale/db module-level. AuthService usa `id()`, gli helper ALS e il
// singleton `prisma` (post sub-7a: accesso diretto, non piu' via DbService).
// `prisma` e' un mock hoisted di cui i test controllano session/auditLog.
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('@gestionale/db', () => ({
  id: vi.fn(() => '00000000-0000-7000-8000-000000000001'),
  prisma: mockPrisma,
  uuidv7: vi.fn(() => '00000000-0000-7000-8000-000000000001'),
  createPrismaClient: vi.fn(),
  // RLS helpers (D3a): AuthService.refresh wrappa il flusso in runInTenantContext.
  // I test bypassano il DI Prisma reale, quindi runInTenantContext deve solo
  // eseguire la callback direttamente senza ALS reale. withSystemContext
  // / withSuperAdminContext seguono lo stesso pattern (non chiamati nei test
  // attuali ma esportati per coerenza).
  runInTenantContext: vi.fn(<T>(_ctx: unknown, fn: () => Promise<T> | T) => Promise.resolve(fn())),
  withSystemContext: vi.fn(<T>(fn: () => Promise<T> | T) => Promise.resolve(fn())),
  withSuperAdminContext: vi.fn(<T>(_tenantId: string, fn: () => Promise<T> | T) =>
    Promise.resolve(fn()),
  ),
}));

import argon2 from 'argon2';

// ─── Fixture builders ────────────────────────────────────────────────────────
const TENANT_ID = '00000000-0000-7000-8000-aaaaaaaaaaaa';
const USER_ID = '00000000-0000-7000-8000-bbbbbbbbbbbb';
const SESSION_ID = '00000000-0000-7000-8000-cccccccccccc';

const baseUser = {
  id: USER_ID,
  tenantId: TENANT_ID,
  email: 'admin@demo.local',
  passwordHash: 'argon2$existing$hash',
  pinHash: null,
  firstName: 'Admin',
  lastName: 'Demo',
  isActive: true,
  failedLoginAttempts: 0,
  emailVerifiedAt: null,
  lastLoginAt: null,
  totpSecret: null,
  validUntil: null,
  badgeNfcId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const baseSession = {
  id: SESSION_ID,
  userId: USER_ID,
  sedeId: null,
  deviceId: 'test-agent',
  deviceType: 'web' as const,
  refreshTokenHash: 'argon2$existing$refresh-hash',
  ip: '127.0.0.1',
  userAgent: 'test-agent',
  lastSeenAt: new Date(),
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let auth: AuthService;
  let users: {
    findByTenantEmail: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    incrementFailedAttempts: ReturnType<typeof vi.fn>;
    recordSuccessfulLogin: ReturnType<typeof vi.fn>;
    findAllWithPinByTenant: ReturnType<typeof vi.fn>;
    setPinHash: ReturnType<typeof vi.fn>;
  };
  const prisma = mockPrisma;
  let jwt: { signAsync: ReturnType<typeof vi.fn>; verifyAsync: ReturnType<typeof vi.fn> };
  let lockout: {
    checkLockout: ReturnType<typeof vi.fn>;
    recordFailedAttempt: ReturnType<typeof vi.fn>;
    resetAttempts: ReturnType<typeof vi.fn>;
  };
  let mail: {
    sendAccountLockedEmail: ReturnType<typeof vi.fn>;
    sendRefreshTokenTheftEmail: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    users = {
      findByTenantEmail: vi.fn(),
      findById: vi.fn(),
      incrementFailedAttempts: vi.fn().mockResolvedValue(undefined),
      recordSuccessfulLogin: vi.fn().mockResolvedValue(undefined),
      findAllWithPinByTenant: vi.fn().mockResolvedValue([]),
      setPinHash: vi.fn().mockResolvedValue(undefined),
    };
    prisma.session.create.mockReset().mockResolvedValue(baseSession);
    prisma.session.findUnique.mockReset();
    prisma.session.update.mockReset().mockResolvedValue(baseSession);
    prisma.session.updateMany.mockReset();
    prisma.auditLog.create.mockReset().mockResolvedValue(undefined);
    jwt = {
      signAsync: vi.fn().mockResolvedValue('eyJ.mocked.token'),
      verifyAsync: vi.fn(),
    };
    // Lockout mock di compatibility: i 6 test pre-esistenti non sondano la
    // lockout logic (quello e' STOP 4). Default: NON bloccato, NON promosso.
    // Test specifici per LockoutService verranno in STOP 4.
    lockout = {
      checkLockout: vi.fn().mockResolvedValue(null),
      recordFailedAttempt: vi.fn().mockResolvedValue({ promotedToLockout: false }),
      resetAttempts: vi.fn().mockResolvedValue(undefined),
    };
    // Mail mock compat (B2a STOP 3): i test esistenti non triggherano
    // lockout transition o theft, quindi i metodi mail non vengono invocati;
    // default return true (sent) per semantica positiva quando chiamati.
    mail = {
      sendAccountLockedEmail: vi.fn().mockResolvedValue(true),
      sendRefreshTokenTheftEmail: vi.fn().mockResolvedValue(true),
    };

    // Manual instantiation: cast dei mock al tipo dei collaboratori reali.
    // Bypass del DI container Nest (vedi nota sopra su emitDecoratorMetadata).
    auth = new AuthService(
      users as unknown as UsersService,
      jwt as unknown as JwtService,
      lockout as unknown as LockoutService,
      mail as unknown as MailService,
    );

    vi.mocked(argon2.verify).mockReset();
    vi.mocked(argon2.hash).mockResolvedValue('argon2$mocked$hash');
  });

  // ─── Test 1 — login success ────────────────────────────────────────────────
  it('login success: returns JWT pair + creates session + records audit', async () => {
    users.findByTenantEmail.mockResolvedValue(baseUser);
    vi.mocked(argon2.verify).mockResolvedValue(true);

    const tokens = await auth.login(TENANT_ID, baseUser.email, 'CorrectPass!', {
      ip: '10.0.0.1',
      userAgent: 'curl/test',
    });

    expect(tokens.accessToken).toBe('eyJ.mocked.token');
    expect(tokens.refreshToken).toBe('eyJ.mocked.token');
    expect(tokens.expiresIn).toBe(15 * 60);

    // Session creata
    expect(prisma.session.create).toHaveBeenCalledOnce();
    const sessionData = prisma.session.create.mock.calls[0]?.[0]?.data;
    expect(sessionData?.userId).toBe(USER_ID);
    expect(sessionData?.deviceType).toBe('web');
    expect(sessionData?.isActive).toBe(true);

    // Audit "auth.login.success" registrato
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(prisma.auditLog.create.mock.calls[0]?.[0]?.data.action).toBe('auth.login.success');

    // Failed attempts resettato (login success)
    expect(users.recordSuccessfulLogin).toHaveBeenCalledWith(USER_ID);
    expect(users.incrementFailedAttempts).not.toHaveBeenCalled();
  });

  // ─── Test 2 — login wrong password ─────────────────────────────────────────
  it('login wrong password: throws 401 with errorCode + increments failed_login_attempts', async () => {
    users.findByTenantEmail.mockResolvedValue(baseUser);
    vi.mocked(argon2.verify).mockResolvedValue(false);

    // TD-AJ resolution: body 401 esplicito con errorCode + message localizzato + timestamp.
    await expect(
      auth.login(TENANT_ID, baseUser.email, 'WrongPass!', { ip: '10.0.0.1' }),
    ).rejects.toMatchObject({
      status: 401,
      response: {
        statusCode: 401,
        errorCode: 'E_AUTH_INVALID_CREDENTIALS',
        message: 'Credenziali non valide',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    });

    expect(users.incrementFailedAttempts).toHaveBeenCalledWith(USER_ID);
    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(prisma.auditLog.create.mock.calls[0]?.[0]?.data.action).toBe('auth.login.failure');
    expect(prisma.auditLog.create.mock.calls[0]?.[0]?.data.afterValue).toMatchObject({
      reason: 'wrong_password',
    });
  });

  // ─── Test 3 — login email/tenant invalid (no info leak) ────────────────────
  it('login user not found: throws 401 errorCode E_AUTH_INVALID_CREDENTIALS (no info leak)', async () => {
    users.findByTenantEmail.mockResolvedValue(null);

    // Stesso shape body di "wrong password" + "user disabled" → no enumeration.
    await expect(
      auth.login(TENANT_ID, 'unknown@nowhere.local', 'Whatever123!', { ip: '10.0.0.1' }),
    ).rejects.toMatchObject({
      status: 401,
      response: {
        statusCode: 401,
        errorCode: 'E_AUTH_INVALID_CREDENTIALS',
        message: 'Credenziali non valide',
      },
    });

    // Niente increment failed attempts (no user da incrementare)
    expect(users.incrementFailedAttempts).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();

    // Audit log "auth.login.failure" con reason 'user_not_found_or_inactive'
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(prisma.auditLog.create.mock.calls[0]?.[0]?.data.action).toBe('auth.login.failure');
    expect(prisma.auditLog.create.mock.calls[0]?.[0]?.data.afterValue).toMatchObject({
      reason: 'user_not_found_or_inactive',
    });
  });

  // ─── Test 4 — refresh theft detection ──────────────────────────────────────
  it('refresh with rotated token: triggers theft detection, revokes all user sessions, audit forensics', async () => {
    // Setup: JWT verify OK, session esiste ma is_active=false (rotated), hash matches
    jwt.verifyAsync.mockResolvedValue({
      sub: USER_ID,
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      type: 'refresh',
    });
    prisma.session.findUnique.mockResolvedValue({ ...baseSession, isActive: false });
    vi.mocked(argon2.verify).mockResolvedValue(true);
    prisma.session.updateMany.mockResolvedValue({ count: 3 }); // 3 sessions attive revocate

    await expect(
      auth.refresh('eyJ.stolen.refresh', { ip: '6.6.6.6', userAgent: 'attacker-agent' }),
    ).rejects.toThrow(expect.objectContaining({ message: 'E_AUTH_THEFT_DETECTED' }));

    // Revoke all user sessions chiamato con filter giusto
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, isActive: true },
      data: { isActive: false },
    });

    // Audit log "auth.theft_detected" con payload forense completo
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    const auditCall = prisma.auditLog.create.mock.calls[0]?.[0]?.data;
    expect(auditCall.action).toBe('auth.theft_detected');
    expect(auditCall.userId).toBe(USER_ID);
    expect(auditCall.tenantId).toBe(TENANT_ID);
    expect(auditCall.ip).toBe('6.6.6.6');
    expect(auditCall.userAgent).toBe('attacker-agent');
    expect(auditCall.afterValue).toMatchObject({
      revokedSessionCount: 3,
      suspectedSessionId: SESSION_ID,
      attackerIp: '6.6.6.6',
      attackerUserAgent: 'attacker-agent',
    });

    // Niente nuova session emessa (theft block, no rotation)
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  // ─── Test 5 — setupPin success (D2b) ──────────────────────────────────────
  it('setupPin success: re-auth OK + uniqueness clean + hashes PIN + audit auth.pin.setup', async () => {
    // User esiste, password verifica, nessun peer con PIN -> first-time setup
    users.findById.mockResolvedValue({ ...baseUser, pinHash: null });
    vi.mocked(argon2.verify).mockResolvedValueOnce(true); // verify currentPassword
    users.findAllWithPinByTenant.mockResolvedValue([]); // nessun peer con PIN

    const result = await auth.setupPin(USER_ID, TENANT_ID, 'Admin123!', '4827', {
      ip: '10.0.0.1',
      userAgent: 'curl/test',
    });

    expect(result).toEqual({ success: true });

    // PIN hashato + salvato
    expect(argon2.hash).toHaveBeenCalledWith('4827', { type: 2 });
    expect(users.setPinHash).toHaveBeenCalledWith(USER_ID, 'argon2$mocked$hash');

    // Audit "auth.pin.setup" (wasReset=false, era pinHash null pre-call)
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    const auditCall = prisma.auditLog.create.mock.calls[0]?.[0]?.data;
    expect(auditCall.action).toBe('auth.pin.setup');
    expect(auditCall.afterValue).toMatchObject({ wasReset: false });
  });

  // ─── Test 7 — TD-H: lockout key cross-tenant isolation (recordFailedAttempt) ─
  // Stessa email su tenant A vs tenant B → key Redis differenti, NO leak DoS
  // cross-tenant (un attacker che conosce email NON blocca altri tenant).
  it('TD-H: recordFailedAttempt uses tenant-scoped key (cross-tenant isolation)', async () => {
    const TENANT_A = '00000000-0000-7000-8000-aaaaaaaaaaaa';
    const TENANT_B = '00000000-0000-7000-8000-bbbbbbbbbbbb';
    const SHARED_EMAIL = 'admin@shared.local';

    users.findByTenantEmail.mockResolvedValue(null); // user_not_found path

    await expect(
      auth.login(TENANT_A, SHARED_EMAIL, 'Wrong!', { ip: '1.1.1.1' }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      auth.login(TENANT_B, SHARED_EMAIL, 'Wrong!', { ip: '1.1.1.1' }),
    ).rejects.toMatchObject({ status: 401 });

    expect(lockout.recordFailedAttempt).toHaveBeenCalledTimes(2);
    const keyA = lockout.recordFailedAttempt.mock.calls[0]?.[0];
    const keyB = lockout.recordFailedAttempt.mock.calls[1]?.[0];
    expect(keyA).toBe(`tenant:${TENANT_A}:email:${SHARED_EMAIL}`);
    expect(keyB).toBe(`tenant:${TENANT_B}:email:${SHARED_EMAIL}`);
    expect(keyA).not.toBe(keyB);
  });

  // ─── Test 8 — TD-H: checkLockout uses tenant-scoped key ───────────────────
  // Lockout su tenant A → tentativo login tenant B chiama checkLockout con
  // key diversa → NON blocked (cross-tenant DoS prevented).
  it('TD-H: checkLockout uses tenant-scoped key (lockout A does NOT block tenant B)', async () => {
    const TENANT_A = '00000000-0000-7000-8000-aaaaaaaaaaaa';
    const TENANT_B = '00000000-0000-7000-8000-bbbbbbbbbbbb';
    const SHARED_EMAIL = 'admin@shared.local';

    // Tenant A → checkLockout ritorna locked, tenant B → null (not locked).
    lockout.checkLockout.mockImplementation((key: string) =>
      Promise.resolve(
        key.startsWith(`tenant:${TENANT_A}:`) ? { locked: true, retryAfterSec: 600 } : null,
      ),
    );
    users.findByTenantEmail.mockResolvedValue(baseUser);
    vi.mocked(argon2.verify).mockResolvedValue(true);

    // Tenant A: throws (lockout active)
    await expect(
      auth.login(TENANT_A, SHARED_EMAIL, 'Pass!', { ip: '1.1.1.1' }),
    ).rejects.toMatchObject({ status: 429 });

    // Tenant B: success (no lockout su key tenant B)
    const tokens = await auth.login(TENANT_B, SHARED_EMAIL, 'Pass!', { ip: '1.1.1.1' });
    expect(tokens.accessToken).toBe('eyJ.mocked.token');

    expect(lockout.checkLockout).toHaveBeenCalledTimes(2);
    expect(lockout.checkLockout.mock.calls[0]?.[0]).toBe(
      `tenant:${TENANT_A}:email:${SHARED_EMAIL}`,
    );
    expect(lockout.checkLockout.mock.calls[1]?.[0]).toBe(
      `tenant:${TENANT_B}:email:${SHARED_EMAIL}`,
    );
  });

  // ─── Test 9 — TD-H: resetAttempts uses tenant-scoped key ──────────────────
  // Login success tenant A → resetAttempts SOLO per key tenant A. Lockout
  // hypothetical tenant B persiste (key isolation su reset).
  it('TD-H: resetAttempts uses tenant-scoped key (clear A does NOT reset tenant B)', async () => {
    const TENANT_A = '00000000-0000-7000-8000-aaaaaaaaaaaa';
    const SHARED_EMAIL = 'admin@shared.local';

    users.findByTenantEmail.mockResolvedValue(baseUser);
    vi.mocked(argon2.verify).mockResolvedValue(true);

    await auth.login(TENANT_A, SHARED_EMAIL, 'Pass!', { ip: '1.1.1.1' });

    expect(lockout.resetAttempts).toHaveBeenCalledOnce();
    expect(lockout.resetAttempts.mock.calls[0]?.[0]).toBe(
      `tenant:${TENANT_A}:email:${SHARED_EMAIL}`,
    );
  });

  // ─── Test 6 — loginPin success (D2b) ──────────────────────────────────────
  it('loginPin success: matches user via argon2 loop, creates POS session, returns JWT pair', async () => {
    // Setup: 2 candidati nel tenant, il secondo matcha
    users.findAllWithPinByTenant.mockResolvedValue([
      { id: 'other-user', tenantId: TENANT_ID, pinHash: 'argon2$other$hash' },
      { id: USER_ID, tenantId: TENANT_ID, pinHash: 'argon2$matching$hash' },
    ]);
    // argon2.verify: false sul primo, true sul secondo
    vi.mocked(argon2.verify).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const tokens = await auth.loginPin(TENANT_ID, '4827', 'tablet-01', 'pos_tablet', {
      ip: '10.0.0.1',
      userAgent: 'POSApp/1.0',
    });

    expect(tokens.accessToken).toBe('eyJ.mocked.token');
    expect(tokens.refreshToken).toBe('eyJ.mocked.token');
    expect(tokens.expiresIn).toBe(15 * 60);

    // Session POS creata con device override (decisione D D2b)
    expect(prisma.session.create).toHaveBeenCalledOnce();
    const sessionData = prisma.session.create.mock.calls[0]?.[0]?.data;
    expect(sessionData?.userId).toBe(USER_ID);
    expect(sessionData?.deviceId).toBe('tablet-01');
    expect(sessionData?.deviceType).toBe('pos_tablet');

    // recordSuccessfulLogin chiamato sul user matched
    expect(users.recordSuccessfulLogin).toHaveBeenCalledWith(USER_ID);

    // 2 audit logs: auth.login.success (issue tokens) + auth.login_pin.success
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    const actions = prisma.auditLog.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { data: { action: string } })?.data?.action,
    );
    expect(actions).toContain('auth.login_pin.success');
  });
});
