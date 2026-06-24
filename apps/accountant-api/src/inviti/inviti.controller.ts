// =============================================================================
// inviti.controller.ts — gestione inviti cliente lato operatore
// =============================================================================
// Tutte le rotte gated @RequirePermissions('clienti.invitare') (Super Admin /
// Admin sede / Socio). Nested sotto /aziende/:aziendaId/inviti. JwtAuthGuard +
// TenantConsistencyGuard + PermissionsGuard globali (app.module). Prefisso
// globale /api/v1 da main.ts.
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
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { InvitiService } from './inviti.service';
import { CreateInvitoDto } from './dto/create-invito.dto';

@Controller('aziende/:aziendaId/inviti')
export class InvitiController {
  constructor(@Inject(InvitiService) private readonly inviti: InvitiService) {}

  @Get()
  @RequirePermissions('clienti.invitare')
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.inviti.listInviti(user.tenantId, aziendaId);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('clienti.invitare')
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Body() dto: CreateInvitoDto,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.inviti.creaInvito(
      user.tenantId,
      aziendaId,
      { id: user.id, firstName: user.firstName, lastName: user.lastName },
      dto,
    );
    return { data };
  }

  @Delete(':invitoId')
  @RequirePermissions('clienti.invitare')
  async revoca(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('aziendaId') aziendaId: string,
    @Param('invitoId') invitoId: string,
  ) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.inviti.revocaInvito(user.tenantId, aziendaId, invitoId);
    return { data };
  }
}
