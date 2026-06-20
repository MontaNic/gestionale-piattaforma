// =============================================================================
// documenti.service.ts — scambio documenti studio↔cliente (verticale accountant, ADR-0044)
// =============================================================================
// Pattern replicato da scadenze (tipi platform NULL + custom per-tenant, scoping
// applicativo) + comunicazioni (allegati via StorageService). Soft-delete via
// update({ deletedAt }) — MAI .delete(). File via StorageService graduato in
// @gestionale/platform: `storageKey` opaca, file fuori dal docroot.
//
// Visibilità MVP (tutti|azienda): è metadato di routing per il FUTURO portale
// cliente. L'operatore vede tutti i documenti del proprio tenant (RLS flat) →
// nessuna ACL per-utente da applicare in F1.
// =============================================================================

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Documento, type DocumentoTipo, VisibilitaDocumento, id } from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { catchUniqueViolation, StorageService } from '@gestionale/platform';

import type { CreateDocumentoDto } from './dto/create-documento.dto';
import type { CreateDocumentoTipoDto } from './dto/create-documento-tipo.dto';

export interface DocumentiListFilter {
  aziendaId?: string;
  tipoId?: string;
  visibilita?: VisibilitaDocumento;
}

@Injectable()
export class DocumentiService {
  private readonly logger = new Logger(DocumentiService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  // ── Documenti ────────────────────────────────────────────────────────────────

  async list(tenantId: string, filter: DocumentiListFilter = {}): Promise<Documento[]> {
    return this.db.prisma.documento.findMany({
      where: {
        tenantId,
        ...(filter.aziendaId ? { aziendaId: filter.aziendaId } : {}),
        ...(filter.tipoId ? { tipoId: filter.tipoId } : {}),
        ...(filter.visibilita ? { visibilita: filter.visibilita } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    tenantId: string,
    createdBy: string,
    dto: CreateDocumentoDto,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<Documento> {
    await this.assertAzienda(tenantId, dto.aziendaId);
    await this.assertTipoAccessibile(tenantId, dto.tipoId);

    const { key, size } = await this.storage.put({
      tenantId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      content: file.buffer,
    });

    const documento = await this.db.prisma.documento.create({
      data: {
        id: id(),
        tenantId,
        tipoId: dto.tipoId,
        aziendaId: dto.aziendaId,
        nomeOriginale: file.originalname,
        storageKey: key,
        mimeType: file.mimetype,
        dimensione: size,
        visibilita: dto.visibilita,
        note: dto.note ?? null,
        createdBy,
      },
    });

    this.logger.log(`Documento created: ${documento.id} (${size}B) tenant=${tenantId}`);
    return documento;
  }

  async getForDownload(tenantId: string, documentoId: string) {
    const documento = await this.db.prisma.documento.findFirst({
      where: { id: documentoId, tenantId },
    });
    if (!documento) {
      throw new NotFoundException({
        errorCode: 'E_DOCUMENTO_NOT_FOUND',
        message: 'Documento not found',
      });
    }
    const object = await this.storage.get(documento.storageKey, documento.mimeType);
    return { documento, object };
  }

  async softDelete(tenantId: string, documentoId: string): Promise<{ id: string; deleted: true }> {
    const before = await this.db.prisma.documento.findFirst({
      where: { id: documentoId, tenantId },
    });
    if (!before) {
      throw new NotFoundException({
        errorCode: 'E_DOCUMENTO_NOT_FOUND',
        message: 'Documento not found',
      });
    }
    // Soft-delete (ADR-0021): il record resta, il file su storage NON è rimosso
    // qui (garbage collection orfani = backlog ADR-0044).
    await this.db.prisma.documento.update({
      where: { id: documentoId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Documento soft-deleted: ${documentoId} tenant=${tenantId}`);
    return { id: documentoId, deleted: true };
  }

  // ── Tipi (platform NULL + custom per-tenant) ─────────────────────────────────

  async listTipi(tenantId: string): Promise<DocumentoTipo[]> {
    // documenti_tipi NON ha RLS → scoping esplicito: platform (tenant_id NULL) +
    // custom del tenant corrente.
    return this.db.prisma.documentoTipo.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      orderBy: [{ ordine: 'asc' }, { nome: 'asc' }],
    });
  }

  async createTipo(tenantId: string, dto: CreateDocumentoTipoDto): Promise<DocumentoTipo> {
    const existing = await this.db.prisma.documentoTipo.findFirst({
      where: { tenantId, nome: dto.nome },
    });
    if (existing) {
      throw new ConflictException({
        errorCode: 'E_DOCUMENTO_TIPO_NOME_EXISTS',
        message: `Tipo '${dto.nome}' already exists for tenant`,
      });
    }
    const tipo = await catchUniqueViolation(
      () =>
        this.db.prisma.documentoTipo.create({
          data: {
            id: id(),
            tenantId,
            nome: dto.nome,
            direzione: dto.direzione,
            visibilitaDefault: dto.visibilitaDefault ?? VisibilitaDocumento.tutti,
          },
        }),
      'E_DOCUMENTO_TIPO_NOME_EXISTS',
    );
    this.logger.log(`DocumentoTipo created: ${tipo.id} (${tipo.nome}) tenant=${tenantId}`);
    return tipo;
  }

  // ── Validazioni ───────────────────────────────────────────────────────────────

  private async assertAzienda(tenantId: string, aziendaId: string): Promise<void> {
    const azienda = await this.db.prisma.azienda.findFirst({
      where: { id: aziendaId, tenantId },
      select: { id: true },
    });
    if (!azienda) {
      throw new BadRequestException({
        errorCode: 'E_DOCUMENTO_AZIENDA_NOT_FOUND',
        message: 'Azienda not found for tenant',
      });
    }
  }

  // tipoId deve essere platform (tenant_id NULL) o custom del tenant corrente.
  private async assertTipoAccessibile(tenantId: string, tipoId: string): Promise<void> {
    const tipo = await this.db.prisma.documentoTipo.findFirst({
      where: { id: tipoId, OR: [{ tenantId: null }, { tenantId }] },
      select: { id: true },
    });
    if (!tipo) {
      throw new BadRequestException({
        errorCode: 'E_DOCUMENTO_TIPO_NOT_FOUND',
        message: 'Tipo not found or not accessible',
      });
    }
  }
}
