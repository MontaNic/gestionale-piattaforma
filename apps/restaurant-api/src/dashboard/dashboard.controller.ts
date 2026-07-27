// =============================================================================
// dashboard.controller.ts — GET /dashboard/stats (ADR-0084)
// =============================================================================
// Endpoint tenant-level (NON nested sotto conto/tavolo): aggrega l'intero tenant
// via RLS. Read-only, thin — nessuna logica qui, tutto nel service. Template:
// conti.controller (JwtAuthGuard + TenantConsistencyGuard globali da
// app.module, @RequirePermissions per rotta, envelope `{ data }`). Prefisso
// /api/v1 da main.ts.
//
// RBAC (ADR-0084 D2): `report.operativo.visualizza`, permesso GIÀ ESISTENTE nel
// catalog e già assegnato ai ruoli food che devono vedere la dashboard —
// verificato in DB dev, non solo nei template del seed:
//   Demo Pizzeria → Direzione ✅ · Super Admin ✅ (gli unici ruoli food istanziati)
//   template Cassiere → lo porta (`seed.ts` ROLE_TEMPLATES)
// Era food-orphan (zero consumer in `apps/`): questa rotta è il suo primo
// consumer reale. NESSUN permesso nuovo → nessuna riconciliazione Super Admin,
// nessuna propagazione da fare al deploy. Stesso schema con cui la Cassa PR2 ha
// dato un consumer a `cassa.visualizza` (ADR-0081 D5).
//
// Scelta divergente da ADR-0038 (accountant riusa `anagrafica.cliente.visualizza`,
// "la dashboard è ancorata ai clienti"): qui NON esiste un dominio singolo a cui
// ancorarla — i 4 KPI attraversano conti, comande e pagamenti — e un permesso
// `report.*` operativo con quella esatta semantica esiste già.
// =============================================================================

import { Controller, Get, Inject, UnauthorizedException } from '@nestjs/common';

import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '@gestionale/auth';
import { AuthErrorCode } from '@gestionale/shared';

import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('stats')
  @RequirePermissions('report.operativo.visualizza')
  async stats(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException(AuthErrorCode.SESSION_INVALID);
    const data = await this.dashboard.getStats(user.tenantId);
    return { data };
  }
}
