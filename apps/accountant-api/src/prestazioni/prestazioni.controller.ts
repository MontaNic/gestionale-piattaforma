// =============================================================================
// prestazioni.controller.ts — REST timesheet nested sul mandato (ADR-0053)
// =============================================================================
// /mandati/:mandatoId/prestazioni — il timesheet vive dentro il mandato.
// Permessi prestazioni.{visualizza,gestisci} (distinti da mandati.* → un
// praticante registra ore senza gestire i mandati). tenantId + userId dal JWT
// (@CurrentUser). Risposta { data }. Prefisso /api/v1 da main.ts.
// =============================================================================

import {
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
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { PrestazioniService } from './prestazioni.service';
import { CreatePrestazioneDto } from './dto/create-prestazione.dto';
import { UpdatePrestazioneDto } from './dto/update-prestazione.dto';

@Controller('mandati/:mandatoId/prestazioni')
export class PrestazioniController {
  constructor(@Inject(PrestazioniService) private readonly prestazioni: PrestazioniService) {}

  @Get()
  @RequirePermissions('prestazioni.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('mandatoId') mandatoId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.prestazioni.list(user.tenantId, mandatoId);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('prestazioni.gestisci')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('mandatoId') mandatoId: string,
    @Body() dto: CreatePrestazioneDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.prestazioni.create(user.tenantId, mandatoId, user.id, dto);
    return { data };
  }

  @Patch(':prestazioneId')
  @RequirePermissions('prestazioni.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('mandatoId') mandatoId: string,
    @Param('prestazioneId') prestazioneId: string,
    @Body() dto: UpdatePrestazioneDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.prestazioni.update(user.tenantId, mandatoId, prestazioneId, dto);
    return { data };
  }

  @Delete(':prestazioneId')
  @RequirePermissions('prestazioni.gestisci')
  async softDelete(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('mandatoId') mandatoId: string,
    @Param('prestazioneId') prestazioneId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.prestazioni.softDelete(user.tenantId, mandatoId, prestazioneId);
    return { data };
  }
}
