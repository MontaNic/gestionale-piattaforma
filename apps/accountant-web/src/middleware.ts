import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { applyLocaleGuard } from '@gestionale/i18n/middleware';

// =============================================================================
// middleware.ts — Multi-tenant slug routing path-based (TD-2 ADR-0012)
//                  + cookie locale validation (ADR-0018 Sub-DP-A)
// =============================================================================
// Pattern: `/t/<slug>/<page>` (es. `/t/studio-demo/login`, `/t/acme/dashboard`).
//
// - Root `/` → redirect a `/t/studio-demo/login` (default tenant dev)
// - Path `/t/<slug>/...` con slug invalido o reserved → redirect a `/not-found`
// - Altri path (es. `/api`, `/_next/*`) → pass-through
//
// Slug validation: regex + RESERVED_SLUGS coerente con backend FORBIDDEN_SLUGS
// (ADR-0010 D4). Backend `X-Tenant-Slug` header API contract INVARIATO — il
// frontend client legge slug da `useParams()` (App Router) e lo passa nelle
// API call.
//
// Locale (ADR-0018): `applyLocaleGuard` (meccanismo `@gestionale/i18n`, ADR-0027
// §D5 passo 4) resetta il cookie `NEXT_LOCALE` se invalido (defense-in-depth).
// Locale resolution effettiva avviene server-side in `src/i18n/request.ts`.
// =============================================================================

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set([
  'api',
  'www',
  'admin',
  'system',
  'app',
  'public',
  'static',
  'health',
  'auth',
  'me',
  'tenants',
  '_next',
  'favicon.ico',
]);

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Skip static + API routes interni
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  // Root → default tenant dev
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/t/studio-demo/login', req.url));
  }

  // Match `/t/<slug>/<rest>` (rest opzionale)
  const tenantMatch = /^\/t\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (!tenantMatch) {
    // Pattern non match (es. /not-found, /static) → pass-through, Next.js 404 standard
    return applyLocaleGuard(req, NextResponse.next());
  }

  const slug = tenantMatch[1];
  if (!slug || RESERVED_SLUGS.has(slug) || !SLUG_REGEX.test(slug)) {
    return NextResponse.redirect(new URL('/not-found', req.url));
  }

  // Slug valido: propaga via header per Server Components eventuali (App Router
  // RSC possono leggere `headers()` di next/headers). Client Components usano
  // useParams() — header e' optional defense-in-depth.
  const response = NextResponse.next();
  response.headers.set('x-tenant-slug-internal', slug);
  return applyLocaleGuard(req, response);
}

export const config = {
  // Match tutti i path eccetto Next.js static/image + favicon + API routes.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
