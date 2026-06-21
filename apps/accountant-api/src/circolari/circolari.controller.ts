// =============================================================================
// circolari.controller.ts — REST /circolari (verticale accountant, ADR-0045)
// =============================================================================
// Solo operatore studio (livello 1). Permessi: circolari.{create,publish,
// archive}. `circolari.read_report` è seedato come forward (report destinatari
// = livello 2, nessun endpoint MVP). Prefisso /api/v1 da main.ts.
//
// La lettura (list/get/patch/delete bozza) richiede `circolari.create`: è il
// permesso "operativo" del verticale; publish/archive sono transizioni a parte.
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
  Query,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { CircolareStato } from '@gestionale/db';
import { AuthErrorCode } from '@gestionale/shared';

import { CircolariService, type CircolariListFilter } from './circolari.service';
import { CreateCircolareDto } from './dto/create-circolare.dto';
import { UpdateCircolareDto } from './dto/update-circolare.dto';

@Controller('circolari')
export class CircolariController {
  constructor(@Inject(CircolariService) private readonly circolari: CircolariService) {}

  @Get()
  @RequirePermissions('circolari.create')
  async list(@CurrentUser() user: AuthenticatedUser | undefined, @Query('stato') stato?: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const filter: CircolariListFilter = {
      stato: isStato(stato) ? stato : undefined,
    };
    const data = await this.circolari.list(user.tenantId, filter);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('circolari.create')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateCircolareDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.circolari.create(user.tenantId, dto);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('circolari.create')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.circolari.getById(user.tenantId, id);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('circolari.create')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateCircolareDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.circolari.update(user.tenantId, id, dto);
    return { data };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('circolari.publish')
  async publish(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.circolari.publish(user.tenantId, id);
    return { data };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('circolari.archive')
  async archive(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.circolari.archive(user.tenantId, id);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('circolari.create')
  async softDelete(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.circolari.softDelete(user.tenantId, id);
    return { data };
  }
}

function isStato(v: string | undefined): v is CircolareStato {
  return (
    v === CircolareStato.bozza || v === CircolareStato.pubblicata || v === CircolareStato.archiviata
  );
}
