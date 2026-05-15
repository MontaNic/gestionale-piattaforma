import { test, expect } from '@playwright/test';

/**
 * Routing tests — middleware TD-2 path-based (apps/web/src/middleware.ts).
 *
 * Test idempotenti (no DB mutation), no storage state richiesto.
 *
 * Comportamento empirico (Fase 3.1 STOP 3):
 * - Root `/` → middleware redirect a `/t/demo/login` (default tenant dev)
 * - Slug invalido → middleware redirect a `/not-found` (rewrite ⇒ status 200 + UI 404).
 *   NB: NON è 404 nativo Next.js (notFound()), ma redirect a page client-side.
 */

test.describe('Routing middleware TD-2', () => {
  test('root path / redirects to default tenant login', async ({ page }) => {
    const response = await page.goto('/');
    // Redirect chain seguita da Playwright: URL finale = login
    await expect(page).toHaveURL(/\/t\/[^/]+\/login$/);
    // Final response OK (login page rendered)
    expect(response?.ok()).toBe(true);
    // Verifica default tenant = demo (middleware.ts line 46)
    expect(page.url()).toContain('/t/demo/login');
  });

  test('malformed slug /t/INVALID-uppercase/login redirects to not-found page', async ({
    page,
  }) => {
    // Empirical Fase 3.1: middleware.ts:50-58 valida SOLO il FORMATO dello slug
    // (regex `^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$` + RESERVED_SLUGS), NON
    // l'esistenza nel DB. Slug `inesistente-tenant-xyz` matcha regex → middleware
    // passa, e la 401 arriverebbe solo su API call backend (scope diverso).
    //
    // Per testare il REDIRECT middleware frontend, serve slug malformato:
    // uppercase, underscore, leading/trailing hyphen, o reserved (api, admin, ...).
    // Usiamo uppercase per chiarezza visiva.
    await page.goto('/t/INVALID-uppercase/login');

    await expect(page).toHaveURL(/\/not-found$/);
    // not-found.tsx:14 renderizza <h1>404 — Pagina non trovata</h1>
    await expect(page.getByRole('heading', { name: /404.*pagina non trovata/i })).toBeVisible();
  });
});
