// =============================================================================
// comunicazioni.service.ts — thread 1:1 studio↔cliente (verticale accountant, ADR-0043)
// =============================================================================
// Pattern replicato da scadenze/preventivi (CRUD tenant-level via this.db.prisma
// con RLS context attivo; soft-delete via update({ deletedAt }) — MAI .delete()).
//
// Specifico del modulo:
// - `codice` (COM-0001…) generato per-tenant con counter-row `com_counter`:
//   SELECT ... FOR UPDATE nella STESSA tx dell'insert della comunicazione
//   (withTenantContextAtomicTx). Il lock di riga serializza le aperture
//   simultanee nello stesso tenant → due open concorrenti non collidono sul
//   codice (la 2ª aspetta il commit della 1ª e legge il last_number aggiornato).
// - tenantId denormalizzato su messaggi/allegati (DP-N2): scritto esplicitamente.
// - allegati via StorageService astratto (mai `fs` qui): swap R2 trasparente.
// =============================================================================

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ComApertura,
  ComLato,
  type Comunicazione,
  type ComAllegato,
  type ComMessaggio,
  id,
  withTenantContextAtomicTx,
} from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { catchUniqueViolation, StorageService } from '@gestionale/platform';

import { GroqService } from '../ai/groq.service';

import type { CreateComunicazioneDto } from './dto/create-comunicazione.dto';
import type { CreateComMessaggioDto } from './dto/create-com-messaggio.dto';
import type { ReplyClienteDto } from './dto/reply-cliente.dto';
import type { UpdateComunicazioneDto } from './dto/update-comunicazione.dto';

export interface ComunicazioniListFilter {
  aziendaId?: string;
  chiusa?: boolean;
  urgente?: boolean;
  operatoreAssegnatoId?: string;
  daPrendere?: boolean; // operatoreAssegnatoId IS NULL
}

// ── Viste cliente (portale, ADR-0047 §7) ──────────────────────────────────────
// Denormalizzate, distinte dalle entity Prisma: niente leak di campi interni
// (operatoreAssegnatoId/urgente/referenteId sul thread, autoreUserId/tenantId sul
// messaggio). I messaggi `lato=interno` (note operatore) non entrano mai.

export interface ClienteComAllegatoView {
  id: string;
  nomeOrig: string;
  mimeType: string;
  dimensione: number;
}

export interface ClienteComMessaggioView {
  id: string;
  lato: ComLato; // solo `studio` | `cliente` lato portale (mai `interno`)
  testo: string;
  createdAt: Date;
  allegati: ClienteComAllegatoView[];
}

export interface ClienteComunicazioneListView {
  id: string;
  codice: string;
  oggetto: string;
  chiusa: boolean;
  updatedAt: Date;
  nonLetti: number; // messaggi `lato=studio` non ancora letti dal cliente
}

export interface ClienteComunicazioneDetailView {
  id: string;
  codice: string;
  oggetto: string;
  chiusa: boolean;
  createdAt: Date;
  updatedAt: Date;
  messaggi: ClienteComMessaggioView[];
}

// tx raw: l'extended client strippa i metodi *Unsafe dal tipo (vedi rls.ts).
// Cast minimo per il counter FOR UPDATE. I param sono bind ($1/$2) → no injection.
type RawTx = {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
};

@Injectable()
export class ComunicazioniService {
  private readonly logger = new Logger(ComunicazioniService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(GroqService) private readonly groq: GroqService,
  ) {}

  // ── Thread (testata) ─────────────────────────────────────────────────────────

