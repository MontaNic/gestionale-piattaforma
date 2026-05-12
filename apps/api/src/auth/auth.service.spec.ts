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

import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbService } from '../db/db.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

// Mock argon2 module-level: verify() configurabile per test, hash() ritorna
// stub deterministico per evitare cost CPU del KDF reale durante i test.
vi.mock('argon2', () => ({
  default: {
    verify: vi.fn(),
    hash: vi.fn().mockResolvedValue('argon2$mocked$hash'),
    argon2id: 2,
  },
}));

// Mock @gestionale/db module-level. AuthService importa solo `id()`; DbService
// importa `prisma` (singleton) ma nei test usiamo `useValue` con mock manuale,
// quindi `prisma` esportato qui non viene mai chiamato — basta esista perche'
// l'import statico di DbService non lanci ReferenceError al module load.
vi.mock('@gestionale/db', () => ({
  id: vi.fn(() => '00000000-0000-7000-8000-000000000001'),
  prisma: {},
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
  let prisma: {
    session: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    auditLog: { create: ReturnType<typeof vi.fn> };
  };
  let jwt: { signAsync: ReturnType<typeof vi.fn>; verifyAsync: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    users = {
      findByTenantEmail: vi.fn(),
      findById: vi.fn(),
      incrementFailedAttempts: vi.fn().mockResolvedValue(undefined),
      recordSuccessfulLogin: vi.fn().mockResolvedValue(undefined),
      findAllWithPinByTenant: vi.fn().mockResolvedValue([]),
      setPinHash: vi.fn().mockResolvedValue(undefined),
    };
    prisma = {
      session: {
        create: vi.fn().mockResolvedValue(baseSession),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue(baseSession),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn().mockResolvedValue(undefined) },
    };
    jwt = {
      signAsync: vi.fn().mockResolvedValue('eyJ.mocked.token'),
      verifyAsync: vi.fn(),
    };

    // Manual instantiation: cast dei mock al tipo dei collaboratori reali.
    // Bypass del DI container Nest (vedi nota sopra su emitDecoratorMetadata).
    auth = new AuthService(
      { prisma } as unknown as DbService,
      users as unknown as UsersService,
      jwt as unknown as JwtService,
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
  it('login wrong password: throws + increments failed_login_attempts', async () => {
    users.findByTenantEmail.mockResolvedValue(baseUser);
    vi.mocked(argon2.verify).mockResolvedValue(false);

    await expect(
      auth.login(TENANT_ID, baseUser.email, 'WrongPass!', { ip: '10.0.0.1' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(users.incrementFailedAttempts).toHaveBeenCalledWith(USER_ID);
    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(prisma.auditLog.create.mock.calls[0]?.[0]?.data.action).toBe('auth.login.failure');
    expect(prisma.auditLog.create.mock.calls[0]?.[0]?.data.afterValue).toMatchObject({
      reason: 'wrong_password',
    });
  });

  // ─── Test 3 — login email/tenant invalid (no info leak) ────────────────────
  it('login user not found: throws E_AUTH_INVALID_CREDENTIALS (no info leak)', async () => {
    users.findByTenantEmail.mockResolvedValue(null);

    await expect(
      auth.login(TENANT_ID, 'unknown@nowhere.local', 'Whatever123!', { ip: '10.0.0.1' }),
    ).rejects.toThrow(
      // Stesso messaggio di "wrong password" + "user disabled" -> no enumeration
      expect.objectContaining({ message: 'E_AUTH_INVALID_CREDENTIALS' }),
    );

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
