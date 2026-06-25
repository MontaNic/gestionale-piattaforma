// =============================================================================
// mandati.service.ts — Mandati / Incarichi (ADR-0051, Onda 3 Task 2)
// =============================================================================
// Il mandato nasce da un preventivo ACCETTATO (createFromPreventivo): tx atomica
// che (1) valida lo stato, (2) genera il codice RDL-<anno>-<NNNN> via counter
// per-tenant per-anno (pattern ComCounter: INSERT ON CONFLICT + SELECT FOR UPDATE
// → serializza i concorrenti), (3) crea il mandato con importo snapshot da
// preventivo.totale, (4) porta il preventivo a stato `convertito` (1:1).
//
// CRUD: RLS FORCE (tenant context da interceptor) + filtro tenantId esplicito
// (belt-and-suspenders, pattern scadenze). Soft-delete (mai .delete()).
// =============================================================================

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type Mandato,
  StatoMandato,
  StatoPreventivo,
  id,
  withTenantContextAtomicTx,
} from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { catchUniqueViolation } from '@gestionale/platform';

import type { UpdateMandatoDto } from './dto/update-mandato.dto';

type RawTx = {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
};

export interface MandatiListFilter {
  stato?: StatoMandato;
  aziendaId?: string;
}

@Injectable()
export class MandatiService {
  private readonly logger = new Logger(MandatiService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async createFromPreventivo(tenantId: string, preventivoId: string): Promise<Mandato> {
    const mandato = await catchUniqueViolation(
      () =>
        withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
          // 1. Preventivo in-scope + non cancellato
          const preventivo = await tx.preventivo.findFirst({
            where: { id: preventivoId, tenantId, deletedAt: null },
          });
          if (!preventivo) {
            throw new NotFoundException({
              errorCode: 'E_PREVENTIVO_NOT_FOUND',
              message: 'Preventivo not found',
            });
          }

          // 2. Guard stato: solo da `accettato` (un secondo tentativo trova
          //    `convertito` → fallisce qui, garantendo il 1:1 a livello dominio).
          if (preventivo.stato !== StatoPreventivo.accettato) {
            throw new BadRequestException({
              errorCode: 'E_MANDATO_PREVENTIVO_NOT_ACCEPTED',
              message: `Preventivo must be in stato 'accettato' (current: '${preventivo.stato}')`,
            });
          }

          // 3. Counter per-tenant per-anno → codice RDL-<anno>-<NNNN>
          const anno = new Date().getFullYear();
          const raw = tx as unknown as RawTx;
          await raw.$executeRawUnsafe(
            'INSERT INTO "rdl_counter" ("tenant_id", "anno", "last_number") VALUES ($1, $2, 0) ON CONFLICT ("tenant_id", "anno") DO NOTHING',
            tenantId,
            anno,
          );
          const rows = await raw.$queryRawUnsafe<Array<{ last_number: number }>>(
            'SELECT "last_number" FROM "rdl_counter" WHERE "tenant_id" = $1 AND "anno" = $2 FOR UPDATE',
            tenantId,
            anno,
          );
          const next = (rows[0]?.last_number ?? 0) + 1;
          await raw.$executeRawUnsafe(
            'UPDATE "rdl_counter" SET "last_number" = $1 WHERE "tenant_id" = $2 AND "anno" = $3',
            next,
            tenantId,
            anno,
          );
          const codice = `RDL-${anno}-${String(next).padStart(4, '0')}`;

          // 4. Crea mandato (importo + azienda snapshot dal preventivo)
          const created = await tx.mandato.create({
            data: {
              id: id(),
              tenantId,
              preventivoId: preventivo.id,
              aziendaId: preventivo.aziendaId,
              codice,
              importoConcordato: preventivo.totale,
            },
          });

          // 5. Preventivo → convertito (1:1)
          await tx.preventivo.update({
            where: { id: preventivo.id },
            data: { stato: StatoPreventivo.convertito },
          });

          return created;
        }),
      'E_MANDATO_PREVENTIVO_EXISTS',
    );

    this.logger.log(`Mandato created: ${mandato.id} (${mandato.codice}) tenant=${tenantId}`);
    return mandato;
  }

  async list(tenantId: string, filter: MandatiListFilter = {}): Promise<Mandato[]> {
    return this.db.prisma.mandato.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filter.stato ? { stato: filter.stato } : {}),
        ...(filter.aziendaId ? { aziendaId: filter.aziendaId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async findOne(tenantId: string, mandatoId: string): Promise<Mandato> {
    const mandato = await this.db.prisma.mandato.findFirst({
      where: { id: mandatoId, tenantId, deletedAt: null },
    });
    if (!mandato) {
      throw new NotFoundException({
        errorCode: 'E_MANDATO_NOT_FOUND',
        message: 'Mandato not found',
      });
    }
    return mandato;
  }

  async update(tenantId: string, mandatoId: string, dto: UpdateMandatoDto): Promise<Mandato> {
    await this.findOne(tenantId, mandatoId); // ownership + 404

    const updated = await this.db.prisma.mandato.update({
      where: { id: mandatoId },
      data: {
        stato: dto.stato,
        inizio: dto.inizio ? new Date(dto.inizio) : undefined,
        finePrevista: dto.finePrevista ? new Date(dto.finePrevista) : undefined,
        fineEffettiva: dto.fineEffettiva ? new Date(dto.fineEffettiva) : undefined,
        note: dto.note,
      },
    });
    this.logger.log(`Mandato updated: ${mandatoId} tenant=${tenantId}`);
    return updated;
  }

  async softDelete(tenantId: string, mandatoId: string): Promise<{ id: string; deleted: true }> {
    await this.findOne(tenantId, mandatoId); // ownership + 404
    // Soft-delete (ADR-0021): mai .delete(). Il partial-unique è WHERE deleted_at
    // IS NULL → dopo il soft-delete il preventivo può generare un nuovo mandato.
    await this.db.prisma.mandato.update({
      where: { id: mandatoId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Mandato soft-deleted: ${mandatoId} tenant=${tenantId}`);
    return { id: mandatoId, deleted: true };
  }
}
