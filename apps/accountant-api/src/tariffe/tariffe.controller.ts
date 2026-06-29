// =============================================================================
// tariffe.controller.ts — REST tariffario orario (ADR-0055, Onda 4 Task 3b)
// =============================================================================
// CRUD sotto /tariffe. Permessi tariffario.{visualizza,gestisci} (dati di costo
// sensibili → riservati a Direzione/Socio, vedi seed). tenantId dal JWT
// (@CurrentUser). Risposta { data }. Prefisso /api/v1.
// =============================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { TariffeService } from './tariffe.service';
import { CreateTariffaDto } from './dto/create-tariffa.dto';
import { UpdateTariffaDto } from './dto/update-tariffa.dto';

@Controller('tariffe')
export class TariffeController {
  constructor(@Inject(TariffeService) private readonly tariffe: TariffeService) {}

  @Get()
  @RequirePermissions('tariffario.visualizza')
  async list(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tariffe.list(user.tenantId);
    return { data };
  }

  @Post()
  @RequirePermissions('tariffario.gestisci')
  async create(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreateTariffaDto) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tariffe.create(user.tenantId, dto);
    return { data };
  }

  // Lookup per i picker del form. Dichiarati PRIMA di :id per non collidere
  // (altrimenti /tariffe/roles matcherebbe :id='roles').
  @Get('roles')
  @RequirePermissions('tariffario.gestisci')
  async listRoles(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tariffe.listRoles(user.tenantId);
    return { data };
  }

  @Get('users')
  @RequirePermissions('tariffario.gestisci')
  async listUsers(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tariffe.listUsers(user.tenantId);
    return { data };
  }

  @Get(':id')
  @RequirePermissions('tariffario.visualizza')
  async findOne(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') tariffaId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tariffe.findOne(user.tenantId, tariffaId);
    return { data };
  }

  @Patch(':id')
  @RequirePermissions('tariffario.gestisci')
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') tariffaId: string,
    @Body() dto: UpdateTariffaDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tariffe.update(user.tenantId, tariffaId, dto);
    return { data };
  }

  @Delete(':id')
  @RequirePermissions('tariffario.gestisci')
  async softDelete(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') tariffaId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.tariffe.softDelete(user.tenantId, tariffaId);
    return { data };
  }
}
