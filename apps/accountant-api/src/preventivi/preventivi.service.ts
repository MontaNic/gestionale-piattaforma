// =============================================================================
// preventivi.service.ts — Preventivi (testata + voci) nested sotto azienda (STOP-e1)
// =============================================================================
// FULL: business logic (ricalcolo totali) in transazione atomica. Le voci si
// salvano insieme alla testata (DP-e1-1): create/update fanno replace integrale
// delle voci + ricalcolo totali dentro withTenantContextAtomicTx (invariante
// totali ≡ Σ voci). Codice partial-unique soft-delete-aware (Pattern 42, come
// aziende). Soft-delete testata via update({deletedAt}); le voci muoiono con la
// FK cascade solo all'hard-delete — sul soft-delete restano ma sono irraggiungibili
// (il preventivo è filtrato deleted_at IS NULL). Parent-check assertAziendaExists.
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Preventivo, id, withTenantContextAtomicTx } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { catchUniqueViolation } from '@gestionale/platform';
import type { CreatePreventivoDto } from './dto/create-preventivo.dto';
import type { PreventivoVoceDto } from './dto/preventivo-voce.dto';
import type { UpdatePreventivoDto } from './dto/update-preventivo.dto';

// Tipo di ritorno con voci incluse (lo standard di lettura per il detail).
export type PreventivoWithVoci = Prisma.PreventivoGetPayload<{ include: { voci: true } }>;

@Injectable()
export class PreventiviService {
  private readonly logger = new Logger(PreventiviService.name);

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

  // Calcola totaleRiga di una voce + i 3 totali testata. Decimal-safe via number
  // arrotondato a 2 dp (gli importi MVP sono piccoli; Prisma.Decimal in input/output).
  private computeVoce(v: PreventivoVoceDto): {
    totaleRiga: number;
    imponibile: number;
    iva: number;
  } {
    const lordo = v.quantita * v.prezzoUnitario;
    const scontato = lordo * (1 - v.scontoPct / 100);
    const totaleRiga = Math.round(scontato * 100) / 100;
    const iva = Math.round(totaleRiga * (v.ivaAliquota / 100) * 100) / 100;
    return { totaleRiga, imponibile: totaleRiga, iva };
  }

  private computeTotali(voci: PreventivoVoceDto[]): {
    perVoce: number[];
    totaleImponibile: number;
    totaleIva: number;
    totale: number;
  } {
    const perVoce: number[] = [];
    let totaleImponibile = 0;
    let totaleIva = 0;
    for (const v of voci) {
      const c = this.computeVoce(v);
      perVoce.push(c.totaleRiga);
      totaleImponibile += c.imponibile;
      totaleIva += c.iva;
    }
    totaleImponibile = Math.round(totaleImponibile * 100) / 100;
    totaleIva = Math.round(totaleIva * 100) / 100;
    const totale = Math.round((totaleImponibile + totaleIva) * 100) / 100;
    return { perVoce, totaleImponibile, totaleIva, totale };
  }

