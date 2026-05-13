// =============================================================================
// users.service.ts — Operazioni su `users` consumate da AuthService e /me
// =============================================================================
// Non espone direttamente Prisma: incapsula lookup + counters falliti +
// hydrated profile (user + roles + permissions) per endpoint /me.
// =============================================================================

import { Injectable } from '@nestjs/common';

import { DbService } from '../db/db.service';

export interface FullProfile {
  user: {
    id: string;
    tenantId: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    emailVerifiedAt: Date | null;
  };
  roles: { id: string; name: string; sedeId: string | null }[];
  permissions: string[];
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}

  /** Lookup user per (tenantId, email). Niente leak su esistenza-email. */
  async findByTenantEmail(tenantId: string, email: string) {
    return this.db.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
  }

  async findById(userId: string) {
    return this.db.prisma.user.findUnique({ where: { id: userId } });
  }

  /**
   * Restituisce tutti gli user del tenant con `pin_hash != null` (utenti che
   * hanno PIN POS configurato). Usato da `AuthService` per:
   * - PIN setup: uniqueness check via argon2.verify loop (decisione 5 D2b)
   * - PIN login: scan dei candidati per match argon2 (decisione 6 D2b)
   *
   * F1 OK con N piccolo (poche user per tenant). Tech debt F2+: HMAC
   * lookup index se tenant > 50 user (vedi ADR-0008 D2b).
   *
   * @param tenantId   Tenant scope (multi-tenancy isolation)
   * @param excludeId  User da escludere dal set (es. user che sta cambiando il proprio PIN)
   */
  async findAllWithPinByTenant(tenantId: string, excludeId?: string) {
    return this.db.prisma.user.findMany({
      where: {
        tenantId,
        pinHash: { not: null },
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, pinHash: true, tenantId: true },
    });
  }

  async setPinHash(userId: string, pinHash: string): Promise<void> {
    await this.db.prisma.user.update({
      where: { id: userId },
      data: { pinHash },
    });
  }

  async incrementFailedAttempts(userId: string): Promise<void> {
    await this.db.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
    });
  }

  async recordSuccessfulLogin(userId: string): Promise<void> {
    await this.db.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lastLoginAt: new Date() },
    });
  }

  /**
   * Check se l'utente possiede un dato permission code via QUALSIASI dei suoi
   * role assignments (`user.roles → role.permissions → permission.code`).
   *
   * Usato per permission check on-demand (D4: bootstrap tenant, futuri Guard
   * generici @RequirePermissions). Lazy per design (ADR-0008 decisione 7: JWT
   * payload minimal, lookup runtime SOLO per endpoint che servono il check).
   *
   * Query Prisma con `some` su tutti i nested → PostgreSQL genera EXISTS
   * sub-select, stop al primo match (cheap, ~5ms localhost). `select: {id}`
   * minimizza la projection. Niente caching in F1 (premature optimization,
   * tech debt F2 se profiling lo giustifica).
   */
  async hasPermission(userId: string, permissionCode: string): Promise<boolean> {
    const result = await this.db.prisma.user.findFirst({
      where: {
        id: userId,
        roles: {
          some: {
            role: {
              permissions: {
                some: {
                  permission: {
                    code: permissionCode,
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    return result !== null;
  }

  /**
   * Carica profilo completo per /me. Esegue query joinate per rispettare
   * isolamento tenant + escludere soft-deleted. Permissions sono il flat
   * set di tutti i codes dei role assegnati (tenant-wide o per-sede).
   */
  async findFullProfile(userId: string): Promise<FullProfile | null> {
    const user = await this.db.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          // UserRole entries (user_roles): user -> role assignments
          include: {
            role: {
              include: {
                permissions: {
                  // role_permissions: role -> permission join
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) return null;

    const rolesFlat = user.roles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      sedeId: ur.sedeId,
    }));

    const permissionsSet = new Set<string>();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        permissionsSet.add(rp.permission.code);
      }
    }

    return {
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        emailVerifiedAt: user.emailVerifiedAt,
      },
      roles: rolesFlat,
      permissions: [...permissionsSet].sort(),
    };
  }
}
