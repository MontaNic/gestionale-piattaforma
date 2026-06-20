// =============================================================================
// comunicazioni.controller.ts — REST /comunicazioni (verticale accountant, ADR-0043)
// =============================================================================
// Solo operatore studio (accountant-web). Permessi comunicazioni.{visualizza,
// gestisci} (catalogo 37→39). Prefisso /api/v1 da main.ts.
//
// ORDINE ROTTE: le rotte con primo segmento statico (`allegati`) hanno profondità
// diversa da `:id` (Express discrimina per numero di segmenti); le statiche sotto
// `:id` (`prendi`, `letto`, `messaggi`) sono distinte dal segmento. Nessun
// conflitto con la GET `:id`.
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
  Patch,
  Post,
  Query,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { ComunicazioniService, type ComunicazioniListFilter } from './comunicazioni.service';
import { CreateComunicazioneDto } from './dto/create-comunicazione.dto';
import { CreateComMessaggioDto } from './dto/create-com-messaggio.dto';
import { UpdateComunicazioneDto } from './dto/update-comunicazione.dto';
import { STORAGE_MAX_UPLOAD_BYTES } from '../storage/storage.service';

// Forma minima del file multipart (memoryStorage di multer) — evita la dip
// @types/multer non installata.
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Controller('comunicazioni')
export class ComunicazioniController {
  constructor(@Inject(ComunicazioniService) private readonly comunicazioni: ComunicazioniService) {}

  // ── Lista inbox ────────────────────────────────────────────────────────────
  @Get()
  @RequirePermissions('comunicazioni.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('aziendaId') aziendaId?: string,
    @Query('chiusa') chiusa?: string,
    @Query('urgente') urgente?: string,
    @Query('operatoreAssegnatoId') operatoreAssegnatoId?: string,
    @Query('daPrendere') daPrendere?: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const filter: ComunicazioniListFilter = {
      aziendaId: aziendaId || undefined,
      chiusa: chiusa === undefined ? undefined : chiusa === 'true',
      urgente: urgente === undefined ? undefined : urgente === 'true',
      operatoreAssegnatoId: operatoreAssegnatoId || undefined,
      daPrendere: daPrendere === 'true' ? true : undefined,
    };
    const data = await this.comunicazioni.list(user.tenantId, filter);
    return { data };
  }

  // ── Download allegato (profondità 2: distinta da :id) ────────────────────────
  @Get('allegati/:allegatoId')
  @RequirePermissions('comunicazioni.visualizza')
  async downloadAllegato(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('allegatoId') allegatoId: string,
  ): Promise<StreamableFile> {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const { allegato, object } = await this.comunicazioni.getAllegatoForDownload(
      user.tenantId,
      allegatoId,
    );
    return new StreamableFile(object.stream, {
      type: object.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(allegato.nomeOrig)}"`,
      length: object.size,
    });
  }

  // ── Create thread ────────────────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('comunicazioni.gestisci')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateComunicazioneDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.comunicazioni.create(user.tenantId, user.id, dto);
    return { data };
  }

  // ── Dettaglio thread ─────────────────────────────────────────────────────────
  @Get(':id')
  @RequirePermissions('comunicazioni.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.comunicazioni.getById(user.tenantId, id);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('comunicazioni.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateComunicazioneDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.comunicazioni.update(user.tenantId, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('comunicazioni.gestisci')
  async softDelete(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.comunicazioni.softDelete(user.tenantId, id);
    return { data };
  }

  // Presa in carico (self-assign).
  @Post(':id/prendi')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('comunicazioni.gestisci')
  async prendi(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.comunicazioni.prendiInCarico(user.tenantId, id, user.id);
    return { data };
  }

  // Marca i messaggi cliente come letti dallo studio.
  @Post(':id/letto')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('comunicazioni.visualizza')
  async marcaLetto(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.comunicazioni.markLettoStudio(user.tenantId, id);
    return { data };
  }

  // ── Messaggio in un thread ────────────────────────────────────────────────────
  @Post(':id/messaggi')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('comunicazioni.gestisci')
  async addMessaggio(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: CreateComMessaggioDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.comunicazioni.addMessaggio(user.tenantId, user.id, id, dto);
    return { data };
  }

  // ── Upload allegato su un messaggio ───────────────────────────────────────────
  @Post('messaggi/:messaggioId/allegati')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('comunicazioni.gestisci')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: STORAGE_MAX_UPLOAD_BYTES } }))
  async uploadAllegato(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('messaggioId') messaggioId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    if (!file) {
      throw new BadRequestException({
        errorCode: 'E_COM_ALLEGATO_FILE_REQUIRED',
        message: 'file is required (multipart field "file")',
      });
    }
    const data = await this.comunicazioni.addAllegato(user.tenantId, messaggioId, file);
    return { data };
  }
}
