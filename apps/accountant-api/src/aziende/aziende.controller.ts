// =============================================================================
// aziende.controller.ts — REST /aziende (verticale accountant, STOP-c1)
// =============================================================================
// Pattern replicato da menus.controller.ts. Protection: JwtAuthGuard globale +
// @RequirePermissions (catalogo anagrafica.cliente.*). TenantConsistencyGuard
// cattura cross-tenant by default. Prefisso globale /api/v1 da main.ts.
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
import { AziendeService } from './aziende.service';
import { CreateAziendaDto } from './dto/create-azienda.dto';
import { UpdateAziendaDto } from './dto/update-azienda.dto';

@Controller('aziende')
export class AziendeController {
  constructor(@Inject(AziendeService) private readonly aziende: AziendeService) {}

  @Get()
  @RequirePermissions('anagrafica.cliente.visualizza')
  async list(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.aziende.list(user.tenantId);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('anagrafica.cliente.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.aziende.getById(user.tenantId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('anagrafica.cliente.crea')
  async create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateAziendaDto) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.aziende.create(user.tenantId, dto);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('anagrafica.cliente.modifica')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAziendaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.aziende.update(user.tenantId, id, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('anagrafica.cliente.elimina')
  async softDelete(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.aziende.softDelete(user.tenantId, id);
    return { data };
  }
}
