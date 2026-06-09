// =============================================================================
// referenti.service.ts — CRUD referenti nested sotto azienda (STOP-c3a ADR-0033)
// =============================================================================
// Pattern LEAN ereditato da aziende.service (NON menu-categories): single-op via
// this.db.prisma (RLS context attivo via TenantContextInterceptor, ADR-0009),
// no atomic tx, no audit (MVP, coerente col genitore aziende). Niente
// catchUniqueViolation: referenti non ha unicità naturale. Soft-delete via
// update({ deletedAt }) esplicito (ADR-0021). assertAziendaExists = parent-check
// (404 parent mancante + isolamento al cliente corretto).
// =============================================================================

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Referente, id } from '@gestionale/db';

import { DbService } from '@gestionale/db/nest';
import type { CreateReferenteDto } from './dto/create-referente.dto';
import type { UpdateReferenteDto } from './dto/update-referente.dto';

@Injectable()
export class ReferentiService {
  private readonly logger = new Logger(ReferentiService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  private async assertAziendaExists(tenantId: string, aziendaId: string): Promise<void> {
    const azienda = await this.db.prisma.azienda.findFirst({
      where: { id: aziendaId, tenantId },
      select: { id: true },
    });
    if (!azienda) {
      throw new NotFoundException({
        errorCode: 'E_AZIENDA_NOT_FOUND',
        message: 'Azienda not found',
      });
    }
  }

  async list(tenantId: string, aziendaId: string): Promise<Referente[]> {
    await this.assertAziendaExists(tenantId, aziendaId);
    return this.db.prisma.referente.findMany({
      where: { tenantId, aziendaId },
      orderBy: [{ nome: 'asc' }],
    });
  }

  async getById(tenantId: string, aziendaId: string, referenteId: string): Promise<Referente> {
    const ref = await this.db.prisma.referente.findFirst({
      where: { id: referenteId, tenantId, aziendaId },
    });
    if (!ref) {
      throw new NotFoundException({
        errorCode: 'E_REFERENTE_NOT_FOUND',
        message: 'Referente not found',
      });
    }
    return ref;
  }

  async create(tenantId: string, aziendaId: string, dto: CreateReferenteDto): Promise<Referente> {
    await this.assertAziendaExists(tenantId, aziendaId);
    const ref = await this.db.prisma.referente.create({
      data: { id: id(), tenantId, aziendaId, ...dto },
    });
    this.logger.log(
      `Referente created: ${ref.id} (${ref.nome}) azienda=${aziendaId} tenant=${tenantId}`,
    );
    return ref;
  }

  async update(
    tenantId: string,
    aziendaId: string,
    referenteId: string,
    dto: UpdateReferenteDto,
  ): Promise<Referente> {
    const before = await this.db.prisma.referente.findFirst({
      where: { id: referenteId, tenantId, aziendaId },
    });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_REFERENTE_NOT_FOUND',
        message: 'Referente not found',
      });
    }

    const updated = await this.db.prisma.referente.update({
      where: { id: referenteId },
      data: { ...dto },
    });

    this.logger.log(`Referente updated: ${updated.id} azienda=${aziendaId} tenant=${tenantId}`);
    return updated;
  }

  async softDelete(
    tenantId: string,
    aziendaId: string,
    referenteId: string,
  ): Promise<{ id: string; deleted: true }> {
    const before = await this.db.prisma.referente.findFirst({
      where: { id: referenteId, tenantId, aziendaId },
    });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_REFERENTE_NOT_FOUND',
        message: 'Referente not found',
      });
    }

    // Soft-delete esplicito (ADR-0021): MAI .delete() (l'estensione lo riscrive
    // fuori dal context RLS).
    await this.db.prisma.referente.update({
      where: { id: referenteId },
      data: { deletedAt: new Date() },
    });

    this.logger.log(
      `Referente soft-deleted: ${referenteId} azienda=${aziendaId} tenant=${tenantId}`,
    );
    return { id: referenteId, deleted: true };
  }
}
