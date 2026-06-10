// =============================================================================
// scadenze.service.ts — CRUD scadenze (calendario fiscale) + categorie (STOP-scad1)
// =============================================================================
// Pattern replicato da aziende.service.ts (CRUD tenant-level + soft-delete):
// - read/write single-op via this.db.prisma (RLS context attivo via
//   TenantContextInterceptor → AsyncLocalStorage, ADR-0009).
// - soft-delete via update({ deletedAt }) esplicito (ADR-0021 — MAI .delete()).
//
// Specifico del modulo:
// - scadenze_categorie NON ha RLS (le righe piattaforma sono tenant_id NULL):
//   ogni read/write categorie e' scopata ESPLICITAMENTE nel service
//   (OR[tenantId NULL, tenantId corrente] in lettura; tenantId corrente in
//   scrittura). Le custom hanno partial-unique (tenant_id, nome) WHERE
//   tenant_id IS NOT NULL → pre-check + catchUniqueViolation backstop.
// - Validazioni business: visibilita='azienda' ⇒ aziendaId obbligatorio +
//   esistente per il tenant; categoriaId (se presente) deve essere piattaforma
//   o custom del tenant. Tutte nel service (la ValidationPipe non gira in e2e,
//   TD-BS) → esercitabili dagli e2e.
// =============================================================================

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Scadenza, type ScadenzaCategoria, VisibilitaScadenza, id } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { catchUniqueViolation } from '@gestionale/platform';
import type { CreateScadenzaDto } from './dto/create-scadenza.dto';
import type { CreateScadenzaCategoriaDto } from './dto/create-scadenza-categoria.dto';
import type { UpdateScadenzaDto } from './dto/update-scadenza.dto';

export interface ScadenzeListFilter {
  aziendaId?: string;
  categoriaId?: string;
  attivo?: boolean;
  da?: string; // ISO date YYYY-MM-DD, inclusive lower bound su dataScadenza
  a?: string; // ISO date YYYY-MM-DD, inclusive upper bound su dataScadenza
}

