// =============================================================================
// public.controller.ts — Endpoint pubblici tenant-facing (ADR-0049)
// =============================================================================
// GET /public/tenants/:slug — identità pubblica dello studio per la landing
// /t/<slug> (FE). @Public() opt-out del JwtAuthGuard globale (ADR-0008): senza
// di esso l'endpoint risponderebbe 401. TenantConsistencyGuard salta su @Public.
// Il throttler `default` (AppThrottlerGuard globale) si applica comunque →
// rate-limit anti-abuso su superficie non autenticata. Tenant resolution via
// URL param (no header X-Tenant-Slug → niente TenantMiddleware).
//
// Wrapping `{ data }` manuale, coerente con gli altri controller del verticale.
// =============================================================================

import { Controller, Get, Inject, Param } from '@nestjs/common';

import { Public } from '@gestionale/auth';

import { PublicService } from './public.service';
import type { PublicTenantView } from './public-tenant.dto';

@Controller('public/tenants')
export class PublicController {
  constructor(@Inject(PublicService) private readonly publicService: PublicService) {}

  @Public()
  @Get(':slug')
  async getTenant(@Param('slug') slug: string): Promise<{ data: PublicTenantView }> {
    const data = await this.publicService.getTenantBySlug(slug);
    return { data };
  }
}
