// =============================================================================
// preventivi.controller.ts — REST /aziende/:aziendaId/preventivi (STOP-e1)
// =============================================================================
// Pattern nested replicato da referenti.controller. Permessi dedicati
// preventivi.{visualizza,gestisci} (catalogo 33→35). Prefisso /api/v1 da main.ts.
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
import { CreatePreventivoDto } from './dto/create-preventivo.dto';
import { PreventiviService } from './preventivi.service';
import { UpdatePreventivoDto } from './dto/update-preventivo.dto';

@Controller('aziende/:aziendaId/preventivi')
export class PreventiviController {
  constructor(@Inject(PreventiviService) private readonly preventivi: PreventiviService) {}

  @Get()
  @RequirePermissions('preventivi.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.preventivi.list(user.tenantId, aziendaId);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('preventivi.visualizza')
  async getById(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Param('id') id: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.preventivi.getById(user.tenantId, aziendaId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('preventivi.gestisci')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Body() dto: CreatePreventivoDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.preventivi.create(user.tenantId, aziendaId, dto);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('preventivi.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePreventivoDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.preventivi.update(user.tenantId, aziendaId, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('preventivi.gestisci')
  async softDelete(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Param('id') id: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.preventivi.softDelete(user.tenantId, aziendaId, id);
    return { data };
  }
}
