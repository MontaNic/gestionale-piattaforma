// =============================================================================
// catalogo.service.ts — Catalogo servizi: categorie + voci (ADR-0050)
// =============================================================================
// Pattern ScadenzaCategoria: NESSUNA RLS sui due modelli (righe piattaforma
// tenant_id NULL), scoping ESPLICITO via OR: [{ tenantId: null }, { tenantId }].
//
// Invariante di accesso: le righe piattaforma (tenantId null) sono VISIBILI a
// tutti i tenant ma NON modificabili/cancellabili da nessuno (solo seed). In
// scrittura → assertOwned() lancia 403 se la riga è di piattaforma. Le righe
// custom hanno tenantId valorizzato == quello del chiamante (garantito dal
// filtro di scoping), quindi sempre owned.
//
// DELETE fisico (no soft-delete su lookup table). FK preventivi_voci.servizio_id
// è ON DELETE SET NULL → eliminare un servizio non rompe i preventivi storici
// (lo snapshot denormalizzato della voce resta).
// =============================================================================

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type ServizioCatalogo, type ServizioCategoria, id } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { catchUniqueViolation } from '@gestionale/platform';

import type { CreateServizioCategoriaDto } from './dto/create-servizio-categoria.dto';
import type { UpdateServizioCategoriaDto } from './dto/update-servizio-categoria.dto';
import type { CreateServizioCatalogoDto } from './dto/create-servizio-catalogo.dto';
import type { UpdateServizioCatalogoDto } from './dto/update-servizio-catalogo.dto';

export interface ServiziListFilter {
  categoriaId?: string;
  attivo?: boolean;
}

