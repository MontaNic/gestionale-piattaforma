import { test, expect } from '@playwright/test';

/**
 * Login flow tests — happy path + fail (TD-AJ resolved, sessione 12 PR 2).
 *
 * Usa form UI reale (NON storage state) per coprire flow completo:
 * goto login page → fill form → submit → redirect dashboard (OK) o errore (fail).
 *
 * Anti-pattern evitato: NO setup project dependency qui (questi test NON
 * dipendono da .auth/*.json — testano il flow di login stesso).
 *
 * Rate limit B1: 5 fail/min per tenant. Solo 1 fail test = 1/5 → OK in run veloci.
 *
 * Selettori empirici (apps/web/src/app/t/[slug]/login/page.tsx):
 * - shadcn/ui Input via RHF Controller → textbox role + accessible name
 * - Submit: <Button type="submit">Accedi</Button>
 * - Error: <Alert variant="destructive">. Mapping via lib/error-codes.ts:
 *     `messageForErrorCode(err.errorCode)` → table `ERROR_CODE_MESSAGES`.
 *
 * TD-AJ resolved: backend emette `errorCode: 'E_AUTH_INVALID_CREDENTIALS'` +
 * timestamp esplicito. Frontend rende stringa italian-localized "Email o
 * password non corrette" via mapping table i18n-ready.
 */

test.describe('Login flow demo tenant', () => {
  test('login OK with valid credentials redirects to dashboard', async ({ page }) => {
    const email = process.env.E2E_DEMO_EMAIL;
    const password = process.env.E2E_DEMO_PASSWORD;
    if (!email || !password) throw new Error('Missing E2E_DEMO_* env vars');

    await page.goto('/t/demo/login');
    // WebKit quirk: fill() su input[type="email"] RHF non triggera onChange.
    // pressSequentially è cross-browser-safe (vedi commento auth.setup.ts).
    await page.locator('input[type="email"]').click();
    await page.locator('input[type="email"]').pressSequentially(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: /^accedi$/i }).click();

    await page.waitForURL('/t/demo/dashboard', { timeout: 10_000 });
    await expect(page).toHaveURL('/t/demo/dashboard');
    // Dashboard CardTitle "Welcome <firstName>..." (shadcn renderizza come <div>)
    await expect(page.getByText(/^welcome\s+/i)).toBeVisible({ timeout: 10_000 });
  });

  test('login FAIL with wrong password shows localized error and stays on login page', async ({
    page,
  }) => {
    const email = process.env.E2E_DEMO_EMAIL;
    if (!email) throw new Error('Missing E2E_DEMO_EMAIL env var');

    // TD-AJ regression guard: intercept response /auth/login per verificare
    // shape errorCode + timestamp lato server (defense in depth oltre alla UI).
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/auth/login') && res.status() === 401,
    );

    await page.goto('/t/demo/login');
    // WebKit quirk: fill() su input[type="email"] RHF non triggera onChange.
    // pressSequentially è cross-browser-safe (vedi commento auth.setup.ts).
    await page.locator('input[type="email"]').click();
    await page.locator('input[type="email"]').pressSequentially(email);
    await page.locator('input[type="password"]').fill('WRONG-PASSWORD-xyz-stop3-test');
    await page.getByRole('button', { name: /^accedi$/i }).click();

    // Assert backend response shape (TD-AJ)
    const response = await responsePromise;
    const body = await response.json();
    expect(body.errorCode).toBe('E_AUTH_INVALID_CREDENTIALS');
    expect(body.message).toBe('Credenziali non valide');
    expect(body.statusCode).toBe(401);
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Assert UI: stringa italian-localized (via lib/error-codes.ts mapping)
    const alert = page.getByRole('alert').filter({ hasText: /Email o password non corrette/i });
    await expect(alert).toBeVisible({ timeout: 5_000 });
    // No redirect: ancora su /t/demo/login
    expect(page.url()).toContain('/t/demo/login');
  });
});
