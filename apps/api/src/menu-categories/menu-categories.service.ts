// =============================================================================
// menu-categories.service.ts — CRUD MenuCategory nested sotto Menu (S17 ADR-0019)
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { id, type MenuCategory, withTenantContextAtomicTx } from '@gestionale/db';

import { catchUniqueViolation } from '../common/prisma-errors';
import { DbService } from '../db/db.service';
import type { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import type { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';

@Injectable()
export class MenuCategoriesService {
  private readonly logger = new Logger(MenuCategoriesService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  private async assertMenuExists(tenantId: string, menuId: string): Promise<void> {
    const menu = await this.db.prisma.menu.findFirst({
      where: { id: menuId, tenantId },
      select: { id: true },
    });
    if (!menu) {
      throw new NotFoundException({ errorCode: 'E_MENU_NOT_FOUND', message: 'Menu not found' });
    }
  }

  async listByMenu(tenantId: string, menuId: string): Promise<MenuCategory[]> {
    await this.assertMenuExists(tenantId, menuId);
    return this.db.prisma.menuCategory.findMany({
      where: { tenantId, menuId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getById(tenantId: string, menuId: string, categoryId: string): Promise<MenuCategory> {
    const cat = await this.db.prisma.menuCategory.findFirst({
      where: { id: categoryId, tenantId, menuId },
    });
    if (!cat) {
      throw new NotFoundException({
        errorCode: 'E_MENU_CATEGORY_NOT_FOUND',
        message: 'Menu category not found',
      });
    }
    return cat;
  }

  async create(
    tenantId: string,
    userId: string,
    menuId: string,
    dto: CreateMenuCategoryDto,
  ): Promise<MenuCategory> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const menu = await tx.menu.findFirst({
        where: { id: menuId, tenantId },
        select: { id: true },
      });
      if (!menu) {
        throw new NotFoundException({ errorCode: 'E_MENU_NOT_FOUND', message: 'Menu not found' });
      }

      const existing = await tx.menuCategory.findFirst({
        where: { tenantId, menuId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException({
          errorCode: 'E_MENU_CATEGORY_NAME_EXISTS',
          message: `Category with name '${dto.name}' already exists in this menu`,
        });
      }

      const cat = await catchUniqueViolation(
        () =>
          tx.menuCategory.create({
            data: {
              id: id(),
              tenantId,
              menuId,
              name: dto.name,
              sortOrder: dto.sortOrder ?? 0,
            },
          }),
        'E_MENU_CATEGORY_NAME_EXISTS',
      );

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'menu_category.created',
          entityType: 'MenuCategory',
          entityId: cat.id,
          afterValue: { menuId, name: cat.name, sortOrder: cat.sortOrder },
        },
      });

      this.logger.log(`MenuCategory created: ${cat.id} (${cat.name}) menu=${menuId}`);
      return cat;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    menuId: string,
    categoryId: string,
    dto: UpdateMenuCategoryDto,
  ): Promise<MenuCategory> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.menuCategory.findFirst({
        where: { id: categoryId, tenantId, menuId },
      });
      if (!before) {
        throw new NotFoundException({
          errorCode: 'E_MENU_CATEGORY_NOT_FOUND',
          message: 'Menu category not found',
        });
      }

      if (dto.name && dto.name !== before.name) {
        const conflict = await tx.menuCategory.findFirst({
          where: { tenantId, menuId, name: dto.name, NOT: { id: categoryId } },
        });
        if (conflict) {
          throw new ConflictException({
            errorCode: 'E_MENU_CATEGORY_NAME_EXISTS',
            message: `Category with name '${dto.name}' already exists in this menu`,
          });
        }
      }

      const updated = await catchUniqueViolation(
        () =>
          tx.menuCategory.update({
            where: { id: categoryId },
            data: { name: dto.name, sortOrder: dto.sortOrder },
          }),
        'E_MENU_CATEGORY_NAME_EXISTS',
      );

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'menu_category.updated',
          entityType: 'MenuCategory',
          entityId: updated.id,
          beforeValue: { name: before.name, sortOrder: before.sortOrder },
          afterValue: { name: updated.name, sortOrder: updated.sortOrder },
        },
      });

      return updated;
    });
  }

  async softDelete(
    tenantId: string,
    userId: string,
    menuId: string,
    categoryId: string,
  ): Promise<{ id: string; deleted: true }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.menuCategory.findFirst({
        where: { id: categoryId, tenantId, menuId },
      });
      if (!before) {
        throw new NotFoundException({
          errorCode: 'E_MENU_CATEGORY_NOT_FOUND',
          message: 'Menu category not found',
        });
      }

      // Soft-delete esplicito (ADR-0021 §convention): update `deletedAt` sul tx —
      // tx.menuCategory.delete() escaperebbe la tx RLS via softDeleteExtension → P2025.
      await tx.menuCategory.update({
        where: { id: categoryId },
        data: { deletedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'menu_category.deleted',
          entityType: 'MenuCategory',
          entityId: categoryId,
          beforeValue: { menuId, name: before.name, sortOrder: before.sortOrder },
        },
      });

      this.logger.log(`MenuCategory soft-deleted: ${categoryId} menu=${menuId}`);
      return { id: categoryId, deleted: true };
    });
  }
}
