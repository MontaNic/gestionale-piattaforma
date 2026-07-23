// =============================================================================
// note-spese-allegati.service.ts — allegati + storage (accountant, PR-2)
// =============================================================================
// Upload/download/delete allegati di una nota spese. StorageService astratto
// (ADR-0043): mai `fs` diretto. §5:
// - allow-list MIME locale al modulo (Pattern 43, nessun helper condiviso),
//   validata nel controller (fileFilter) E qui (defense-in-depth);
// - `mimeType` persistito = quello dell'upload verificato;
// - delete allegato → row + StorageService.delete nella stessa tx applicativa;
// - upload consentito solo su nota dell'autore in stato {bozza, respinta}.
// Download: load-then-authorize (autorizza la NOTA via getById = own|leggi_tutte,
// poi carica l'allegato; l'endpoint accetta l'id, mai lo storageKey).
// =============================================================================

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type NotaSpesaAllegato,
  type TipoAllegatoNotaSpesa,
  id,
  withTenantContextAtomicTx,
} from '@gestionale/db';
import { DbService } from '@gestionale/db/nest';
import { StorageService, catchUniqueViolation } from '@gestionale/platform';

import { NoteSpeseService } from './note-spese.service';

/** MIME ammessi per gli allegati (locale al modulo, §5). */
export const ALLEGATO_MIME_ALLOWLIST: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class NoteSpeseAllegatiService {
  private readonly logger = new Logger(NoteSpeseAllegatiService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(NoteSpeseService) private readonly noteSpese: NoteSpeseService,
  ) {}

  async upload(
    tenantId: string,
    userId: string,
    notaId: string,
    tipo: TipoAllegatoNotaSpesa,
    file: UploadedFileLike,
  ): Promise<NotaSpesaAllegato> {
    await this.noteSpese.assertOwnEditable(tenantId, userId, notaId);
    this.assertMimeAllowed(file.mimetype); // oltre al fileFilter del controller

    const { key, size } = await this.storage.put({
      tenantId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      content: file.buffer,
    });

    try {
      const allegato = await catchUniqueViolation(
        () =>
          this.db.prisma.notaSpesaAllegato.create({
            data: {
              id: id(),
              tenantId,
              notaSpesaId: notaId,
              tipo,
              storageKey: key,
              nomeOriginale: file.originalname,
              mimeType: file.mimetype, // verificato, non dichiarato
              dimensione: size,
            },
          }),
        'E_NOTASPESA_ALLEGATO_TIPO_EXISTS',
      );
      this.logger.log(`Allegato created: ${allegato.id} (${tipo}, ${size}B) nota=${notaId}`);
      return allegato;
    } catch (err) {
      // Orphan cleanup: create fallito (es. @@unique tipo) → rimuovi il file appena messo.
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  async getForDownload(tenantId: string, userId: string, notaId: string, allegatoId: string) {
    // Autorizza la NOTA (own o leggi_tutte); cross-tenant/user → 404 (no leak).
    await this.noteSpese.getById(tenantId, userId, notaId);
    const allegato = await this.db.prisma.notaSpesaAllegato.findFirst({
      where: { id: allegatoId, notaSpesaId: notaId, tenantId },
    });
    if (!allegato) throw this.notFound();
    const object = await this.storage.get(allegato.storageKey, allegato.mimeType);
    return { allegato, object };
  }

  async remove(
    tenantId: string,
    userId: string,
    notaId: string,
    allegatoId: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.noteSpese.assertOwnEditable(tenantId, userId, notaId);
    const allegato = await this.db.prisma.notaSpesaAllegato.findFirst({
      where: { id: allegatoId, notaSpesaId: notaId, tenantId },
    });
    if (!allegato) throw this.notFound();

    // Row + storage nella stessa tx applicativa: se storage.delete throwa → rollback.
    await withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await tx.notaSpesaAllegato.delete({ where: { id: allegatoId } });
      await this.storage.delete(allegato.storageKey);
    });
    this.logger.log(`Allegato deleted: ${allegatoId} nota=${notaId} tenant=${tenantId}`);
    return { id: allegatoId, deleted: true };
  }

  private assertMimeAllowed(mime: string): void {
    if (!ALLEGATO_MIME_ALLOWLIST.includes(mime)) {
      throw new BadRequestException({
        errorCode: 'E_NOTASPESA_ALLEGATO_MIME_INVALID',
        message: `MIME '${mime}' non ammesso (pdf/jpeg/png/webp)`,
      });
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      errorCode: 'E_NOTASPESA_ALLEGATO_NOT_FOUND',
      message: 'Allegato not found',
    });
  }
}
