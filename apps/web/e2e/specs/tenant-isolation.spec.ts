import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * Cross-tenant isolation test — demo user logged tenta accesso /t/acme/dashboard.
 *
 * Comportamento empirico documentato (Fase 3.1 STOP 3) — STRATEGIA (a):
 * UI inconsistency. Root cause:
 * - Backend `apps/api/src/tenant/tenant.middleware.ts:43` SKIPPA tenantId-resolution
 *   se `req.user` presente (JWT post-auth). Nessun cross-check JWT.tenantId vs
 *   X-Tenant-Slug header.
 * - Backend `apps/api/src/me/me.controller.ts` usa SOLO user.id da JWT
 *   (decorator @CurrentUser), NON legge slug URL.
 * - Frontend `apps/web/src/app/t/[slug]/dashboard/page.tsx`: apiGet('/me')
 *   passa solo accessToken, NON tenantSlug. Quindi /me ritorna profilo
 *   relativo al JWT subject (demo user) indipendente da URL slug.
 *
 * Risultato: demo loggato che naviga /t/acme/dashboard vede:
 *   - URL: /t/acme/dashboard (middleware TD-2 OK perché "acme" è slug valido)
 *   - Contenuto dashboard: dati DEMO user (firstName/lastName demo)
 *
 * Questo è il gap TD-7 ADR-0012 "Cross-tenant token UX edge".
 * Il test documenta il comportamento ATTUALE, NON forza fix ideale.
 *
 * Fix ideale (TD-7 ADR-0012, 2 candidates):
 * - (1) Backend Guard cross-check JWT.tenantId vs X-Tenant-Slug header (frontend manda slug ANCHE post-auth)
 * - (2) Frontend useEffect verifica /me.tenantSlug vs useParams.slug, redirect a /t/<jwt-slug>/dashboard
 */

test.use({ storageState: path.join(import.meta.dirname, '..', '.auth', 'demo.json') });

// =============================================================================
// TODO TD-BI (PR #35 follow-up post-merge) — stale test rivelato da F1-shell.
// =============================================================================
// Status: SKIP da PR #34 (chore/td-ay-td-be-sub2-cleanup).
//
// Root cause empirico (verificato sessione 15 STOP 3.7 via error-context.md
// YAML snapshot + test-failed-1.png):
// - Spec scritto pre-F1-shell (sessione TD-4) per documentare TD-7 ADR-0012
//   gap "Cross-tenant token UX edge" — assumeva render dashboard con dati demo
//   leak su URL slug acme (vecchio comportamento gap UI puro).
// - Sessione 14 F1-shell refactor introduce AuthGate client guard +
//   AuthContext fetch /me con loading state, dashboard sotto (authenticated)/
//   route group. storageState demo.json NON valido per slug acme post-F1-shell:
//   AuthGate redirect implicito a /t/acme/login (form Accedi renderizzato al
//   timeout, NON dashboard).
// - Locator `getByText(/^welcome\s+/i)` non match perché pagina è login form,
//   non welcome card dashboard.
//
// Semantica TD-7 cambiata da F1-shell: gap UI parzialmente chiuso (NO più
// demo data leak visibile cross-tenant), backend invariato (no JWT.tenantId
// vs X-Tenant-Slug cross-check — AuthContext.loadProfile non passa slug).
// Lo spec NON e' regressione PR #34 (TD-AY/TD-BE Sub-2), e' stale test
// pre-esistente sessione 14 (PR #32 F1-shell) non catturato da CI prima.
//
// Fix candidate PR #35 (TD-BI):
// (a) Riformulare spec per nuova semantica F1-shell: verify redirect implicito
//     a /t/acme/login quando storageState demo accede slug acme (regression
//     guard del fix UI parziale F1-shell ha introdotto).
// (b) Se vogliamo testare backend gap TD-7 residuo (no JWT cross-check), serve
//     fixture API direct (no UI) o promuovere TD-7 fix Guard backend cross-check
//     (priority bump roadmap, sblocca regression guard funzionale).
// =============================================================================
test.describe('Cross-tenant isolation (demo user → acme tenant URL)', () => {
  test.skip('demo logged user navigating /t/acme/dashboard sees DEMO data (TD-7 ADR-0012 gap)', async ({
    page,
  }) => {
    await page.goto('/t/acme/dashboard');

    // URL mantenuto a /t/acme/dashboard (no redirect server-side né client-side)
    await expect(page).toHaveURL('/t/acme/dashboard');

    // Dashboard caricata MA con dati demo (apiGet /me ignora slug URL)
    // Card "Welcome ..." mostrata = profilo JWT (demo user)
    await expect(page.getByText(/^welcome\s+/i)).toBeVisible({ timeout: 10_000 });

    // Verifica email mostrata = demo (CardDescription contiene profile.user.email).
    // page.tsx:95: <CardDescription>{profile.user.email}</CardDescription>
    // Se backend rispettasse slug, dovremmo vedere acme; empirico = demo.
    const demoEmail = process.env.E2E_DEMO_EMAIL;
    if (!demoEmail) throw new Error('Missing E2E_DEMO_EMAIL env var');
    await expect(page.getByText(demoEmail)).toBeVisible({ timeout: 5_000 });

    // Verifica esplicita NO redirect a /t/acme/login (no enforcement attuale)
    expect(page.url()).toContain('/t/acme/dashboard');
  });
});
