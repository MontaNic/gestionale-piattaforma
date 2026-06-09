// =============================================================================
// referenti.controller.ts — REST /aziende/:aziendaId/referenti (STOP-c3a)
// =============================================================================
// Pattern nested replicato da menu-categories.controller.ts (S17). Permessi
// riusati dal catalogo anagrafica.cliente.* (un referente è attributo del
// cliente). Prefisso globale /api/v1 da main.ts.
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
import { CreateReferenteDto } from './dto/create-referente.dto';
import { ReferentiService } from './referenti.service';
import { UpdateReferenteDto } from './dto/update-referente.dto';

@Controller('aziende/:aziendaId/referenti')
export class ReferentiController {
  constructor(@Inject(ReferentiService) private readonly referenti: ReferentiService) {}

  @Get()
  @RequirePermissions('anagrafica.cliente.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.referenti.list(user.tenantId, aziendaId);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('anagrafica.cliente.visualizza')
  async getById(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Param('id') id: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.referenti.getById(user.tenantId, aziendaId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('anagrafica.cliente.crea')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Body() dto: CreateReferenteDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.referenti.create(user.tenantId, aziendaId, dto);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('anagrafica.cliente.modifica')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReferenteDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.referenti.update(user.tenantId, aziendaId, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('anagrafica.cliente.elimina')
  async softDelete(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Param('id') id: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.referenti.softDelete(user.tenantId, aziendaId, id);
    return { data };
  }
}
