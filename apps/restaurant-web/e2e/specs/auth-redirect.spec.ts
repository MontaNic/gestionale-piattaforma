import { test, expect } from '@playwright/test';

/**
 * Auth redirect test — utente anonimo non può accedere dashboard.
 *
 * Override default storage state (setup project genera .auth/demo.json riusato
 * di default in chromium project) con stato anonimo via test.use.
 *
 * Comportamento empirico (apps/restaurant-web/src/app/t/[slug]/dashboard/page.tsx:26-31):
 * - Client Component, useEffect dopo mount
 * - getAccessToken() null → router.replace(loginUrl)
 * - Quindi: brief render iniziale, poi redirect JS-driven (~ms)
 *
 * Test: waitForURL con timeout congruo (5s tollera lentezza CI).
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Auth redirect anonymous user', () => {
  test('anonymous access /t/demo/dashboard redirects to login', async ({ page }) => {
    await page.goto('/t/demo/dashboard');

    // Redirect client-side via router.replace (page.tsx:29)
    await page.waitForURL(/\/t\/demo\/login$/, { timeout: 5_000 });
    await expect(page).toHaveURL(/\/t\/demo\/login$/);

    // Verifica form login presente (no UI leak dashboard a non-auth).
    // Titolo = wordmark brand (ADR-0061): role="img", name = titolo i18n.
    await expect(page.getByRole('img', { name: /accedi a fooddesk/i })).toBeVisible();
  });
});
