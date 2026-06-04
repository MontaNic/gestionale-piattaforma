// =============================================================================
// permissions.guard.spec.ts — Unit test PermissionsGuard isolato
// =============================================================================
// Mock di tutte le 5 deps: Reflector, UsersService, RedisService, ConfigService,
// DbService. Cache + audit dedupe testati senza Redis reale (vi.fn() su getClient).
//
// Scope coverage:
// - no metadata → allow (Guard opt-in)
// - metadata + no user → throw E_AUTH_NOT_AUTHENTICATED
// - AND mode: all pass / one fail (short-circuit)
// - OR mode: any pass (short-circuit) / all fail
// - Cache: HIT '1' (skip DB) / HIT '0' / MISS (DB + SET) / Redis DOWN GET (fallback DB)
// - Cache write fail (silent, non blocca)
// - Audit deny: dedupe NX 'OK' → insert / dedupe null (esiste) → skip insert
// - Audit dedupe Redis DOWN → fail-open audit insert SEMPRE
//
// NO Testcontainers: Guard isolato, scope E2E STOP 4.
// =============================================================================

import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi, type Mocked } from 'vitest';

import type { RedisService } from '@gestionale/platform';
import type { UsersService } from '../../users/users.service';
import type { PermissionsMetadata } from '../interfaces/permissions-metadata.interface';
import { PermissionsGuard } from './permissions.guard';

// Mock @gestionale/db: post sub-7a la guard accede al singleton `prisma` (audit
// insert su deny path) e usa runInTenantContext/id. `prisma` e' un mock hoisted;
// runInTenantContext passthrough (esegue la callback senza ALS reale).
const { mockDbPrisma } = vi.hoisted(() => ({
  mockDbPrisma: { auditLog: { create: vi.fn() } },
}));

vi.mock('@gestionale/db', () => ({
  id: vi.fn(() => '00000000-0000-7000-8000-00000000a0d1'),
  prisma: mockDbPrisma,
  runInTenantContext: vi.fn(<T>(_ctx: unknown, fn: () => Promise<T> | T) => Promise.resolve(fn())),
  withSystemContext: vi.fn(<T>(fn: () => Promise<T> | T) => Promise.resolve(fn())),
}));

interface MockContextOptions {
  user: { id: string; tenantId: string } | undefined;
}