@Injectable()
export class ScadenzeService {
  private readonly logger = new Logger(ScadenzeService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  // ── Scadenze ───────────────────────────────────────────────────────────────

  async list(tenantId: string, filter: ScadenzeListFilter = {}): Promise<Scadenza[]> {
    const dataScadenza =
      filter.da || filter.a
        ? {
            ...(filter.da ? { gte: new Date(filter.da) } : {}),
            ...(filter.a ? { lte: new Date(filter.a) } : {}),
          }
        : undefined;

    return this.db.prisma.scadenza.findMany({
      where: {
        tenantId,
        ...(filter.aziendaId ? { aziendaId: filter.aziendaId } : {}),
        ...(filter.categoriaId ? { categoriaId: filter.categoriaId } : {}),
        ...(filter.attivo !== undefined ? { attivo: filter.attivo } : {}),
        ...(dataScadenza ? { dataScadenza } : {}),
      },
      orderBy: [{ dataScadenza: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getById(tenantId: string, scadenzaId: string): Promise<Scadenza> {
    const scadenza = await this.db.prisma.scadenza.findFirst({
      where: { id: scadenzaId, tenantId },
    });
    if (!scadenza) {
      throw new NotFoundException({
        errorCode: 'E_SCADENZA_NOT_FOUND',
        message: 'Scadenza not found',
      });
    }
    return scadenza;
  }

  async create(tenantId: string, dto: CreateScadenzaDto): Promise<Scadenza> {
    const visibilita = dto.visibilita ?? VisibilitaScadenza.tutti;
    await this.assertVisibilitaCoerente(tenantId, visibilita, dto.aziendaId);
    await this.assertCategoriaAccessibile(tenantId, dto.categoriaId);

    const scadenza = await this.db.prisma.scadenza.create({
      data: {
        id: id(),
        tenantId,
        titolo: dto.titolo,
        descrizione: dto.descrizione,
        dataScadenza: new Date(dto.dataScadenza),
        categoriaId: dto.categoriaId ?? null,
        visibilita,
        aziendaId:
          visibilita === VisibilitaScadenza.azienda ? dto.aziendaId : (dto.aziendaId ?? null),
        attivo: dto.attivo ?? undefined,
      },
    });

    this.logger.log(`Scadenza created: ${scadenza.id} (${scadenza.titolo}) tenant=${tenantId}`);
    return scadenza;
  }

  async update(tenantId: string, scadenzaId: string, dto: UpdateScadenzaDto): Promise<Scadenza> {
    const before = await this.db.prisma.scadenza.findFirst({
      where: { id: scadenzaId, tenantId },
    });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_SCADENZA_NOT_FOUND',
        message: 'Scadenza not found',
      });
    }

    // Visibilita' e aziendaId effettivi dopo il patch (per validare la coerenza
    // sul risultato, non solo sui campi inviati).
    const visibilita = dto.visibilita ?? before.visibilita;
    const aziendaId = dto.aziendaId !== undefined ? dto.aziendaId : (before.aziendaId ?? undefined);
    await this.assertVisibilitaCoerente(tenantId, visibilita, aziendaId);
    if (dto.categoriaId !== undefined) {
      await this.assertCategoriaAccessibile(tenantId, dto.categoriaId);
    }

    const updated = await this.db.prisma.scadenza.update({
      where: { id: scadenzaId },
      data: {
        titolo: dto.titolo,
        descrizione: dto.descrizione,
        dataScadenza: dto.dataScadenza ? new Date(dto.dataScadenza) : undefined,
        categoriaId: dto.categoriaId,
        visibilita: dto.visibilita,
        aziendaId: dto.aziendaId,
        attivo: dto.attivo,
      },
    });

    this.logger.log(`Scadenza updated: ${updated.id} tenant=${tenantId}`);
    return updated;
  }

  async softDelete(tenantId: string, scadenzaId: string): Promise<{ id: string; deleted: true }> {
    const before = await this.db.prisma.scadenza.findFirst({
      where: { id: scadenzaId, tenantId },
    });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_SCADENZA_NOT_FOUND',
        message: 'Scadenza not found',
      });
    }

    // Soft-delete esplicito (ADR-0021): MAI .delete().
    await this.db.prisma.scadenza.update({
      where: { id: scadenzaId },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Scadenza soft-deleted: ${scadenzaId} tenant=${tenantId}`);
    return { id: scadenzaId, deleted: true };
  }

  // ── Categorie (piattaforma NULL + custom tenant) ─────────────────────────────

  async listCategorie(tenantId: string): Promise<ScadenzaCategoria[]> {
    // scadenze_categorie NON ha RLS → scoping esplicito: piattaforma (tenant_id
    // NULL) + custom del tenant corrente.
    return this.db.prisma.scadenzaCategoria.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      orderBy: [{ ordine: 'asc' }, { nome: 'asc' }],
    });
  }

  async createCategoria(
    tenantId: string,
    dto: CreateScadenzaCategoriaDto,
  ): Promise<ScadenzaCategoria> {
    // Pre-check duplicato per-tenant (il partial-unique copre solo le custom).
    const existing = await this.db.prisma.scadenzaCategoria.findFirst({
      where: { tenantId, nome: dto.nome },
    });
    if (existing) {
      throw new ConflictException({
        errorCode: 'E_SCADENZA_CATEGORIA_NOME_EXISTS',
        message: `Categoria '${dto.nome}' already exists for tenant`,
      });
    }

    const categoria = await catchUniqueViolation(
      () =>
        this.db.prisma.scadenzaCategoria.create({
          data: {
            id: id(),
            tenantId,
            nome: dto.nome,
            colore: dto.colore ?? undefined,
            ordine: dto.ordine ?? undefined,
            attivo: dto.attivo ?? undefined,
          },
        }),
      'E_SCADENZA_CATEGORIA_NOME_EXISTS',
    );

    this.logger.log(
      `ScadenzaCategoria created: ${categoria.id} (${categoria.nome}) tenant=${tenantId}`,
    );
    return categoria;
  }

  // ── Validazioni business ─────────────────────────────────────────────────────

  // visibilita='azienda' ⇒ aziendaId obbligatorio + esistente per il tenant.
  // Per ogni visibilita': se aziendaId e' valorizzato, deve esistere per il tenant.
  private async assertVisibilitaCoerente(
    tenantId: string,
    visibilita: VisibilitaScadenza,
    aziendaId: string | undefined,
  ): Promise<void> {
    if (visibilita === VisibilitaScadenza.azienda && !aziendaId) {
      throw new BadRequestException({
        errorCode: 'E_SCADENZA_AZIENDA_REQUIRED',
        message: "aziendaId is required when visibilita='azienda'",
      });
    }
    if (aziendaId) {
      const azienda = await this.db.prisma.azienda.findFirst({
        where: { id: aziendaId, tenantId },
        select: { id: true },
      });
      if (!azienda) {
        throw new BadRequestException({
          errorCode: 'E_SCADENZA_AZIENDA_NOT_FOUND',
          message: 'Azienda not found for tenant',
        });
      }
    }
  }

  // categoriaId (se presente) deve essere piattaforma (tenant_id NULL) o custom
  // del tenant corrente.
  private async assertCategoriaAccessibile(
    tenantId: string,
    categoriaId: string | undefined,
  ): Promise<void> {
    if (!categoriaId) return;
    const categoria = await this.db.prisma.scadenzaCategoria.findFirst({
      where: { id: categoriaId, OR: [{ tenantId: null }, { tenantId }] },
      select: { id: true },
    });
    if (!categoria) {
      throw new BadRequestException({
        errorCode: 'E_SCADENZA_CATEGORIA_NOT_FOUND',
        message: 'Categoria not found or not accessible',
      });
    }
  }
}
