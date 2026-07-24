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
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type NotaSpesa,
  type Prisma,
  MetodoPagamentoNotaSpesa,
  StatoNotaSpesa,
  TipoAllegatoNotaSpesa,
  id,
  withTenantContextAtomicTx,
} from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { UsersService } from '@gestionale/auth';
import { StorageService } from '@gestionale/platform';

import type { CreateNotaSpesaDto } from './dto/create-nota-spesa.dto';
import type { UpdateNotaSpesaDto } from './dto/update-nota-spesa.dto';

export interface NoteSpeseListFilter {
  mese?: string; // YYYY-MM
  stato?: StatoNotaSpesa;
  userId?: string; // onorato solo con leggi_tutte
  aziendaId?: string;
}

// Read paths con allegati (badge/presenza FE). `storageKey` MAI esposto (chiave
// opaca dello StorageService): il download passa solo dall'id via endpoint dedicato.
// Ordinamento deterministico (tipo, poi createdAt) così la UI non rimescola tra fetch.
//
// Autore (`user`) e decisore (`decisaDa`) con **select esplicito** dei soli tre
// campi identificativi: il pannello approvazione deve sapere di chi è la spesa e
// chi l'ha decisa. Stessa disciplina di `storageKey`: mai `include` nudo — su
// `User` vivono email, hash password/PIN, TOTP e badge NFC, che non devono
// finire in un payload di dominio.
const AUTORE_SELECT = { id: true, firstName: true, lastName: true } as const;

export type NotaSpesaListItem = Prisma.NotaSpesaGetPayload<{
  include: {
    allegati: { select: { id: true; tipo: true } };
    user: { select: { id: true; firstName: true; lastName: true } };
    decisaDa: { select: { id: true; firstName: true; lastName: true } };
  };
}>;
export type NotaSpesaDetail = Prisma.NotaSpesaGetPayload<{
  include: {
    allegati: {
      select: {
        id: true;
        tipo: true;
        nomeOriginale: true;
        mimeType: true;
        dimensione: true;
        createdAt: true;
      };
    };
    user: { select: { id: true; firstName: true; lastName: true } };
    decisaDa: { select: { id: true; firstName: true; lastName: true } };
  };
}>;

// Stati in cui la nota è modificabile (campi + allegati). §4.4.
const EDITABLE_STATI: readonly StatoNotaSpesa[] = [StatoNotaSpesa.bozza, StatoNotaSpesa.respinta];

// Stati da cui `invia` è ammesso (§1: bozza + respinta[DP-1]).
const INVIABILE_STATI: readonly StatoNotaSpesa[] = [StatoNotaSpesa.bozza, StatoNotaSpesa.respinta];

// Metodi "carta" che richiedono lo scontrino POS (§4.2).
const CARTA_METODI: readonly MetodoPagamentoNotaSpesa[] = [
  MetodoPagamentoNotaSpesa.carta_aziendale,
  MetodoPagamentoNotaSpesa.carta_personale,
];

@Injectable()
export class NoteSpeseService {
  private readonly logger = new Logger(NoteSpeseService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(StorageService) private readonly storage: StorageService,
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
  ): Promise<NotaSpesaListItem[]> {
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
    return this.db.prisma.notaSpesa.findMany({
      where,
      orderBy: { data: 'desc' },
      include: {
        // Solo {id, tipo}: badge + indicatore presenza in riga, payload leggero (no storageKey).
        allegati: { select: { id: true, tipo: true }, orderBy: { tipo: 'asc' } },
        user: { select: AUTORE_SELECT },
        decisaDa: { select: AUTORE_SELECT },
      },
    });
  }

