// =============================================================================
// report.controller.ts — GET /report/margine (ADR-0054, Onda 3 Task 4)
// =============================================================================
// Vista analitica read-only, tenant-level. Riuso permesso `report.operativo.
// visualizza` (niente nuovo permesso per una vista che aggrega dati già
// accessibili). Pattern dashboard.controller. Prefisso /api/v1 da main.ts.
// =============================================================================

import { Controller, Get, Inject, UnauthorizedException } from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { ReportService } from './report.service';

@Controller('report')
export class ReportController {
  constructor(@Inject(ReportService) private readonly report: ReportService) {}

  @Get('margine')
  @RequirePermissions('report.operativo.visualizza')
  async margine(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.report.margine(user.tenantId);
    return { data };
  }
}
