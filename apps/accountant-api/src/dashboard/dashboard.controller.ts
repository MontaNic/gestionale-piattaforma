// =============================================================================
// dashboard.controller.ts — GET /dashboard/stats (STOP-dash1 ADR-0038)
// =============================================================================
// Endpoint tenant-level (NON nested sotto azienda): aggrega l'intero tenant via
// RLS. Read-only, thin. Permesso riusato `anagrafica.cliente.visualizza`
// (DP-permessi: niente nuovo permesso dashboard.*; la dashboard è ancorata ai
// clienti). Pattern controller da aziende.controller. Prefisso /api/v1 da main.ts.
// =============================================================================

import { Controller, Get, Inject, UnauthorizedException } from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('stats')
  @RequirePermissions('anagrafica.cliente.visualizza')
  async stats(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.dashboard.getStats(user.tenantId);
    return { data };
  }
}