  async getById(tenantId: string, userId: string, notaId: string): Promise<NotaSpesaDetail> {
    const canReadAll = await this.users.hasPermission(userId, 'notespese.leggi_tutte');
    // load-then-authorize: RLS (tenant) + ownership app-layer. Cross-tenant/cross-user
    // (senza leggi_tutte) → indistinguibile da inesistente (404, no leak).
    const nota = await this.db.prisma.notaSpesa.findFirst({
      where: { id: notaId, tenantId, ...(canReadAll ? {} : { userId }) },
      // Allegati per la vista/form; MAI storageKey (download solo via id endpoint).
      include: {
        allegati: {
          select: {
            id: true,
            tipo: true,
            nomeOriginale: true,
            mimeType: true,
            dimensione: true,
            createdAt: true,
          },
          orderBy: [{ tipo: 'asc' }, { createdAt: 'asc' }],
        },
        user: { select: AUTORE_SELECT },
        decisaDa: { select: AUTORE_SELECT },
      },
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
    const nota = await this.assertOwnEditable(tenantId, userId, notaId);

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
    // Hard-delete (D5) + cleanup storage atomico: il cascade DB rimuove le righe
    // allegato ma NON i file su storage. Raccogli le storageKey, poi cancella nota
    // (cascade) + file nella stessa tx applicativa (storage.delete che throwa →
    // rollback della delete DB).
    const allegati = await this.db.prisma.notaSpesaAllegato.findMany({
      where: { notaSpesaId: notaId },
      select: { storageKey: true },
    });
    await withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await tx.notaSpesa.delete({ where: { id: notaId } });
      for (const a of allegati) await this.storage.delete(a.storageKey);
    });
    this.logger.log(
      `NotaSpesa deleted (bozza): ${notaId} +${allegati.length} allegati user=${userId} tenant=${tenantId}`,
    );
    return { id: notaId, deleted: true };
  }

  // ── State machine (PR-3) ─────────────────────────────────────────────────────
  // Concorrenza (DP-3): la transizione è applicata con `updateMany` che porta lo
  // stato atteso nel WHERE + check `count` — la race è chiusa dalla condizione di
  // update, NON dalla lettura (no read-then-write come guardia). La lettura serve
  // solo per 404/ownership/auto-decisione + gating, e il fast-fail sulla
  // precondizione dà l'errore corretto (transizione vs gating). Tutto nella STESSA
  // `withTenantContextAtomicTx`: i gating §4.1/§4.2 leggono gli allegati nella
  // stessa tx della transizione (spec §3).

  /**
   * `{bozza, respinta} → inviata` (autore). Gating §4.1 (giustificativo se
   * totale>0) e §4.2 (scontrino POS se pagamento carta). DP-2: azzera i campi
   * decisionali (una nota re-inviata non deve esibire il rifiuto superato).
   */
  async invia(tenantId: string, userId: string, notaId: string): Promise<NotaSpesa> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const nota = await tx.notaSpesa.findFirst({ where: { id: notaId, tenantId } });
      // Ownership: solo l'autore invia (non basta il permesso). Non-leak → 404.
      if (!nota || nota.userId !== userId) throw this.notFound();
      // Fast-fail precondizione (errore corretto: transizione, non gating).
      if (!INVIABILE_STATI.includes(nota.stato)) {
        throw this.invalidTransition(nota.stato, StatoNotaSpesa.inviata);
      }

      // Gating letto nella STESSA tx (spec §3).
      const allegati = await tx.notaSpesaAllegato.findMany({
        where: { notaSpesaId: notaId },
        select: { tipo: true },
      });
      if (
        Number(nota.totale) > 0 &&
        !allegati.some((a) => a.tipo === TipoAllegatoNotaSpesa.giustificativo)
      ) {
        throw new UnprocessableEntityException({
          errorCode: 'E_NOTASPESA_GIUSTIFICATIVO_MANCANTE',
          message: 'Giustificativo obbligatorio con totale > 0',
        });
      }
      if (
        CARTA_METODI.includes(nota.metodoPagamento) &&
        !allegati.some((a) => a.tipo === TipoAllegatoNotaSpesa.scontrino_pos)
      ) {
        throw new UnprocessableEntityException({
          errorCode: 'E_NOTASPESA_SCONTRINO_MANCANTE',
          message: 'Scontrino POS obbligatorio con pagamento carta',
        });
      }

