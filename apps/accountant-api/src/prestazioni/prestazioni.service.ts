// =============================================================================
// prestazioni.service.ts — Timesheet / Prestazioni (ADR-0053, Onda 3 Task 3)
// =============================================================================
// Ore su un mandato. RLS FORCE (tenant context da interceptor) + filtro tenantId
// esplicito (belt-and-suspenders, pattern mandati). Soft-delete (mai .delete()).
//
// Guard al CREATE: il mandato dev'essere in-scope (404) e in stato `in_corso`
// (400 E_MANDATO_NOT_IN_CORSO) — non si registrano ore su mandati sospesi/
// conclusi/annullati. L'update NON ha questo guard (correzioni sempre possibili).
// `userId` = autore (utente autenticato), assegnato server-side. `voceId`
// opzionale: se valorizzato dev'essere una voce del preventivo del mandato.
// =============================================================================

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Prestazione, StatoMandato, id } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';

import type { CreatePrestazioneDto } from './dto/create-prestazione.dto';
import type { UpdatePrestazioneDto } from './dto/update-prestazione.dto';

@Injectable()
export class PrestazioniService {
  private readonly logger = new Logger(PrestazioniService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async create(
    tenantId: string,
    mandatoId: string,
    userId: string,
    dto: CreatePrestazioneDto,
  ): Promise<Prestazione> {
    // 1. Mandato in-scope + non cancellato
    const mandato = await this.db.prisma.mandato.findFirst({
      where: { id: mandatoId, tenantId, deletedAt: null },
      select: { id: true, stato: true, preventivoId: true },
    });
    if (!mandato) {
      throw new NotFoundException({
        errorCode: 'E_MANDATO_NOT_FOUND',
        message: 'Mandato not found',
      });
    }

    // 2. Guard stato: solo mandati in corso
    if (mandato.stato !== StatoMandato.in_corso) {
      throw new BadRequestException({
        errorCode: 'E_MANDATO_NOT_IN_CORSO',
        message: `Mandato must be 'in_corso' to add prestazioni (current: '${mandato.stato}')`,
      });
    }

    // 3. voceId opzionale: dev'essere una voce del preventivo del mandato
    if (dto.voceId) {
      await this.assertVoceDelMandato(tenantId, mandato.preventivoId, dto.voceId);
    }

    const prestazione = await this.db.prisma.prestazione.create({
      data: {
        id: id(),
        tenantId,
        mandatoId,
        userId, // autore = utente autenticato
        voceId: dto.voceId ?? null,
        data: new Date(dto.data),
        ore: dto.ore,
        descrizione: dto.descrizione,
        fatturabile: dto.fatturabile ?? undefined,
        importo: dto.importo ?? null,
        note: dto.note ?? null,
      },
    });
    this.logger.log(
      `Prestazione created: ${prestazione.id} mandato=${mandatoId} tenant=${tenantId}`,
    );
    return prestazione;
  }

  async list(tenantId: string, mandatoId: string): Promise<Prestazione[]> {
    await this.assertMandatoInScope(tenantId, mandatoId);
    return this.db.prisma.prestazione.findMany({
      where: { tenantId, mandatoId, deletedAt: null },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(tenantId: string, mandatoId: string, prestazioneId: string): Promise<Prestazione> {
    const prestazione = await this.db.prisma.prestazione.findFirst({
      where: { id: prestazioneId, tenantId, mandatoId, deletedAt: null },
    });
    if (!prestazione) {
      throw new NotFoundException({
        errorCode: 'E_PRESTAZIONE_NOT_FOUND',
        message: 'Prestazione not found',
      });
    }
    return prestazione;
  }

  async update(
    tenantId: string,
    mandatoId: string,
    prestazioneId: string,
    dto: UpdatePrestazioneDto,
  ): Promise<Prestazione> {
    await this.findOne(tenantId, mandatoId, prestazioneId); // ownership + 404
    if (dto.voceId) {
      const mandato = await this.db.prisma.mandato.findFirst({
        where: { id: mandatoId, tenantId },
        select: { preventivoId: true },
      });
      if (mandato) await this.assertVoceDelMandato(tenantId, mandato.preventivoId, dto.voceId);
    }

    const updated = await this.db.prisma.prestazione.update({
      where: { id: prestazioneId },
      data: {
        data: dto.data ? new Date(dto.data) : undefined,
        ore: dto.ore,
        descrizione: dto.descrizione,
        fatturabile: dto.fatturabile,
        importo: dto.importo,
        voceId: dto.voceId,
        note: dto.note,
      },
    });
    this.logger.log(`Prestazione updated: ${prestazioneId} tenant=${tenantId}`);
    return updated;
  }

  async softDelete(
    tenantId: string,
    mandatoId: string,
    prestazioneId: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.findOne(tenantId, mandatoId, prestazioneId); // ownership + 404
    await this.db.prisma.prestazione.update({
      where: { id: prestazioneId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Prestazione soft-deleted: ${prestazioneId} tenant=${tenantId}`);
    return { id: prestazioneId, deleted: true };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async assertMandatoInScope(tenantId: string, mandatoId: string): Promise<void> {
    const mandato = await this.db.prisma.mandato.findFirst({
      where: { id: mandatoId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!mandato) {
      throw new NotFoundException({
        errorCode: 'E_MANDATO_NOT_FOUND',
        message: 'Mandato not found',
      });
    }
  }

  private async assertVoceDelMandato(
    tenantId: string,
    preventivoId: string,
    voceId: string,
  ): Promise<void> {
    const voce = await this.db.prisma.preventivoVoce.findFirst({
      where: { id: voceId, tenantId, preventivoId },
      select: { id: true },
    });
    if (!voce) {
      throw new BadRequestException({
        errorCode: 'E_PRESTAZIONE_VOCE_INVALID',
        message: 'Voce not found or not part of the mandato preventivo',
      });
    }
  }
}
