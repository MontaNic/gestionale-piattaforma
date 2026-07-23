// =============================================================================
// note-spese-allegati.controller.ts — REST /note-spese/:id/allegati (PR-2)
// =============================================================================
// Solo operatore studio. Prefisso /api/v1 da main.ts. Tutti gated
// `notespese.gestisci` (upload/delete richiedono nota editabile propria;
// download autorizza la nota via own|leggi_tutte nel service).
// - upload: multipart (`file` + form field `tipo`); allow-list MIME al
//   fileFilter (rifiuto in parse) E nel service (defense-in-depth, §5);
// - download: StreamableFile, Content-Disposition attachment (load-then-authorize);
// - l'endpoint accetta SEMPRE l'id dell'allegato, mai lo storageKey.
// =============================================================================

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { TipoAllegatoNotaSpesa } from '@gestionale/db';
import { STORAGE_MAX_UPLOAD_BYTES } from '@gestionale/platform';
import { AuthErrorCode } from '@gestionale/shared';

import { ALLEGATO_MIME_ALLOWLIST, NoteSpeseAllegatiService } from './note-spese-allegati.service';

interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

// fileFilter: rifiuta al parse i MIME fuori allow-list (§5). Il service riverifica.
function mimeAllowlistFilter(
  _req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (ALLEGATO_MIME_ALLOWLIST.includes(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(
    new BadRequestException({
      errorCode: 'E_NOTASPESA_ALLEGATO_MIME_INVALID',
      message: `MIME '${file.mimetype}' non ammesso (pdf/jpeg/png/webp)`,
    }),
    false,
  );
}

@Controller('note-spese/:id/allegati')
export class NoteSpeseAllegatiController {
  constructor(
    @Inject(NoteSpeseAllegatiService) private readonly allegati: NoteSpeseAllegatiService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('notespese.gestisci')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: STORAGE_MAX_UPLOAD_BYTES },
      fileFilter: mimeAllowlistFilter,
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') notaId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    // `tipo` viaggia come form field del multipart; validato manualmente (no DTO
    // globale sul body multipart).
    @Body('tipo') tipo?: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    if (!file) {
      throw new BadRequestException({
        errorCode: 'E_NOTASPESA_ALLEGATO_FILE_REQUIRED',
        message: 'file is required (multipart field "file")',
      });
    }
    if (!isTipoAllegato(tipo)) {
      throw new BadRequestException({
        errorCode: 'E_NOTASPESA_ALLEGATO_TIPO_INVALID',
        message: 'tipo must be one of: giustificativo, scontrino_pos',
      });
    }
    const data = await this.allegati.upload(user.tenantId, user.id, notaId, tipo, file);
    return { data };
  }

  @Get(':allegatoId')
  @RequirePermissions('notespese.gestisci')
  async download(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') notaId: string,
    @Param('allegatoId') allegatoId: string,
  ): Promise<StreamableFile> {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const { allegato, object } = await this.allegati.getForDownload(
      user.tenantId,
      user.id,
      notaId,
      allegatoId,
    );
    return new StreamableFile(object.stream, {
      type: object.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(allegato.nomeOriginale)}"`,
      length: object.size,
    });
  }

  @Delete(':allegatoId')
  @RequirePermissions('notespese.gestisci')
  async remove(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') notaId: string,
    @Param('allegatoId') allegatoId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.allegati.remove(user.tenantId, user.id, notaId, allegatoId);
    return { data };
  }
}

function isTipoAllegato(v: string | undefined): v is TipoAllegatoNotaSpesa {
  return v === TipoAllegatoNotaSpesa.giustificativo || v === TipoAllegatoNotaSpesa.scontrino_pos;
}
