// =============================================================================
// accept-invite.controller.ts — accettazione invito (registrazione cliente)
// =============================================================================
// @Public + pre-auth: il tenant arriva da X-Tenant-Slug (TenantMiddleware
// registrato su 'auth/accept-invite' in app.module). Ritorna AuthTokensPayload
// (login pulito del nuovo cliente) → il FE redirige al portale autenticato.
// =============================================================================

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { Public, type AuthenticatedRequest } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { InvitiService } from './inviti.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';

@Controller('auth')
export class AcceptInviteController {
  constructor(@Inject(InvitiService) private readonly inviti: InvitiService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('accept-invite')
  async acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: AuthenticatedRequest) {
    // tenantId risolto da TenantMiddleware (X-Tenant-Slug) → req.tenantId.
    const tenantId = req.tenantId;
    if (!tenantId) {
      // Allineato al pattern auth: senza tenant non si può risolvere l'invito.
      throw new UnauthorizedException(AuthErrorCode.TENANT_REQUIRED);
    }
    const data = await this.inviti.accettaInvito(tenantId, dto, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return { data };
  }
}
