// =============================================================================
// users.service.spec.ts — Test essential UsersService.hasPermission (D4)
// =============================================================================
// Pattern mock-based (vedi auth.service.spec.ts D2-vitest): bypass DI NestJS,
// instanziazione manuale con mock DbService. Le query Prisma sono mockate via
// vi.fn() — il test verifica la LOGICA del service, non l'effettiva query SQL
// (che dipenderebbe da DB reale + RLS context).
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersService } from './users.service';

// Mock @gestionale/db: UsersService usa il singleton `prisma` importato dal
// package (non piu' via DbService). Sostituiamo `prisma` con un mock hoisted di
// cui controlliamo findFirst; gli helper ALS non sono chiamati da hasPermission
// ma restano esportati per coerenza del module mock.
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@gestionale/db', () => ({
  id: vi.fn(() => '00000000-0000-7000-8000-000000000001'),
  prisma: mockPrisma,
  uuidv7: vi.fn(),
  createPrismaClient: vi.fn(),
  runInTenantContext: vi.fn(<T>(_ctx: unknown, fn: () => Promise<T> | T) => Promise.resolve(fn())),
  withSystemContext: vi.fn(<T>(fn: () => Promise<T> | T) => Promise.resolve(fn())),
  withSuperAdminContext: vi.fn(<T>(_tenantId: string, fn: () => Promise<T> | T) =>
    Promise.resolve(fn()),
  ),
}));

const USER_WITH_PERM = '00000000-0000-7000-8000-aaaaaaaaaaaa';
const USER_WITHOUT_PERM = '00000000-0000-7000-8000-bbbbbbbbbbbb';

describe('UsersService.hasPermission', () => {
  let users: UsersService;
  const prisma = mockPrisma;

  beforeEach(() => {
    prisma.user.findFirst.mockReset();
    users = new UsersService();
  });

  it('returns true when findFirst resolves to a user row (permission present via roles->permissions chain)', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: USER_WITH_PERM });

    const result = await users.hasPermission(USER_WITH_PERM, 'sistema.tenant.gestisci');

    expect(result).toBe(true);
    // Sanity check del shape della query: where include nested some/role/permissions/permission/code
    const callArgs = prisma.user.findFirst.mock.calls[0]![0];
    expect(callArgs.where.id).toBe(USER_WITH_PERM);
    expect(callArgs.where.roles.some.role.permissions.some.permission.code).toBe(
      'sistema.tenant.gestisci',
    );
    expect(callArgs.select).toEqual({ id: true });
  });

  it('returns false when findFirst resolves to null (no role assignment grants the permission)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const result = await users.hasPermission(USER_WITHOUT_PERM, 'sistema.tenant.gestisci');

    expect(result).toBe(false);
  });
});