      // Transizione con guardia ottimistica di stato (chiude la race).
      const res = await tx.notaSpesa.updateMany({
        where: { id: notaId, tenantId, stato: { in: [...INVIABILE_STATI] } },
        data: {
          stato: StatoNotaSpesa.inviata,
          inviataAt: new Date(),
          decisaAt: null, // DP-2
          decisaDaId: null, // DP-2
          motivoRifiuto: null, // DP-2
        },
      });
      if (res.count === 0) throw this.invalidTransition(nota.stato, StatoNotaSpesa.inviata);

      this.logger.log(`NotaSpesa inviata: ${notaId} user=${userId} tenant=${tenantId}`);
      return tx.notaSpesa.findFirstOrThrow({ where: { id: notaId, tenantId } });
    });
  }

  /** `inviata → approvata` (`notespese.approva`). Auto-approvazione vietata (§4.5/§7.4). */
  async approva(tenantId: string, userId: string, notaId: string): Promise<NotaSpesa> {
    return this.decidi(tenantId, userId, notaId, StatoNotaSpesa.approvata, null);
  }

  /**
   * `inviata → respinta` (`notespese.approva`), `motivo` obbligatorio. Auto-rifiuto
   * vietato con la stessa guardia dell'auto-approvazione (estensione oltre il testo
   * §4, coerente — vedi ADR-0076 PR-3).
   */
  async respingi(
    tenantId: string,
    userId: string,
    notaId: string,
    motivo: string,
  ): Promise<NotaSpesa> {
    const motivoClean = (motivo ?? '').trim();
    // Guard service-level oltre al DTO (la ValidationPipe non gira negli e2e).
    if (!motivoClean) {
      throw new BadRequestException({
        errorCode: 'E_NOTASPESA_MOTIVO_RICHIESTO',
        message: 'motivo obbligatorio per il rifiuto',
      });
    }
    return this.decidi(tenantId, userId, notaId, StatoNotaSpesa.respinta, motivoClean);
  }

  /** Nucleo comune approva/respingi: `inviata → {approvata|respinta}`. */
  private async decidi(
    tenantId: string,
    userId: string,
    notaId: string,
    target: StatoNotaSpesa,
    motivoRifiuto: string | null,
  ): Promise<NotaSpesa> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const nota = await tx.notaSpesa.findFirst({ where: { id: notaId, tenantId } });
      if (!nota) throw this.notFound();
      // Auto-decisione vietata: l'autore non può approvare né respingere la propria.
      if (nota.userId === userId) {
        throw new UnprocessableEntityException({
          errorCode: 'E_NOTASPESA_AUTO_DECISIONE',
          message: 'Non puoi decidere una nota di cui sei autore',
        });
      }
      if (nota.stato !== StatoNotaSpesa.inviata) {
        throw this.invalidTransition(nota.stato, target);
      }

      const res = await tx.notaSpesa.updateMany({
        where: { id: notaId, tenantId, stato: StatoNotaSpesa.inviata },
        data: { stato: target, decisaAt: new Date(), decisaDaId: userId, motivoRifiuto },
      });
      if (res.count === 0) throw this.invalidTransition(nota.stato, target);

      this.logger.log(`NotaSpesa ${target}: ${notaId} decisaDa=${userId} tenant=${tenantId}`);
      return tx.notaSpesa.findFirstOrThrow({ where: { id: notaId, tenantId } });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private invalidTransition(from: StatoNotaSpesa, to: StatoNotaSpesa): ConflictException {
    return new ConflictException({
      errorCode: 'E_NOTASPESA_INVALID_TRANSITION',
      message: `Transizione non consentita: ${from} → ${to}`,
    });
  }

  /**
   * Carica la nota se è dell'autore ed è in stato editabile (bozza/respinta);
   * altrimenti 404 (non autore/inesistente) o 409 (stato non editabile). Usato
   * anche dal servizio allegati (upload/delete richiedono nota editabile).
   */
  async assertOwnEditable(tenantId: string, userId: string, notaId: string): Promise<NotaSpesa> {
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
