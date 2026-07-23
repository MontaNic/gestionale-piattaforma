// =============================================================================
// note-spese.service.ts — CRUD Note Spese (accountant, PR-2)
// =============================================================================
// Solo operatore studio. CRUD della nota (allegati in note-spese-allegati.*).
// In PR-2 tutte le note nascono e restano `bozza` (le transizioni sono PR-3),
// ma i vincoli di stato editabile sono già applicati (bozza|respinta).
//
// Scoping `leggi_tutte` NON bypassabile: senza il permesso, list/get sono forzati
// a `userId = currentUser.id` ignorando il query param (§6). Il check permesso
// riusa UsersService.hasPermission (stessa fonte del PermissionsGuard).
//
// D6 (§4.7): `mandatoId` valorizzato ⟹ `aziendaId` obbligatorio e = mandato.aziendaId
// (mandato caricato tenant-scoped). Hard-fail su create E update.
// §4.5: nessuna regola fiscale nel service. §4.6/D4: `distanzaKm` nessuna
// validazione BE (soft-warning FE).
// =============================================================================

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type NotaSpesa, type Prisma, StatoNotaSpesa, id } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { UsersService } from '@gestionale/auth';

import type { CreateNotaSpesaDto } from './dto/create-nota-spesa.dto';
import type { UpdateNotaSpesaDto } from './dto/update-nota-spesa.dto';

export interface NoteSpeseListFilter {
  mese?: string; // YYYY-MM
  stato?: StatoNotaSpesa;
  userId?: string; // onorato solo con leggi_tutte
  aziendaId?: string;
}

// Stati in cui la nota è modificabile (campi + allegati). §4.4.
const EDITABLE_STATI: readonly StatoNotaSpesa[] = [StatoNotaSpesa.bozza, StatoNotaSpesa.respinta];

@Injectable()
export class NoteSpeseService {
  private readonly logger = new Logger(NoteSpeseService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateNotaSpesaDto): Promise<NotaSpesa> {
    await this.assertMandatoAzienda(tenantId, dto.aziendaId ?? null, dto.mandatoId ?? null);

    const nota = await this.db.prisma.notaSpesa.create({
      data: {
        id: id(),
        tenantId,
        userId,
        data: new Date(dto.data),
        aziendaId: dto.aziendaId ?? null,
        mandatoId: dto.mandatoId ?? null,
        tipoSpesa: dto.tipoSpesa,
        metodoPagamento: dto.metodoPagamento,
        totale: dto.totale,
        aliquotaIva: dto.aliquotaIva,
        deducibilitaFiscale: dto.deducibilitaFiscale,
        fatturataASocieta: dto.fatturataASocieta ?? false,
        distanzaKm: dto.distanzaKm ?? null,
        scopoMissione: dto.scopoMissione,
        note: dto.note ?? null,
        // stato: bozza (default schema)
      },
    });
    this.logger.log(`NotaSpesa created: ${nota.id} user=${userId} tenant=${tenantId}`);
    return nota;
  }

  async list(
    tenantId: string,
    userId: string,
    filter: NoteSpeseListFilter = {},
  ): Promise<NotaSpesa[]> {
    const canReadAll = await this.users.hasPermission(userId, 'notespese.leggi_tutte');
    // Senza leggi_tutte: forza userId proprio (ignora il query param, NON bypassabile).
    const effectiveUserId = canReadAll ? filter.userId : userId;

    const where: Prisma.NotaSpesaWhereInput = {
      tenantId,
      ...(effectiveUserId ? { userId: effectiveUserId } : {}),
      ...(filter.stato ? { stato: filter.stato } : {}),
      ...(filter.aziendaId ? { aziendaId: filter.aziendaId } : {}),
      ...this.meseWhere(filter.mese),
    };
    return this.db.prisma.notaSpesa.findMany({ where, orderBy: { data: 'desc' } });
  }

  async getById(tenantId: string, userId: string, notaId: string): Promise<NotaSpesa> {
    const canReadAll = await this.users.hasPermission(userId, 'notespese.leggi_tutte');
    // load-then-authorize: RLS (tenant) + ownership app-layer. Cross-tenant/cross-user
    // (senza leggi_tutte) → indistinguibile da inesistente (404, no leak).
    const nota = await this.db.prisma.notaSpesa.findFirst({
      where: { id: notaId, tenantId, ...(canReadAll ? {} : { userId }) },
    });
    if (!nota) throw this.notFound();
    return nota;
  }

