// =============================================================================
// menus.service.ts — CRUD Menu (sessione 17 F1 ADR-0019)
// =============================================================================
// Pattern replicato da tenants.service.ts:
// - read single-op -> chiamata diretta this.db.prisma (ALS context attivo)
// - create/update/delete -> withTenantContextAtomicTx (multi-statement con audit)
// - audit inline dentro tx (action namespaced "menu.created|updated|deleted")
// - soft-delete via prisma.delete() (intercept extension softDeleteExtension)
// - conflict throw ConflictException con { errorCode, message }
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { id, type Menu, withTenantContextAtomicTx } from '@gestionale/db';

import { DbService } from '../db/db.service';
import type { CreateMenuDto } from './dto/create-menu.dto';
import type { UpdateMenuDto } from './dto/update-menu.dto';

@Injectable()
export class MenusService {
  private readonly logger = new Logger(MenusService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async list(tenantId: string): Promise<Menu[]> {
    return this.db.prisma.menu.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getById(tenantId: string, menuId: string): Promise<Menu> {
    const menu = await this.db.prisma.menu.findFirst({ where: { id: menuId, tenantId } });
    if (!menu) {
      throw new NotFoundException({ errorCode: 'E_MENU_NOT_FOUND', message: 'Menu not found' });
    }
    return menu;
  }

  async create(tenantId: string, userId: string, dto: CreateMenuDto): Promise<Menu> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const existing = await tx.menu.findFirst({
        where: { tenantId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException({
          errorCode: 'E_MENU_NAME_EXISTS',
          message: `Menu with name '${dto.name}' already exists`,
        });
      }

      const menu = await tx.menu.create({
        data: {
          id: id(),
          tenantId,
          name: dto.name,
          description: dto.description,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'menu.created',
          entityType: 'Menu',
          entityId: menu.id,
          afterValue: { name: menu.name, description: menu.description, isActive: menu.isActive },
        },
      });

      this.logger.log(`Menu created: ${menu.id} (${menu.name}) tenant=${tenantId}`);
      return menu;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    menuId: string,
    dto: UpdateMenuDto,
  ): Promise<Menu> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.menu.findFirst({ where: { id: menuId, tenantId } });
      if (!before) {
        throw new NotFoundException({ errorCode: 'E_MENU_NOT_FOUND', message: 'Menu not found' });
      }

      if (dto.name && dto.name !== before.name) {
        const conflict = await tx.menu.findFirst({
          where: { tenantId, name: dto.name, NOT: { id: menuId } },
        });
        if (conflict) {
          throw new ConflictException({
            errorCode: 'E_MENU_NAME_EXISTS',
            message: `Menu with name '${dto.name}' already exists`,
          });
        }
      }

      const updated = await tx.menu.update({
        where: { id: menuId },
        data: {
          name: dto.name,
          description: dto.description,
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'menu.updated',
          entityType: 'Menu',
          entityId: updated.id,
          beforeValue: {
            name: before.name,
            description: before.description,
            isActive: before.isActive,
            sortOrder: before.sortOrder,
          },
          afterValue: {
            name: updated.name,
            description: updated.description,
            isActive: updated.isActive,
            sortOrder: updated.sortOrder,
          },
        },
      });

      this.logger.log(`Menu updated: ${updated.id} tenant=${tenantId}`);
      return updated;
    });
  }

  async softDelete(
    tenantId: string,
    userId: string,
    menuId: string,
  ): Promise<{ id: string; deleted: true }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.menu.findFirst({ where: { id: menuId, tenantId } });
      if (!before) {
        throw new NotFoundException({ errorCode: 'E_MENU_NOT_FOUND', message: 'Menu not found' });
      }

      // Soft-delete esplicito via update `deletedAt` sul tx (ADR-0021 §convention):
      // NON usare tx.menu.delete() — l'interceptor softDeleteExtension lo riscrive
      // su un client non-transazionale, esce dal context RLS della tx → P2025.
      await tx.menu.update({ where: { id: menuId }, data: { deletedAt: new Date() } });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'menu.deleted',
          entityType: 'Menu',
          entityId: menuId,
          beforeValue: {
            name: before.name,
            description: before.description,
            isActive: before.isActive,
          },
        },
      });

      this.logger.log(`Menu soft-deleted: ${menuId} tenant=${tenantId}`);
      return { id: menuId, deleted: true };
    });
  }
}
