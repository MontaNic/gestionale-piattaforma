// =============================================================================
// price-lists.service.ts — CRUD PriceList (S17 F1 ADR-0019)
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { id, type PriceList, withTenantContextAtomicTx } from '@gestionale/db';

import { DbService } from '../db/db.service';
import type { CreatePriceListDto } from './dto/create-price-list.dto';
import type { UpdatePriceListDto } from './dto/update-price-list.dto';

@Injectable()
export class PriceListsService {
  private readonly logger = new Logger(PriceListsService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async list(tenantId: string): Promise<PriceList[]> {
    return this.db.prisma.priceList.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });
  }

  async getById(tenantId: string, priceListId: string): Promise<PriceList> {
    const pl = await this.db.prisma.priceList.findFirst({
      where: { id: priceListId, tenantId },
    });
    if (!pl) {
      throw new NotFoundException({
        errorCode: 'E_PRICE_LIST_NOT_FOUND',
        message: 'Price list not found',
      });
    }
    return pl;
  }

  async create(tenantId: string, userId: string, dto: CreatePriceListDto): Promise<PriceList> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const existing = await tx.priceList.findFirst({
        where: { tenantId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException({
          errorCode: 'E_PRICE_LIST_NAME_EXISTS',
          message: `Price list with name '${dto.name}' already exists`,
        });
      }

      const priceList = await tx.priceList.create({
        data: {
          id: id(),
          tenantId,
          name: dto.name,
          channels: dto.channels,
          validFromDate: dto.validFromDate,
          validToDate: dto.validToDate,
          priority: dto.priority ?? 0,
          isActive: dto.isActive ?? true,
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'price_list.created',
          entityType: 'PriceList',
          entityId: priceList.id,
          afterValue: {
            name: priceList.name,
            channels: priceList.channels,
            priority: priceList.priority,
            isActive: priceList.isActive,
          },
        },
      });

      this.logger.log(`PriceList created: ${priceList.id} (${priceList.name}) tenant=${tenantId}`);
      return priceList;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    priceListId: string,
    dto: UpdatePriceListDto,
  ): Promise<PriceList> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.priceList.findFirst({ where: { id: priceListId, tenantId } });
      if (!before) {
        throw new NotFoundException({
          errorCode: 'E_PRICE_LIST_NOT_FOUND',
          message: 'Price list not found',
        });
      }

      if (dto.name && dto.name !== before.name) {
        const conflict = await tx.priceList.findFirst({
          where: { tenantId, name: dto.name, NOT: { id: priceListId } },
        });
        if (conflict) {
          throw new ConflictException({
            errorCode: 'E_PRICE_LIST_NAME_EXISTS',
            message: `Price list with name '${dto.name}' already exists`,
          });
        }
      }

      const updated = await tx.priceList.update({
        where: { id: priceListId },
        data: {
          name: dto.name,
          channels: dto.channels,
          validFromDate: dto.validFromDate,
          validToDate: dto.validToDate,
          priority: dto.priority,
          isActive: dto.isActive,
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'price_list.updated',
          entityType: 'PriceList',
          entityId: updated.id,
          beforeValue: {
            name: before.name,
            channels: before.channels,
            priority: before.priority,
            isActive: before.isActive,
          },
          afterValue: {
            name: updated.name,
            channels: updated.channels,
            priority: updated.priority,
            isActive: updated.isActive,
          },
        },
      });

      return updated;
    });
  }

  async softDelete(
    tenantId: string,
    userId: string,
    priceListId: string,
  ): Promise<{ id: string; deleted: true }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.priceList.findFirst({ where: { id: priceListId, tenantId } });
      if (!before) {
        throw new NotFoundException({
          errorCode: 'E_PRICE_LIST_NOT_FOUND',
          message: 'Price list not found',
        });
      }

      await tx.priceList.delete({ where: { id: priceListId } });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'price_list.deleted',
          entityType: 'PriceList',
          entityId: priceListId,
          beforeValue: {
            name: before.name,
            channels: before.channels,
            priority: before.priority,
          },
        },
      });

      this.logger.log(`PriceList soft-deleted: ${priceListId} tenant=${tenantId}`);
      return { id: priceListId, deleted: true };
    });
  }
}