function createMockContext({ user }: MockContextOptions): ExecutionContext {
  const request = {
    user,
    method: 'GET',
    url: '/api/v1/test',
    route: { path: '/test' },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

interface MockRedisClient {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

function createGuard(): {
  guard: PermissionsGuard;
  reflector: Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  usersService: Mocked<Pick<UsersService, 'hasPermission'>>;
  redisClient: MockRedisClient;
  auditCreate: ReturnType<typeof vi.fn>;
} {
  const reflector = { getAllAndOverride: vi.fn() };
  const usersService = { hasPermission: vi.fn() };

  const redisClient: MockRedisClient = { get: vi.fn(), set: vi.fn() };
  const redisService = {
    getClient: () => redisClient,
  } as unknown as RedisService;

  const configService = {
    get: vi.fn().mockReturnValue('60'),
  } as unknown as ConfigService;

  // audit insert ora va sul singleton `prisma` mockato (hoisted). Reset per-guard
  // così ogni test parte pulito; default resolved (insert ok).
  mockDbPrisma.auditLog.create.mockReset().mockResolvedValue({});
  const auditCreate = mockDbPrisma.auditLog.create;

  const guard = new PermissionsGuard(
    reflector as unknown as Reflector,
    usersService as unknown as UsersService,
    redisService,
    configService,
  );

  return { guard, reflector, usersService, redisClient, auditCreate };
}

describe('PermissionsGuard', () => {
  describe('endpoint NON protetto (no metadata)', () => {
    it('allow se metadata absent', async () => {
      const { guard, reflector, usersService } = createGuard();
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(usersService.hasPermission).not.toHaveBeenCalled();
    });

    it('allow se metadata ha permissions array vuoto (caso teorico)', async () => {
      const { guard, reflector, usersService } = createGuard();
      reflector.getAllAndOverride.mockReturnValue({ mode: 'AND', permissions: [] });
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(usersService.hasPermission).not.toHaveBeenCalled();
    });
  });

  describe('endpoint protetto — auth check', () => {
    it('throw E_AUTH_NOT_AUTHENTICATED se user mancante', async () => {
      const { guard, reflector, usersService } = createGuard();
      reflector.getAllAndOverride.mockReturnValue({ mode: 'AND', permissions: ['p1'] });
      const ctx = createMockContext({ user: undefined });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(usersService.hasPermission).not.toHaveBeenCalled();
    });
  });

  describe('AND mode', () => {
    it('allow se tutte permissions passano (cache MISS + DB lookup + SET cache)', async () => {
      const { guard, reflector, usersService, redisClient } = createGuard();
      const metadata: PermissionsMetadata = { mode: 'AND', permissions: ['p1', 'p2'] };
      reflector.getAllAndOverride.mockReturnValue(metadata);
      redisClient.get.mockResolvedValue(null); // MISS x2
      usersService.hasPermission.mockResolvedValue(true);
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(usersService.hasPermission).toHaveBeenCalledTimes(2);
      // 2 SET cache calls (TTL 60s, value '1')
      expect(redisClient.set).toHaveBeenCalledWith('permissions:user:u1:perm:p1', '1', 'EX', 60);
      expect(redisClient.set).toHaveBeenCalledWith('permissions:user:u1:perm:p2', '1', 'EX', 60);
    });

    it('deny + throw + audit insert se anche solo una fail (short-circuit)', async () => {
      const { guard, reflector, usersService, redisClient, auditCreate } = createGuard();
      const metadata: PermissionsMetadata = {
        mode: 'AND',
        permissions: ['p1', 'p2', 'p3'],
      };
      reflector.getAllAndOverride.mockReturnValue(metadata);
      redisClient.get.mockResolvedValue(null);
      usersService.hasPermission.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      // dedupe SET NX → 'OK' (audit insert)
      redisClient.set.mockResolvedValue('OK');
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      // Short-circuit: stop a primo false (no chiamata su p3)
      expect(usersService.hasPermission).toHaveBeenCalledTimes(2);
      expect(auditCreate).toHaveBeenCalledTimes(1);
      expect(auditCreate.mock.calls[0]?.[0]?.data?.action).toBe('auth.permission_denied');
    });
  });

  describe('OR mode', () => {
    it('allow se almeno una passa (short-circuit)', async () => {
      const { guard, reflector, usersService, redisClient } = createGuard();
      const metadata: PermissionsMetadata = { mode: 'OR', permissions: ['p1', 'p2', 'p3'] };
      reflector.getAllAndOverride.mockReturnValue(metadata);
      redisClient.get.mockResolvedValue(null);
      usersService.hasPermission.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      // Short-circuit: stop a primo true (no chiamata su p3)
      expect(usersService.hasPermission).toHaveBeenCalledTimes(2);
    });

    it('deny se TUTTE fail + audit insert', async () => {
      const { guard, reflector, usersService, redisClient, auditCreate } = createGuard();
      const metadata: PermissionsMetadata = { mode: 'OR', permissions: ['p1', 'p2'] };
      reflector.getAllAndOverride.mockReturnValue(metadata);
      redisClient.get.mockResolvedValue(null);
      usersService.hasPermission.mockResolvedValue(false);
      redisClient.set.mockResolvedValue('OK');
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(usersService.hasPermission).toHaveBeenCalledTimes(2);
      expect(auditCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache Redis', () => {
    it('HIT "1" → no DB call', async () => {
      const { guard, reflector, usersService, redisClient } = createGuard();
      reflector.getAllAndOverride.mockReturnValue({ mode: 'AND', permissions: ['p1'] });
      redisClient.get.mockResolvedValue('1');
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(usersService.hasPermission).not.toHaveBeenCalled();
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('HIT "0" → no DB call, deny path', async () => {
      const { guard, reflector, usersService, redisClient } = createGuard();
      reflector.getAllAndOverride.mockReturnValue({ mode: 'AND', permissions: ['p1'] });
      redisClient.get.mockResolvedValue('0');
      redisClient.set.mockResolvedValue('OK'); // dedupe NX
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(usersService.hasPermission).not.toHaveBeenCalled();
    });

    it('Redis DOWN su GET → fallback DB, no fail', async () => {
      const { guard, reflector, usersService, redisClient } = createGuard();
      reflector.getAllAndOverride.mockReturnValue({ mode: 'AND', permissions: ['p1'] });
      redisClient.get.mockRejectedValue(new Error('ECONNREFUSED'));
      redisClient.set.mockResolvedValue('OK');
      usersService.hasPermission.mockResolvedValue(true);
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      // DB fallback chiamato
      expect(usersService.hasPermission).toHaveBeenCalledWith('u1', 'p1');
    });

    it('cache write fail (SET error) silent, non blocca request', async () => {
      const { guard, reflector, usersService, redisClient } = createGuard();
      reflector.getAllAndOverride.mockReturnValue({ mode: 'AND', permissions: ['p1'] });
      redisClient.get.mockResolvedValue(null);
      redisClient.set.mockRejectedValue(new Error('write fail'));
      usersService.hasPermission.mockResolvedValue(true);
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      // Request allow nonostante SET fail
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('audit dedupe Redis', () => {
    it('dedupe NX "OK" → audit insert', async () => {
      const { guard, reflector, redisClient, auditCreate } = createGuard();
      reflector.getAllAndOverride.mockReturnValue({ mode: 'AND', permissions: ['p1'] });
      redisClient.get.mockResolvedValue('0'); // cache HIT '0' → deny
      redisClient.set.mockResolvedValue('OK'); // dedupe NX OK
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(auditCreate).toHaveBeenCalledTimes(1);
      expect(auditCreate.mock.calls[0]?.[0]?.data).toMatchObject({
        action: 'auth.permission_denied',
        userId: 'u1',
        tenantId: 't1',
      });
    });

    it('dedupe key esiste (NX null) → skip audit insert', async () => {
      const { guard, reflector, redisClient, auditCreate } = createGuard();
      reflector.getAllAndOverride.mockReturnValue({ mode: 'AND', permissions: ['p1'] });
      redisClient.get.mockResolvedValue('0'); // cache HIT '0' → deny
      redisClient.set.mockResolvedValue(null); // dedupe NX: key esisteva
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it('Redis DOWN su dedupe → fail-open: audit insert SEMPRE', async () => {
      const { guard, reflector, redisClient, auditCreate } = createGuard();
      reflector.getAllAndOverride.mockReturnValue({ mode: 'AND', permissions: ['p1'] });
      redisClient.get.mockResolvedValue('0');
      redisClient.set.mockRejectedValue(new Error('Redis DOWN'));
      const ctx = createMockContext({ user: { id: 'u1', tenantId: 't1' } });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      // fail-open: audit insert sempre
      expect(auditCreate).toHaveBeenCalledTimes(1);
    });
  });
});
