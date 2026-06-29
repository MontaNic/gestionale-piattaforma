// =============================================================================
// tables.service.ts — CRUD Tavolo (F2 Mappa sala, ADR-0058)
// =============================================================================
// Pattern replicato 1:1 da menus.service.ts:
// - read single-op -> chiamata diretta this.db.prisma (ALS context attivo)
// - create/update/delete -> withTenantContextAtomicTx (multi-statement con audit)
// - audit inline dentro tx (action namespaced "tavolo.created|updated|deleted")
// - soft-delete via update `deletedAt` sul tx (NON tx.delete(): l'interceptor
//   softDeleteExtension uscirebbe dal context RLS della tx -> P2025)
// - conflict throw ConflictException con { errorCode, message }
//
// `numero` unico per-tenant soft-delete-aware (partial unique index, vedi
// migration). Il PATCH include posX/posY: il drag-drop FE persiste la posizione
// via lo stesso endpoint (no endpoint position dedicato — ADR-0058 YAGNI).
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { id, type Tavolo, withTenantContextAtomicTx } from '@gestionale/db';

import { catchUniqueViolation } from '@gestionale/platform';
import { DbService } from '@gestionale/db/nest';
import type { CreateTableDto } from './dto/create-table.dto';
import type { UpdateTableDto } from './dto/update-table.dto';

@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async list(tenantId: string): Promise<Tavolo[]> {
    return this.db.prisma.tavolo.findMany({
      where: { tenantId },
      orderBy: [{ numero: 'asc' }],
    });
  }

  async getById(tenantId: string, tableId: string): Promise<Tavolo> {
    const tavolo = await this.db.prisma.tavolo.findFirst({ where: { id: tableId, tenantId } });
    if (!tavolo) {
      throw new NotFoundException({ errorCode: 'E_TABLE_NOT_FOUND', message: 'Table not found' });
    }
    return tavolo;
  }

  async create(tenantId: string, userId: string, dto: CreateTableDto): Promise<Tavolo> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const existing = await tx.tavolo.findFirst({
        where: { tenantId, numero: dto.numero },
      });
      if (existing) {
        throw new ConflictException({
          errorCode: 'E_TABLE_NUMERO_EXISTS',
          message: `Table with numero '${dto.numero}' already exists`,
        });
      }

      const tavolo = await catchUniqueViolation(
        () =>
          tx.tavolo.create({
            data: {
              id: id(),
              tenantId,
              numero: dto.numero,
              capienza: dto.capienza,
              posX: dto.posX ?? 0,
              posY: dto.posY ?? 0,
            },
          }),
        'E_TABLE_NUMERO_EXISTS',
      );

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'tavolo.created',
          entityType: 'Tavolo',
          entityId: tavolo.id,
          afterValue: { numero: tavolo.numero, capienza: tavolo.capienza },
        },
      });

      this.logger.log(`Tavolo created: ${tavolo.id} (${tavolo.numero}) tenant=${tenantId}`);
      return tavolo;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    tableId: string,
    dto: UpdateTableDto,
  ): Promise<Tavolo> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.tavolo.findFirst({ where: { id: tableId, tenantId } });
      if (!before) {
        throw new NotFoundException({ errorCode: 'E_TABLE_NOT_FOUND', message: 'Table not found' });
      }

      if (dto.numero && dto.numero !== before.numero) {
        const conflict = await tx.tavolo.findFirst({
          where: { tenantId, numero: dto.numero, NOT: { id: tableId } },
        });
        if (conflict) {
          throw new ConflictException({
            errorCode: 'E_TABLE_NUMERO_EXISTS',
            message: `Table with numero '${dto.numero}' already exists`,
          });
        }
      }

      const updated = await catchUniqueViolation(
        () =>
          tx.tavolo.update({
            where: { id: tableId },
            data: {
              numero: dto.numero,
              capienza: dto.capienza,
              posX: dto.posX,
              posY: dto.posY,
            },
          }),
        'E_TABLE_NUMERO_EXISTS',
      );

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'tavolo.updated',
          entityType: 'Tavolo',
          entityId: updated.id,
          beforeValue: {
            numero: before.numero,
            capienza: before.capienza,
            posX: before.posX,
            posY: before.posY,
          },
          afterValue: {
            numero: updated.numero,
            capienza: updated.capienza,
            posX: updated.posX,
            posY: updated.posY,
          },
        },
      });

      this.logger.log(`Tavolo updated: ${updated.id} tenant=${tenantId}`);
      return updated;
    });
  }

  async softDelete(
    tenantId: string,
    userId: string,
    tableId: string,
  ): Promise<{ id: string; deleted: true }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const before = await tx.tavolo.findFirst({ where: { id: tableId, tenantId } });
      if (!before) {
        throw new NotFoundException({ errorCode: 'E_TABLE_NOT_FOUND', message: 'Table not found' });
      }

      // Soft-delete esplicito via update `deletedAt` sul tx (ADR-0021 §convention):
      // NON usare tx.tavolo.delete() — l'interceptor softDeleteExtension lo
      // riscrive su un client non-transazionale, esce dal context RLS della tx.
      await tx.tavolo.update({ where: { id: tableId }, data: { deletedAt: new Date() } });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'tavolo.deleted',
          entityType: 'Tavolo',
          entityId: tableId,
          beforeValue: { numero: before.numero, capienza: before.capienza },
        },
      });

      this.logger.log(`Tavolo soft-deleted: ${tableId} tenant=${tenantId}`);
      return { id: tableId, deleted: true };
    });
  }
}