  async list(tenantId: string, filter: ComunicazioniListFilter = {}): Promise<Comunicazione[]> {
    return this.db.prisma.comunicazione.findMany({
      where: {
        tenantId,
        ...(filter.aziendaId ? { aziendaId: filter.aziendaId } : {}),
        ...(filter.chiusa !== undefined ? { chiusa: filter.chiusa } : {}),
        ...(filter.urgente !== undefined ? { urgente: filter.urgente } : {}),
        ...(filter.daPrendere ? { operatoreAssegnatoId: null } : {}),
        ...(filter.operatoreAssegnatoId
          ? { operatoreAssegnatoId: filter.operatoreAssegnatoId }
          : {}),
      },
      orderBy: [{ urgente: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async getById(tenantId: string, comunicazioneId: string) {
    const com = await this.db.prisma.comunicazione.findFirst({
      where: { id: comunicazioneId, tenantId },
      include: {
        messaggi: {
          orderBy: { createdAt: 'asc' },
          include: { allegati: true },
        },
      },
    });
    if (!com) {
      throw new NotFoundException({
        errorCode: 'E_COM_NOT_FOUND',
        message: 'Comunicazione not found',
      });
    }
    return com;
  }

  // Bozza AI di risposta operatore (ADR-0056). Carica il thread, esclude le note
  // interne (lato='interno', mai parte della conversazione col cliente) e delega
  // a GroqService. Nessuna persistenza: la bozza torna al FE che popola la
  // textarea del composer. 503 se la feature è disabilitata (no GROQ_API_KEY).
  async suggerisciRisposta(tenantId: string, comunicazioneId: string): Promise<{ bozza: string }> {
    const com = await this.getById(tenantId, comunicazioneId);
    const messaggi = com.messaggi
      .filter((m) => m.lato !== ComLato.interno)
      .map((m) => ({ lato: m.lato as 'studio' | 'cliente', testo: m.testo }));
    const bozza = await this.groq.suggerisciRisposta({ oggetto: com.oggetto, messaggi });
    return { bozza };
  }

  async create(
    tenantId: string,
    autoreUserId: string,
    dto: CreateComunicazioneDto,
  ): Promise<Comunicazione> {
    const apertaDa = dto.apertaDa ?? ComApertura.studio;
    await this.assertAziendaEReferente(tenantId, dto.aziendaId, dto.referenteId);
    if (dto.operatoreAssegnatoId) {
      await this.assertOperatore(tenantId, dto.operatoreAssegnatoId);
    }

    // Lato del primo messaggio = lato di apertura. autore = user interno solo se
    // l'ha aperta lo studio (lato cliente pre-portale → autoreUserId NULL).
    const lato = apertaDa === ComApertura.studio ? ComLato.studio : ComLato.cliente;
    const read = this.readFlagsFor(lato);

    const com = await catchUniqueViolation(
      () =>
        withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
          const raw = tx as unknown as RawTx;
          // Garantisce la riga counter, poi la LOCKA per-tenant (FOR UPDATE) nella
          // stessa tx: serializza le aperture concorrenti dello stesso tenant.
          await raw.$executeRawUnsafe(
            'INSERT INTO "com_counter" ("tenant_id", "last_number") VALUES ($1, 0) ON CONFLICT ("tenant_id") DO NOTHING',
            tenantId,
          );
          const rows = await raw.$queryRawUnsafe<Array<{ last_number: number }>>(
            'SELECT "last_number" FROM "com_counter" WHERE "tenant_id" = $1 FOR UPDATE',
            tenantId,
          );
          const next = (rows[0]?.last_number ?? 0) + 1;
          await raw.$executeRawUnsafe(
            'UPDATE "com_counter" SET "last_number" = $1 WHERE "tenant_id" = $2',
            next,
            tenantId,
          );
          const codice = `COM-${String(next).padStart(4, '0')}`;

          const created = await tx.comunicazione.create({
            data: {
              id: id(),
              tenantId,
              codice,
              aziendaId: dto.aziendaId,
              referenteId: dto.referenteId ?? null,
              apertaDa,
              operatoreAssegnatoId: dto.operatoreAssegnatoId ?? null,
              oggetto: dto.oggetto,
              urgente: dto.urgente ?? false,
            },
          });

          await tx.comMessaggio.create({
            data: {
              id: id(),
              tenantId,
              comunicazioneId: created.id,
              autoreUserId: lato === ComLato.studio ? autoreUserId : null,
              lato,
              testo: dto.testo,
              lettoStudio: read.lettoStudio,
              lettoCliente: read.lettoCliente,
            },
          });

          return created;
        }),
      'E_COM_CODICE_EXISTS',
    );

    this.logger.log(`Comunicazione created: ${com.id} (${com.codice}) tenant=${tenantId}`);
    return com;
  }

  async update(
    tenantId: string,
    comunicazioneId: string,
    dto: UpdateComunicazioneDto,
  ): Promise<Comunicazione> {
    const before = await this.getTestata(tenantId, comunicazioneId);
    if (dto.operatoreAssegnatoId) {
      await this.assertOperatore(tenantId, dto.operatoreAssegnatoId);
    }

    // Chiusura/riapertura: gestisce chiusaIl coerente con `chiusa`.
    const chiusaPatch =
      dto.chiusa === undefined
        ? {}
        : dto.chiusa
          ? { chiusa: true, chiusaIl: before.chiusaIl ?? new Date() }
          : { chiusa: false, chiusaIl: null };

    const updated = await this.db.prisma.comunicazione.update({
      where: { id: comunicazioneId },
      data: {
        oggetto: dto.oggetto,
        urgente: dto.urgente,
        // null = rilascio (torna "da prendere"); undefined = invariato.
        operatoreAssegnatoId:
          dto.operatoreAssegnatoId === undefined ? undefined : dto.operatoreAssegnatoId,
        ...chiusaPatch,
      },
    });

    this.logger.log(`Comunicazione updated: ${updated.id} tenant=${tenantId}`);
    return updated;
  }

  // Presa in carico (self-assign): l'operatore corrente diventa l'assegnatario.
  async prendiInCarico(
    tenantId: string,
    comunicazioneId: string,
    operatoreUserId: string,
  ): Promise<Comunicazione> {
    await this.getTestata(tenantId, comunicazioneId);
    const updated = await this.db.prisma.comunicazione.update({
      where: { id: comunicazioneId },
      data: { operatoreAssegnatoId: operatoreUserId },
    });
    this.logger.log(
      `Comunicazione ${comunicazioneId} presa in carico da ${operatoreUserId} tenant=${tenantId}`,
    );
    return updated;
  }

  async softDelete(
    tenantId: string,
    comunicazioneId: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.getTestata(tenantId, comunicazioneId);
    await this.db.prisma.comunicazione.update({
      where: { id: comunicazioneId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Comunicazione soft-deleted: ${comunicazioneId} tenant=${tenantId}`);
    return { id: comunicazioneId, deleted: true };
  }

  // ── Messaggi ───────────────────────────────────────────────────────────────

  async addMessaggio(
    tenantId: string,
    autoreUserId: string,
    comunicazioneId: string,
    dto: CreateComMessaggioDto,
  ): Promise<ComMessaggio> {
    const com = await this.getTestata(tenantId, comunicazioneId);
    if (com.chiusa) {
      throw new BadRequestException({
        errorCode: 'E_COM_CHIUSA_NO_REPLY',
        message: 'Comunicazione chiusa: riaprire prima di rispondere',
      });
    }

    // Lato operatore: solo studio (visibile al cliente) o interno (nota). cliente
    // è riservato al portale (livello 2).
    const lato = dto.lato ?? ComLato.studio;
    if (lato === ComLato.cliente) {
      throw new BadRequestException({
        errorCode: 'E_COM_MSG_LATO_CLIENTE_FORBIDDEN',
        message: "lato='cliente' non ammesso da operatore (riservato al portale)",
      });
    }
    const read = this.readFlagsFor(lato);

    const msg = await this.db.prisma.comMessaggio.create({
      data: {
        id: id(),
        tenantId,
        comunicazioneId,
        autoreUserId,
        lato,
        testo: dto.testo,
        lettoStudio: read.lettoStudio,
        lettoCliente: read.lettoCliente,
      },
    });

    // Bump dell'attività del thread (updatedAt = ultima attività → ordina l'inbox).
    // Riscrive `urgente` su sé stesso per forzare l'UPDATE che ribumpa @updatedAt.
    await this.db.prisma.comunicazione.update({
      where: { id: comunicazioneId },
      data: { urgente: com.urgente },
    });

    this.logger.log(`ComMessaggio created: ${msg.id} (lato=${lato}) com=${comunicazioneId}`);
    return msg;
  }

  // Marca come letti dallo studio tutti i messaggi lato cliente non ancora letti.
  async markLettoStudio(tenantId: string, comunicazioneId: string): Promise<{ updated: number }> {
    await this.getTestata(tenantId, comunicazioneId);
    const res = await this.db.prisma.comMessaggio.updateMany({
      where: { tenantId, comunicazioneId, lato: ComLato.cliente, lettoStudio: false },
      data: { lettoStudio: true },
    });
    return { updated: res.count };
  }

  // ── Portale cliente (ADR-0047) ───────────────────────────────────────────────
  // Superficie SOLO cliente: lista/dettaglio/reply/read-tracking scoped per
  // azienda. Lo scoping per-azienda è app-level (RLS resta tenant-flat, ADR-0046
  // §3): `aziendaId` arriva dal principal cliente. Metodi distinti da quelli
  // operatore (nessun ramo `if cliente` nei metodi esistenti).

  // Lista thread della propria azienda + conteggio messaggi studio non letti.
  async listForCliente(
    tenantId: string,
    aziendaId: string,
  ): Promise<ClienteComunicazioneListView[]> {
    const threads = await this.db.prisma.comunicazione.findMany({
      where: { tenantId, aziendaId },
      orderBy: { updatedAt: 'desc' },
    });
    if (threads.length === 0) return [];

    // Conteggio "non letti dal cliente" (messaggi lato=studio, lettoCliente=false)
    // in una sola query groupBy invece di N+1.
    const counts = await this.db.prisma.comMessaggio.groupBy({
      by: ['comunicazioneId'],
      where: {
        tenantId,
        comunicazioneId: { in: threads.map((t) => t.id) },
        lato: ComLato.studio,
        lettoCliente: false,
      },
      _count: { _all: true },
    });
    const nonLettiByThread = new Map(counts.map((c) => [c.comunicazioneId, c._count._all]));

    return threads.map((t) => ({
      id: t.id,
      codice: t.codice,
      oggetto: t.oggetto,
      chiusa: t.chiusa,
      updatedAt: t.updatedAt,
      nonLetti: nonLettiByThread.get(t.id) ?? 0,
    }));
  }

  // Dettaglio thread con messaggi (ESCLUSE le note interne, ADR-0047 §3).
  async getForCliente(
    tenantId: string,
    aziendaId: string,
    comunicazioneId: string,
  ): Promise<ClienteComunicazioneDetailView> {
    const com = await this.db.prisma.comunicazione.findFirst({
      // ACL nella query: un thread di altra azienda è indistinguibile da uno
      // inesistente (404), niente leak per id indovinato.
      where: { id: comunicazioneId, tenantId, aziendaId },
      include: {
        messaggi: {
          where: { lato: { not: ComLato.interno } },
          orderBy: { createdAt: 'asc' },
          include: { allegati: true },
        },
      },
    });
    if (!com) {
      throw new NotFoundException({
        errorCode: 'E_COM_NOT_FOUND',
        message: 'Comunicazione not found',
      });
    }
    return {
      id: com.id,
      codice: com.codice,
      oggetto: com.oggetto,
      chiusa: com.chiusa,
      createdAt: com.createdAt,
      updatedAt: com.updatedAt,
      messaggi: com.messaggi.map((m) => ({
        id: m.id,
        lato: m.lato,
        testo: m.testo,
        createdAt: m.createdAt,
        allegati: m.allegati.map((a) => ({
          id: a.id,
          nomeOrig: a.nomeOrig,
          mimeType: a.mimeType,
          dimensione: a.dimensione,
        })),
      })),
    };
  }

  // Reply lato cliente: forza `lato=cliente` e valorizza `autoreUserId`
  // (chiude il trade-off ADR-0043, ADR-0047 §4).
  async replyCliente(
    tenantId: string,
    aziendaId: string,
    comunicazioneId: string,
    autoreUserId: string,
    dto: ReplyClienteDto,
  ): Promise<ClienteComMessaggioView> {
    const com = await this.getTestataCliente(tenantId, aziendaId, comunicazioneId);
    if (com.chiusa) {
      throw new BadRequestException({
        errorCode: 'E_COM_CHIUSA_NO_REPLY',
        message: 'Comunicazione chiusa: lo studio deve riaprirla prima di rispondere',
      });
    }

    const read = this.readFlagsFor(ComLato.cliente);
    const msg = await this.db.prisma.comMessaggio.create({
      data: {
        id: id(),
        tenantId,
        comunicazioneId,
        autoreUserId,
        lato: ComLato.cliente,
        testo: dto.testo,
        lettoStudio: read.lettoStudio,
        lettoCliente: read.lettoCliente,
      },
    });

    // Bump attività del thread (updatedAt → ordina l'inbox studio e portale).
    await this.db.prisma.comunicazione.update({
      where: { id: comunicazioneId },
      data: { urgente: com.urgente },
    });

    this.logger.log(`ComMessaggio cliente created: ${msg.id} com=${comunicazioneId}`);
    return { id: msg.id, lato: msg.lato, testo: msg.testo, createdAt: msg.createdAt, allegati: [] };
  }

  // Marca come letti dal cliente i messaggi lato studio non ancora letti
  // (duale di markLettoStudio, ADR-0047 §5).
  async markLettoCliente(
    tenantId: string,
    aziendaId: string,
    comunicazioneId: string,
  ): Promise<{ updated: number }> {
    await this.getTestataCliente(tenantId, aziendaId, comunicazioneId);
    const res = await this.db.prisma.comMessaggio.updateMany({
      where: { tenantId, comunicazioneId, lato: ComLato.studio, lettoCliente: false },
      data: { lettoCliente: true },
    });
    return { updated: res.count };
  }

  // ── Allegati ───────────────────────────────────────────────────────────────

  async addAllegato(
    tenantId: string,
    messaggioId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<ComAllegato> {
    // Il messaggio deve appartenere al tenant (RLS + check esplicito).
    const msg = await this.db.prisma.comMessaggio.findFirst({
      where: { id: messaggioId, tenantId },
      select: { id: true },
    });
    if (!msg) {
      throw new NotFoundException({
        errorCode: 'E_COM_MSG_NOT_FOUND',
        message: 'Messaggio not found',
      });
    }

    const { key, size } = await this.storage.put({
      tenantId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      content: file.buffer,
    });

    return this.db.prisma.comAllegato.create({
      data: {
        id: id(),
        tenantId,
        messaggioId,
        nomeOrig: file.originalname,
        percorso: key,
        mimeType: file.mimetype,
        dimensione: size,
      },
    });
  }

  async getAllegatoForDownload(tenantId: string, allegatoId: string) {
    const allegato = await this.db.prisma.comAllegato.findFirst({
      where: { id: allegatoId, tenantId },
    });
    if (!allegato) {
      throw new NotFoundException({
        errorCode: 'E_COM_ALLEGATO_NOT_FOUND',
        message: 'Allegato not found',
      });
    }
    const object = await this.storage.get(allegato.percorso, allegato.mimeType);
    return { allegato, object };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getTestata(tenantId: string, comunicazioneId: string): Promise<Comunicazione> {
    const com = await this.db.prisma.comunicazione.findFirst({
      where: { id: comunicazioneId, tenantId },
    });
    if (!com) {
      throw new NotFoundException({
        errorCode: 'E_COM_NOT_FOUND',
        message: 'Comunicazione not found',
      });
    }
    return com;
  }

  // Testata scoped per-azienda (portale cliente, ADR-0047 §3). Un thread di altra
  // azienda → 404 (indistinguibile da inesistente, niente leak per id).
  private async getTestataCliente(
    tenantId: string,
    aziendaId: string,
    comunicazioneId: string,
  ): Promise<Comunicazione> {
    const com = await this.db.prisma.comunicazione.findFirst({
      where: { id: comunicazioneId, tenantId, aziendaId },
    });
    if (!com) {
      throw new NotFoundException({
        errorCode: 'E_COM_NOT_FOUND',
        message: 'Comunicazione not found',
      });
    }
    return com;
  }

  // lato studio → scritto dallo studio (lettoStudio=true, cliente deve leggere).
  // lato cliente → scritto dal cliente (lettoCliente=true, studio deve leggere).
  // lato interno → nota interna: nessun "non letto" cliente (lettoCliente=true).
  private readFlagsFor(lato: ComLato): { lettoStudio: boolean; lettoCliente: boolean } {
    switch (lato) {
      case ComLato.studio:
        return { lettoStudio: true, lettoCliente: false };
      case ComLato.cliente:
        return { lettoStudio: false, lettoCliente: true };
      case ComLato.interno:
        return { lettoStudio: true, lettoCliente: true };
      default: {
        const _exhaustive: never = lato;
        return _exhaustive;
      }
    }
  }

  private async assertAziendaEReferente(
    tenantId: string,
    aziendaId: string,
    referenteId: string | undefined,
  ): Promise<void> {
    const azienda = await this.db.prisma.azienda.findFirst({
      where: { id: aziendaId, tenantId },
      select: { id: true },
    });
    if (!azienda) {
      throw new BadRequestException({
        errorCode: 'E_COM_AZIENDA_NOT_FOUND',
        message: 'Azienda not found for tenant',
      });
    }
    if (referenteId) {
      const referente = await this.db.prisma.referente.findFirst({
        where: { id: referenteId, tenantId, aziendaId },
        select: { id: true },
      });
      if (!referente) {
        throw new BadRequestException({
          errorCode: 'E_COM_REFERENTE_NOT_FOUND',
          message: 'Referente not found for azienda',
        });
      }
    }
  }

  private async assertOperatore(tenantId: string, operatoreUserId: string): Promise<void> {
    const user = await this.db.prisma.user.findFirst({
      where: { id: operatoreUserId, tenantId },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException({
        errorCode: 'E_COM_OPERATORE_NOT_FOUND',
        message: 'Operatore not found for tenant',
      });
    }
  }
}
