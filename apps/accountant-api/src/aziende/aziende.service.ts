// =============================================================================
// aziende.service.ts — CRUD anagrafica clienti (verticale accountant, STOP-c1)
// =============================================================================
// Pattern replicato da menus.service.ts (restaurant-api), MVP senza audit:
// - read/write single-op via this.db.prisma (RLS context attivo via
//   TenantContextInterceptor → AsyncLocalStorage, ADR-0009).
// - soft-delete via update({ deletedAt }) esplicito (ADR-0021 — MAI .delete()).
// - conflict: pre-check findFirst (softDeleteExtension filtra deleted_at IS NULL
//   → codice di un'azienda soft-deleted riusabile) + catchUniqueViolation come
//   backstop sulla race verso il partial-unique-index (ADR-0024).
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Azienda, id } from '@gestionale/db';

import { DbService } from '@gestionale/db/nest';
import { catchUniqueViolation } from '@gestionale/platform';
import type { CreateAziendaDto } from './dto/create-azienda.dto';
import type { UpdateAziendaDto } from './dto/update-azienda.dto';

@Injectable()
export class AziendeService {
  private readonly logger = new Logger(AziendeService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async list(tenantId: string): Promise<Azienda[]> {
    return this.db.prisma.azienda.findMany({
      where: { tenantId },
      orderBy: [{ nome: 'asc' }],
    });
  }

  async getById(tenantId: string, aziendaId: string): Promise<Azienda> {
    const azienda = await this.db.prisma.azienda.findFirst({ where: { id: aziendaId, tenantId } });
    if (!azienda) {
      throw new NotFoundException({
        errorCode: 'E_AZIENDA_NOT_FOUND',
        message: 'Azienda not found',
      });
    }
    return azienda;
  }

  async create(tenantId: string, dto: CreateAziendaDto): Promise<Azienda> {
    const existing = await this.db.prisma.azienda.findFirst({
      where: { tenantId, codice: dto.codice },
    });
    if (existing) {
      throw new ConflictException({
        errorCode: 'E_AZIENDA_CODICE_EXISTS',
        message: `Azienda with codice '${dto.codice}' already exists`,
      });
    }

    const azienda = await catchUniqueViolation(
      () =>
        this.db.prisma.azienda.create({
          data: { id: id(), tenantId, ...dto },
        }),
      'E_AZIENDA_CODICE_EXISTS',
    );

    this.logger.log(`Azienda created: ${azienda.id} (${azienda.codice}) tenant=${tenantId}`);
    return azienda;
  }

  async update(tenantId: string, aziendaId: string, dto: UpdateAziendaDto): Promise<Azienda> {
    const before = await this.db.prisma.azienda.findFirst({ where: { id: aziendaId, tenantId } });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_AZIENDA_NOT_FOUND',
        message: 'Azienda not found',
      });
    }

    if (dto.codice && dto.codice !== before.codice) {
      const conflict = await this.db.prisma.azienda.findFirst({
        where: { tenantId, codice: dto.codice, NOT: { id: aziendaId } },
      });
      if (conflict) {
        throw new ConflictException({
          errorCode: 'E_AZIENDA_CODICE_EXISTS',
          message: `Azienda with codice '${dto.codice}' already exists`,
        });
      }
    }

    const updated = await catchUniqueViolation(
      () => this.db.prisma.azienda.update({ where: { id: aziendaId }, data: { ...dto } }),
      'E_AZIENDA_CODICE_EXISTS',
    );

    this.logger.log(`Azienda updated: ${updated.id} tenant=${tenantId}`);
    return updated;
  }

  async softDelete(tenantId: string, aziendaId: string): Promise<{ id: string; deleted: true }> {
    const before = await this.db.prisma.azienda.findFirst({ where: { id: aziendaId, tenantId } });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_AZIENDA_NOT_FOUND',
        message: 'Azienda not found',
      });
    }

    // Soft-delete esplicito (ADR-0021): MAI .delete() — l'estensione lo
    // riscriverebbe fuori dal context RLS. update deletedAt libera il codice
    // per il partial-unique soft-delete-aware.
    await this.db.prisma.azienda.update({
      where: { id: aziendaId },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Azienda soft-deleted: ${aziendaId} tenant=${tenantId}`);
    return { id: aziendaId, deleted: true };
  }
}