@Injectable()
export class CatalogoService {
  private readonly logger = new Logger(CatalogoService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  // ── Categorie ────────────────────────────────────────────────────────────────

  async listCategorie(tenantId: string): Promise<ServizioCategoria[]> {
    return this.db.prisma.servizioCategoria.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      orderBy: [{ ordine: 'asc' }, { nome: 'asc' }],
    });
  }

  async createCategoria(
    tenantId: string,
    dto: CreateServizioCategoriaDto,
  ): Promise<ServizioCategoria> {
    // Pre-check duplicato per-tenant (il partial-unique copre solo le custom).
    const existing = await this.db.prisma.servizioCategoria.findFirst({
      where: { tenantId, nome: dto.nome },
    });
    if (existing) {
      throw new ConflictException({
        errorCode: 'E_SERVIZIO_CATEGORIA_NOME_EXISTS',
        message: `Categoria '${dto.nome}' already exists for tenant`,
      });
    }

    const categoria = await catchUniqueViolation(
      () =>
        this.db.prisma.servizioCategoria.create({
          data: {
            id: id(),
            tenantId,
            nome: dto.nome,
            descrizione: dto.descrizione ?? null,
            colore: dto.colore ?? undefined,
            ordine: dto.ordine ?? undefined,
            attivo: dto.attivo ?? undefined,
          },
        }),
      'E_SERVIZIO_CATEGORIA_NOME_EXISTS',
    );

    this.logger.log(`ServizioCategoria created: ${categoria.id} tenant=${tenantId}`);
    return categoria;
  }

  async updateCategoria(
    tenantId: string,
    categoriaId: string,
    dto: UpdateServizioCategoriaDto,
  ): Promise<ServizioCategoria> {
    await this.assertCategoriaOwned(tenantId, categoriaId);
    const updated = await catchUniqueViolation(
      () =>
        this.db.prisma.servizioCategoria.update({
          where: { id: categoriaId },
          data: {
            nome: dto.nome,
            descrizione: dto.descrizione,
            colore: dto.colore,
            ordine: dto.ordine,
            attivo: dto.attivo,
          },
        }),
      'E_SERVIZIO_CATEGORIA_NOME_EXISTS',
    );
    this.logger.log(`ServizioCategoria updated: ${categoriaId} tenant=${tenantId}`);
    return updated;
  }

  async deleteCategoria(
    tenantId: string,
    categoriaId: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.assertCategoriaOwned(tenantId, categoriaId);
    // DELETE fisico: la FK servizi_catalogo.categoria_id è ON DELETE SET NULL.
    await this.db.prisma.servizioCategoria.delete({ where: { id: categoriaId } });
    this.logger.log(`ServizioCategoria deleted: ${categoriaId} tenant=${tenantId}`);
    return { id: categoriaId, deleted: true };
  }

  // ── Servizi ──────────────────────────────────────────────────────────────────

  async listServizi(tenantId: string, filter: ServiziListFilter = {}): Promise<ServizioCatalogo[]> {
    return this.db.prisma.servizioCatalogo.findMany({
      where: {
        OR: [{ tenantId: null }, { tenantId }],
        ...(filter.categoriaId ? { categoriaId: filter.categoriaId } : {}),
        ...(filter.attivo !== undefined ? { attivo: filter.attivo } : {}),
      },
      orderBy: [{ ordine: 'asc' }, { nome: 'asc' }],
    });
  }

  async findOneServizio(tenantId: string, servizioId: string): Promise<ServizioCatalogo> {
    const servizio = await this.db.prisma.servizioCatalogo.findFirst({
      where: { id: servizioId, OR: [{ tenantId: null }, { tenantId }] },
    });
    if (!servizio) {
      throw new NotFoundException({
        errorCode: 'E_SERVIZIO_NOT_FOUND',
        message: 'Servizio not found',
      });
    }
    return servizio;
  }

  async createServizio(
    tenantId: string,
    dto: CreateServizioCatalogoDto,
  ): Promise<ServizioCatalogo> {
    await this.assertCategoriaAccessibile(tenantId, dto.categoriaId);

    const existing = await this.db.prisma.servizioCatalogo.findFirst({
      where: { tenantId, codice: dto.codice },
    });
    if (existing) {
      throw new ConflictException({
        errorCode: 'E_SERVIZIO_CODICE_EXISTS',
        message: `Servizio codice '${dto.codice}' already exists for tenant`,
      });
    }

    const servizio = await catchUniqueViolation(
      () =>
        this.db.prisma.servizioCatalogo.create({
          data: {
            id: id(),
            tenantId,
            codice: dto.codice,
            nome: dto.nome,
            descrizione: dto.descrizione ?? null,
            categoriaId: dto.categoriaId ?? null,
            unitaMisura: dto.unitaMisura ?? undefined,
            prezzoBase: dto.prezzoBase,
            ivaAliquota: dto.ivaAliquota ?? undefined,
            tipoRicorrenza: dto.tipoRicorrenza ?? undefined,
            attivo: dto.attivo ?? undefined,
            ordine: dto.ordine ?? undefined,
          },
        }),
      'E_SERVIZIO_CODICE_EXISTS',
    );

    this.logger.log(`ServizioCatalogo created: ${servizio.id} tenant=${tenantId}`);
    return servizio;
  }

  async updateServizio(
    tenantId: string,
    servizioId: string,
    dto: UpdateServizioCatalogoDto,
  ): Promise<ServizioCatalogo> {
    await this.assertServizioOwned(tenantId, servizioId);
    if (dto.categoriaId !== undefined) {
      await this.assertCategoriaAccessibile(tenantId, dto.categoriaId);
    }
    const updated = await catchUniqueViolation(
      () =>
        this.db.prisma.servizioCatalogo.update({
          where: { id: servizioId },
          data: {
            codice: dto.codice,
            nome: dto.nome,
            descrizione: dto.descrizione,
            categoriaId: dto.categoriaId,
            unitaMisura: dto.unitaMisura,
            prezzoBase: dto.prezzoBase,
            ivaAliquota: dto.ivaAliquota,
            tipoRicorrenza: dto.tipoRicorrenza,
            attivo: dto.attivo,
            ordine: dto.ordine,
          },
        }),
      'E_SERVIZIO_CODICE_EXISTS',
    );
    this.logger.log(`ServizioCatalogo updated: ${servizioId} tenant=${tenantId}`);
    return updated;
  }

  async deleteServizio(
    tenantId: string,
    servizioId: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.assertServizioOwned(tenantId, servizioId);
    await this.db.prisma.servizioCatalogo.delete({ where: { id: servizioId } });
    this.logger.log(`ServizioCatalogo deleted: ${servizioId} tenant=${tenantId}`);
    return { id: servizioId, deleted: true };
  }

  // ── Helpers di accesso ─────────────────────────────────────────────────────────

  /**
   * Carica una categoria in-scope (platform o del tenant). 404 se fuori scope,
   * 403 se è di piattaforma (read-only: modificabile solo da seed/superadmin).
   */
  private async assertCategoriaOwned(tenantId: string, categoriaId: string): Promise<void> {
    const categoria = await this.db.prisma.servizioCategoria.findFirst({
      where: { id: categoriaId, OR: [{ tenantId: null }, { tenantId }] },
      select: { id: true, tenantId: true },
    });
    if (!categoria) {
      throw new NotFoundException({
        errorCode: 'E_SERVIZIO_CATEGORIA_NOT_FOUND',
        message: 'Categoria not found',
      });
    }
    if (categoria.tenantId === null) {
      throw new ForbiddenException({
        errorCode: 'E_SERVIZIO_CATEGORIA_PLATFORM_READONLY',
        message: 'Platform category is read-only',
      });
    }
  }

  private async assertServizioOwned(tenantId: string, servizioId: string): Promise<void> {
    const servizio = await this.db.prisma.servizioCatalogo.findFirst({
      where: { id: servizioId, OR: [{ tenantId: null }, { tenantId }] },
      select: { id: true, tenantId: true },
    });
    if (!servizio) {
      throw new NotFoundException({
        errorCode: 'E_SERVIZIO_NOT_FOUND',
        message: 'Servizio not found',
      });
    }
    if (servizio.tenantId === null) {
      throw new ForbiddenException({
        errorCode: 'E_SERVIZIO_PLATFORM_READONLY',
        message: 'Platform service is read-only',
      });
    }
  }

  /** Verifica che la categoria (se valorizzata) sia accessibile: platform o del tenant. */
  private async assertCategoriaAccessibile(
    tenantId: string,
    categoriaId: string | undefined,
  ): Promise<void> {
    if (!categoriaId) return;
    const categoria = await this.db.prisma.servizioCategoria.findFirst({
      where: { id: categoriaId, OR: [{ tenantId: null }, { tenantId }] },
      select: { id: true },
    });
    if (!categoria) {
      throw new NotFoundException({
        errorCode: 'E_SERVIZIO_CATEGORIA_NOT_FOUND',
        message: 'Categoria not found or not accessible',
      });
    }
  }
}
