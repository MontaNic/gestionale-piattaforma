// =============================================================================
// public.decorator.ts — Marker per endpoint che bypassano JwtAuthGuard globale
// =============================================================================
// Pattern security-by-default: JwtAuthGuard registrato APP_GUARD globale.
// Endpoint che devono restare pubblici (login, refresh, healthcheck, root)
// dichiarano @Public() e il guard li lascia passare via Reflector lookup.
// =============================================================================

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
