import { test, expect } from '@playwright/test';

/**
 * Logout flow test — verifica che logout pulisca localStorage tokens + redirect login.
 *
 * Anti-pattern evitato (decisione STOP 3 sessione 10):
 * NON usiamo storageState .auth/demo.json. Razionale: logout chiama
 * apiPost('/auth/logout') che invalida server-side il JWT corrente. Se usassimo
 * lo storage state condiviso .auth/demo.json, il JWT verrebbe invalidato
 * lato server → race condition con altri test (es. tenant-isolation.spec.ts)
 * che lo riusano. Workers parallel → fallimenti intermittenti.
 *
 * Fix: login UI inline genera JWT "usa-e-getta" che logout può invalidare
 * senza side effect su altri test. Costa ~1s extra ma test self-contained.
 *
 * Selettori empirici (apps/restaurant-web/src/app/t/[slug]/dashboard/page.tsx):
 * - Logout: <Button variant="outline">Esci</Button> (durante logout "Uscita...")
 * - localStorage keys (apps/restaurant-web/src/lib/auth.ts):
 *   gestionale_access_token + gestionale_refresh_token
 */

test.describe('Logout flow demo tenant', () => {
  test('logout from dashboard clears tokens and redirects to login', async ({ page }) => {
    const email = process.env.E2E_DEMO_EMAIL;
    const password = process.env.E2E_DEMO_PASSWORD;
    if (!email || !password) throw new Error('Missing E2E_DEMO_* env vars');

    // Login UI inline (JWT usa-e-getta, evita race con altri test)
    await page.goto('/t/demo/login');
    // WebKit quirk: vedi auth.setup.ts commento (pressSequentially cross-browser-safe)
    await page.locator('input[type="email"]').click();
    await page.locator('input[type="email"]').pressSequentially(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: /^accedi$/i }).click();
    await page.waitForURL('/t/demo/dashboard', { timeout: 10_000 });
    await expect(page.getByText(/^welcome\s+/i)).toBeVisible({ timeout: 10_000 });

    // Verifica tokens presenti pre-logout
    const tokensPre = await page.evaluate(() => ({
      access: localStorage.getItem('gestionale_access_token'),
      refresh: localStorage.getItem('gestionale_refresh_token'),
    }));
    expect(tokensPre.access).toBeTruthy();
    expect(tokensPre.refresh).toBeTruthy();

    // Click logout (button "Esci")
    await page.getByRole('button', { name: /^esci$/i }).click();

    // Attendi redirect a login (router.replace post clearTokens)
    await page.waitForURL(/\/t\/demo\/login$/, { timeout: 5_000 });

    // Verifica tokens cancellati post-logout
    const tokensPost = await page.evaluate(() => ({
      access: localStorage.getItem('gestionale_access_token'),
      refresh: localStorage.getItem('gestionale_refresh_token'),
    }));
    expect(tokensPost.access).toBeNull();
    expect(tokensPost.refresh).toBeNull();
  });
});