  async list(tenantId: string, aziendaId: string): Promise<Preventivo[]> {
    await this.assertAziendaExists(tenantId, aziendaId);
    return this.db.prisma.preventivo.findMany({
      where: { tenantId, aziendaId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async getById(
    tenantId: string,
    aziendaId: string,
    preventivoId: string,
  ): Promise<PreventivoWithVoci> {
    const prev = await this.db.prisma.preventivo.findFirst({
      where: { id: preventivoId, tenantId, aziendaId },
      include: { voci: { orderBy: { ordine: 'asc' } } },
    });
    if (!prev) {
      throw new NotFoundException({
        errorCode: 'E_PREVENTIVO_NOT_FOUND',
        message: 'Preventivo not found',
      });
    }
    return prev;
  }

  async create(
    tenantId: string,
    aziendaId: string,
    dto: CreatePreventivoDto,
  ): Promise<PreventivoWithVoci> {
    await this.assertAziendaExists(tenantId, aziendaId);

    const existing = await this.db.prisma.preventivo.findFirst({
      where: { tenantId, codice: dto.codice },
    });
    if (existing) {
      throw new ConflictException({
        errorCode: 'E_PREVENTIVO_CODICE_EXISTS',
        message: `Preventivo with codice '${dto.codice}' already exists`,
      });
    }

    const totali = this.computeTotali(dto.voci);
    const preventivoId = id();

    return catchUniqueViolation(
      () =>
        withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
          await tx.preventivo.create({
            data: {
              id: preventivoId,
              tenantId,
              aziendaId,
              codice: dto.codice,
              oggetto: dto.oggetto,
              coverLetter: dto.coverLetter,
              noteInterne: dto.noteInterne,
              stato: dto.stato ?? undefined,
              validoFino: dto.validoFino ? new Date(dto.validoFino) : null,
              totaleImponibile: totali.totaleImponibile,
              totaleIva: totali.totaleIva,
              totale: totali.totale,
            },
          });
          await tx.preventivoVoce.createMany({
            data: dto.voci.map((v, i) => ({
              id: id(),
              tenantId,
              preventivoId,
              nome: v.nome,
              descrizione: v.descrizione,
              unitaMisura: v.unitaMisura,
              quantita: v.quantita,
              prezzoUnitario: v.prezzoUnitario,
              scontoPct: v.scontoPct,
              ivaAliquota: v.ivaAliquota,
              totaleRiga: totali.perVoce[i],
              ordine: v.ordine ?? i,
              note: v.note,
              // Tracciabilità catalogo (ADR-0050): nullable, FK SetNull. Nessuna
              // validazione FK esplicita — Prisma gestisce il vincolo/SetNull.
              servizioId: v.servizioId ?? null,
            })),
          });
          const created = await tx.preventivo.findFirstOrThrow({
            where: { id: preventivoId },
            include: { voci: { orderBy: { ordine: 'asc' } } },
          });
          this.logger.log(`Preventivo created: ${preventivoId} (${dto.codice}) tenant=${tenantId}`);
          return created;
        }),
      'E_PREVENTIVO_CODICE_EXISTS',
    );
  }

  async update(
    tenantId: string,
    aziendaId: string,
    preventivoId: string,
    dto: UpdatePreventivoDto,
  ): Promise<PreventivoWithVoci> {
    const before = await this.db.prisma.preventivo.findFirst({
      where: { id: preventivoId, tenantId, aziendaId },
    });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_PREVENTIVO_NOT_FOUND',
        message: 'Preventivo not found',
      });
    }

    if (dto.codice && dto.codice !== before.codice) {
      const conflict = await this.db.prisma.preventivo.findFirst({
        where: { tenantId, codice: dto.codice, NOT: { id: preventivoId } },
      });
      if (conflict) {
        throw new ConflictException({
          errorCode: 'E_PREVENTIVO_CODICE_EXISTS',
          message: `Preventivo with codice '${dto.codice}' already exists`,
        });
      }
    }

    const totali = dto.voci ? this.computeTotali(dto.voci) : null;

    return catchUniqueViolation(
      () =>
        withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
          await tx.preventivo.update({
            where: { id: preventivoId },
            data: {
              codice: dto.codice,
              oggetto: dto.oggetto,
              coverLetter: dto.coverLetter,
              noteInterne: dto.noteInterne,
              stato: dto.stato,
              validoFino:
                dto.validoFino !== undefined
                  ? dto.validoFino
                    ? new Date(dto.validoFino)
                    : null
                  : undefined,
              ...(totali
                ? {
                    totaleImponibile: totali.totaleImponibile,
                    totaleIva: totali.totaleIva,
                    totale: totali.totale,
                  }
                : {}),
            },
          });

          // Replace integrale voci (solo se dto.voci presente). Pattern NUOVO.
          if (dto.voci && totali) {
            await tx.preventivoVoce.deleteMany({ where: { preventivoId } });
            await tx.preventivoVoce.createMany({
              data: dto.voci.map((v, i) => ({
                id: id(),
                tenantId,
                preventivoId,
                nome: v.nome,
                descrizione: v.descrizione,
                unitaMisura: v.unitaMisura,
                quantita: v.quantita,
                prezzoUnitario: v.prezzoUnitario,
                scontoPct: v.scontoPct,
                ivaAliquota: v.ivaAliquota,
                totaleRiga: totali.perVoce[i],
                ordine: v.ordine ?? i,
                note: v.note,
                servizioId: v.servizioId ?? null,
              })),
            });
          }

          return tx.preventivo.findFirstOrThrow({
            where: { id: preventivoId },
            include: { voci: { orderBy: { ordine: 'asc' } } },
          });
        }),
      'E_PREVENTIVO_CODICE_EXISTS',
    );
  }

  async softDelete(
    tenantId: string,
    aziendaId: string,
    preventivoId: string,
  ): Promise<{ id: string; deleted: true }> {
    const before = await this.db.prisma.preventivo.findFirst({
      where: { id: preventivoId, tenantId, aziendaId },
    });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_PREVENTIVO_NOT_FOUND',
        message: 'Preventivo not found',
      });
    }
    // Soft-delete esplicito (ADR-0021): le voci restano ma sono irraggiungibili
    // (il preventivo è filtrato deleted_at IS NULL).
    await this.db.prisma.preventivo.update({
      where: { id: preventivoId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Preventivo soft-deleted: ${preventivoId} tenant=${tenantId}`);
    return { id: preventivoId, deleted: true };
  }
}
