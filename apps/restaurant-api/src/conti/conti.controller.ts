// =============================================================================
// conti.controller.ts — REST /conti (operatività COMANDE, PR-2 ADR-0068)
// =============================================================================
// Template tables.controller: JwtAuthGuard + TenantConsistencyGuard globali
// (app.module APP_GUARD), @RequirePermissions per rotta, envelope { data }.
//
// RBAC mapping (scope-lock D4):
//   - GET (list/getById)            → comande.visualizza
//   - POST /conti                   → comande.crea      (apri conto)
//   - POST /conti/:id/righe         → comande.modifica  (aggiungi riga)
//   - PATCH /conti/:id/righe/:rId   → comande.modifica  (modifica riga)
//   - DELETE /conti/:id/righe/:rId  → comande.elimina   (storno riga)
//   - POST /conti/:id/chiudi        → comande.modifica  (chiudi conto)
//   - POST /conti/:id/annulla       → comande.modifica  (annulla conto)
// `comande.stato.cambia` = orfano intenzionale (trigger = blocco KDS, ADR-0068).
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
import { AuthErrorCode } from '@gestionale/shared';

import { ContiService } from './conti.service';
import { CreateContoDto } from './dto/create-conto.dto';
import { AddRigaDto } from './dto/add-riga.dto';
import { UpdateRigaDto } from './dto/update-riga.dto';
import { ListContiQueryDto } from './dto/list-conti.query.dto';

@Controller('conti')
export class ContiController {
  constructor(@Inject(ContiService) private readonly conti: ContiService) {}

  @Get()
  @RequirePermissions('comande.visualizza')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query() query: ListContiQueryDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.list(user.tenantId, {
      stato: query.stato,
      tavoloId: query.tavoloId,
    });
    return { data };
  }

  @Get(':id')
  @RequirePermissions('comande.visualizza')
  async getById(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.getById(user.tenantId, id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('comande.crea')
  async create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateContoDto) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.create(user.tenantId, user.id, dto);
    return { data };
  }

  @Post(':id/righe')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('comande.modifica')
  async addRiga(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
    @Body() dto: AddRigaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.addRiga(user.tenantId, user.id, contoId, dto);
    return { data };
  }

  @Patch(':id/righe/:rigaId')
  @RequirePermissions('comande.modifica')
  async updateRiga(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
    @Param('rigaId') rigaId: string,
    @Body() dto: UpdateRigaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.updateRiga(user.tenantId, user.id, contoId, rigaId, dto);
    return { data };
  }

  @Delete(':id/righe/:rigaId')
  @RequirePermissions('comande.elimina')
  async stornaRiga(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') contoId: string,
    @Param('rigaId') rigaId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.stornaRiga(user.tenantId, user.id, contoId, rigaId);
    return { data };
  }

  @Post(':id/chiudi')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('comande.modifica')
  async chiudi(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') contoId: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.chiudi(user.tenantId, user.id, contoId);
    return { data };
  }

  @Post(':id/annulla')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('comande.modifica')
  async annulla(@CurrentUser() user: AuthenticatedUser | undefined, @Param('id') contoId: string) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.conti.annulla(user.tenantId, user.id, contoId);
    return { data };
  }
}