  async update(
    tenantId: string,
    userId: string,
    notaId: string,
    dto: UpdateNotaSpesaDto,
  ): Promise<NotaSpesa> {
    const nota = await this.loadOwnEditable(tenantId, userId, notaId);

    // D6 su update: valori effettivi post-patch (undefined = invariato).
    const aziendaId = dto.aziendaId !== undefined ? dto.aziendaId : nota.aziendaId;
    const mandatoId = dto.mandatoId !== undefined ? dto.mandatoId : nota.mandatoId;
    await this.assertMandatoAzienda(tenantId, aziendaId, mandatoId);

    const data: Prisma.NotaSpesaUncheckedUpdateInput = {};
    if (dto.data !== undefined) data.data = new Date(dto.data);
    if (dto.aziendaId !== undefined) data.aziendaId = dto.aziendaId;
    if (dto.mandatoId !== undefined) data.mandatoId = dto.mandatoId;
    if (dto.tipoSpesa !== undefined) data.tipoSpesa = dto.tipoSpesa;
    if (dto.metodoPagamento !== undefined) data.metodoPagamento = dto.metodoPagamento;
    if (dto.totale !== undefined) data.totale = dto.totale;
    if (dto.aliquotaIva !== undefined) data.aliquotaIva = dto.aliquotaIva;
    if (dto.deducibilitaFiscale !== undefined) data.deducibilitaFiscale = dto.deducibilitaFiscale;
    if (dto.fatturataASocieta !== undefined) data.fatturataASocieta = dto.fatturataASocieta;
    if (dto.distanzaKm !== undefined) data.distanzaKm = dto.distanzaKm;
    if (dto.scopoMissione !== undefined) data.scopoMissione = dto.scopoMissione;
    if (dto.note !== undefined) data.note = dto.note;

    const updated = await this.db.prisma.notaSpesa.update({ where: { id: notaId }, data });
    this.logger.log(`NotaSpesa updated: ${notaId} user=${userId} tenant=${tenantId}`);
    return updated;
  }

  async remove(
    tenantId: string,
    userId: string,
    notaId: string,
  ): Promise<{ id: string; deleted: true }> {
    const nota = await this.db.prisma.notaSpesa.findFirst({ where: { id: notaId, tenantId } });
    // Ownership (solo autore) + non-leak: cross-user/tenant → 404.
    if (!nota || nota.userId !== userId) throw this.notFound();
    // DELETE consentito SOLO in bozza (§4 / D5). Le altre non sono eliminabili.
    if (nota.stato !== StatoNotaSpesa.bozza) {
      throw new ConflictException({
        errorCode: 'E_NOTASPESA_NOT_DELETABLE',
        message: `NotaSpesa in stato '${nota.stato}' non eliminabile (solo bozza)`,
      });
    }
    // Hard-delete (D5): allegati via cascade DB. Il cleanup dello storage degli
    // allegati è gestito in note-spese-allegati (PR-2 Commit 3, quando lo storage
    // è disponibile) — in questo commit non esistono ancora allegati.
    await this.db.prisma.notaSpesa.delete({ where: { id: notaId } });
    this.logger.log(`NotaSpesa deleted (bozza): ${notaId} user=${userId} tenant=${tenantId}`);
    return { id: notaId, deleted: true };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Carica la nota se è dell'autore ed è in stato editabile; altrimenti 404/409. */
  private async loadOwnEditable(
    tenantId: string,
    userId: string,
    notaId: string,
  ): Promise<NotaSpesa> {
    const nota = await this.db.prisma.notaSpesa.findFirst({ where: { id: notaId, tenantId } });
    if (!nota || nota.userId !== userId) throw this.notFound();
    if (!EDITABLE_STATI.includes(nota.stato)) {
      throw new ConflictException({
        errorCode: 'E_NOTASPESA_NOT_EDITABLE',
        message: `NotaSpesa in stato '${nota.stato}' non modificabile (solo bozza/respinta)`,
      });
    }
    return nota;
  }

  /** D6 (§4.7): coerenza mandato/azienda. Hard-fail. */
  private async assertMandatoAzienda(
    tenantId: string,
    aziendaId: string | null,
    mandatoId: string | null,
  ): Promise<void> {
    if (aziendaId) await this.assertAzienda(tenantId, aziendaId);
    if (!mandatoId) return; // aziendaId libero (valorizzato o NULL = commessa interna)

    if (!aziendaId) {
      throw new BadRequestException({
        errorCode: 'E_NOTASPESA_MANDATO_AZIENDA_MISMATCH',
        message: 'mandatoId richiede aziendaId valorizzato',
      });
    }
    const mandato = await this.db.prisma.mandato.findFirst({
      where: { id: mandatoId, tenantId },
      select: { aziendaId: true },
    });
    if (!mandato) {
      throw new BadRequestException({
        errorCode: 'E_NOTASPESA_MANDATO_NOT_FOUND',
        message: 'Mandato not found for tenant',
      });
    }
    if (mandato.aziendaId !== aziendaId) {
      throw new BadRequestException({
        errorCode: 'E_NOTASPESA_MANDATO_AZIENDA_MISMATCH',
        message: 'aziendaId non coincide con mandato.aziendaId',
      });
    }
  }

  private async assertAzienda(tenantId: string, aziendaId: string): Promise<void> {
    const azienda = await this.db.prisma.azienda.findFirst({
      where: { id: aziendaId, tenantId },
      select: { id: true },
    });
    if (!azienda) {
      throw new BadRequestException({
        errorCode: 'E_NOTASPESA_AZIENDA_NOT_FOUND',
        message: 'Azienda not found for tenant',
      });
    }
  }

  /** Filtro mese `YYYY-MM` → intervallo [primo giorno, primo del mese dopo). */
  private meseWhere(mese: string | undefined): Prisma.NotaSpesaWhereInput {
    if (!mese || !/^\d{4}-\d{2}$/.test(mese)) return {};
    const y = Number(mese.slice(0, 4));
    const m = Number(mese.slice(5, 7));
    const gte = new Date(Date.UTC(y, m - 1, 1));
    const lt = new Date(Date.UTC(y, m, 1));
    return { data: { gte, lt } };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      errorCode: 'E_NOTASPESA_NOT_FOUND',
      message: 'NotaSpesa not found',
    });
  }
}
