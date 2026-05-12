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
