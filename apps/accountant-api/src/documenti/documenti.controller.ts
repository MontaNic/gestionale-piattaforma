// =============================================================================
// documenti.controller.ts — REST /documenti (verticale accountant, ADR-0044)
// =============================================================================
// Solo operatore studio. Permessi documenti.{visualizza,gestisci} (catalogo
// 39→41). Prefisso /api/v1 da main.ts. L'upload è multipart (metadati DTO +
// `file`); il download è uno stream con Content-Disposition attachment.
//
// ORDINE ROTTE: `tipi` (statica) dichiarata prima delle rotte `:id`.
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
  Query,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { VisibilitaDocumento } from '@gestionale/db';
import { STORAGE_MAX_UPLOAD_BYTES } from '@gestionale/platform';
import { AuthErrorCode } from '@gestionale/shared';

import { DocumentiService, type DocumentiListFilter } from './documenti.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { CreateDocumentoTipoDto } from './dto/create-documento-tipo.dto';

// Forma minima del file multipart (memoryStorage) — evita @types/multer.
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Controller('documenti')
export class DocumentiController {
  constructor(@Inject(DocumentiService) private readonly documenti: DocumentiService) {}

  // ── Lista ────────────────────────────────────────────────────────────────────
  @Get()
  @RequirePermissions('documenti.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('aziendaId') aziendaId?: string,
    @Query('tipoId') tipoId?: string,
    @Query('visibilita') visibilita?: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const filter: DocumentiListFilter = {
      aziendaId: aziendaId || undefined,
      tipoId: tipoId || undefined,
      visibilita: isVisibilita(visibilita) ? visibilita : undefined,
    };
    const data = await this.documenti.list(user.tenantId, filter);
    return { data };
  }

  // ── Tipi (PRIMA di :id) ────────────────────────────────────────────────────────
  @Get('tipi')
  @RequirePermissions('documenti.visualizza')
  async listTipi(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.documenti.listTipi(user.tenantId);
    return { data };
  }

  @Post('tipi')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('documenti.gestisci')
  async createTipo(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateDocumentoTipoDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.documenti.createTipo(user.tenantId, dto);
    return { data };
  }

  // ── Upload (multipart) ──────────────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('documenti.gestisci')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: STORAGE_MAX_UPLOAD_BYTES } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateDocumentoDto,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    if (!file) {
      throw new BadRequestException({
        errorCode: 'E_DOCUMENTO_FILE_REQUIRED',
        message: 'file is required (multipart field "file")',
      });
    }
    const data = await this.documenti.create(user.tenantId, user.id, dto, file);
    return { data };
  }

  // ── Download ────────────────────────────────────────────────────────────────────
  @Get(':id/download')
  @RequirePermissions('documenti.visualizza')
  async download(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const { documento, object } = await this.documenti.getForDownload(user.tenantId, id);
    return new StreamableFile(object.stream, {
      type: object.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(documento.nomeOriginale)}"`,
      length: object.size,
    });
  }

  @Delete(':id')
  @RequirePermissions('documenti.gestisci')
  async softDelete(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.documenti.softDelete(user.tenantId, id);
    return { data };
  }
}

function isVisibilita(v: string | undefined): v is VisibilitaDocumento {
  return v === VisibilitaDocumento.tutti || v === VisibilitaDocumento.azienda;
}
