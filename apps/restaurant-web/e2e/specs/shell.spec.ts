import path from 'node:path';

import { test, expect } from '@playwright/test';

/**
 * shell.spec.ts — Smoke F1-shell UI foundation (ADR-0018 DP-5)
 *
 * 3 test happy-path:
 *   1. Shell render post-login: sidebar + topbar + welcome dashboard visibili
 *   2. Logout via topbar user menu: clear localStorage + redirect /login
 *   3. Anonymous access route autenticata → redirect /login (AuthGate)
 *
 * Pattern storageState:
 *   - Riusa `e2e/.auth/demo.json` generato da `auth.setup.ts` (NO duplicate login)
 *   - Path resolution coerente con `tenant-isolation.spec.ts`
 *
 * Pattern unauth:
 *   - `storageState: { cookies: [], origins: [] }` per blank context (coerente
 *     con `auth-redirect.spec.ts`)
 */

const DEMO_STORAGE = path.join(import.meta.dirname, '..', '.auth', 'demo.json');

test.describe('F1 shell render authenticated', () => {
  test.use({ storageState: DEMO_STORAGE });

  test('shell renders post-login with sidebar + topbar', async ({ page }) => {
    await page.goto('/t/demo/dashboard');

    // Attendere fine AuthGate loading (fetch /me terminato → DashboardContent renderizzata)
    await expect(page.getByText(/^welcome\s+/i)).toBeVisible({ timeout: 10_000 });

    // Sidebar visibile (desktop default — viewport Playwright >= md breakpoint)
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

    // Topbar visibile con trigger user menu
    await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
    await expect(page.locator('[data-testid="user-menu-trigger"]')).toBeVisible();
  });
});

test.describe('F1 shell logout via topbar', () => {
  test.use({ storageState: DEMO_STORAGE });

  test('logout via topbar user menu clears tokens and redirects to login', async ({ page }) => {
    await page.goto('/t/demo/dashboard');

    // Attendere shell pronta (welcome visibile = AuthGate loaded)
    await expect(page.getByText(/^welcome\s+/i)).toBeVisible({ timeout: 10_000 });

    // Pre-condition: token in localStorage post-storageState restore
    const tokenPre = await page.evaluate(() =>
      window.localStorage.getItem('gestionale_access_token'),
    );
    expect(tokenPre).toBeTruthy();

    // Apri user menu + click logout
    await page.locator('[data-testid="user-menu-trigger"]').click();
    await page.locator('[data-testid="logout-button"]').click();

    // Attendere redirect a login
    await page.waitForURL(/\/t\/demo\/login$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/t\/demo\/login$/);

    // Token rimossi (pattern TD-6 performLogout finally clearTokens)
    const tokenPost = await page.evaluate(() => ({
      access: window.localStorage.getItem('gestionale_access_token'),
      refresh: window.localStorage.getItem('gestionale_refresh_token'),
    }));
    expect(tokenPost.access).toBeNull();
    expect(tokenPost.refresh).toBeNull();
  });
});

test.describe('F1 shell anonymous redirect', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('anonymous user redirected to login from authenticated route', async ({ page }) => {
    await page.goto('/t/demo/dashboard');
    await expect(page).toHaveURL(/\/t\/demo\/login(\?.*)?$/, { timeout: 10_000 });
  });
});
