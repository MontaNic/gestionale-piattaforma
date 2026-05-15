import { test, expect } from '@playwright/test';

/**
 * Login flow tests — happy path + fail.
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
 * - Error: <Alert variant="destructive">. Mapping page.tsx:55:
 *     errorCode === 'E_AUTH_INVALID_CREDENTIALS' → "Email o password non corrette"
 *     else → "Errore: ${err.message}"
 *   Empirical Fase 3.1: backend NestJS UnauthorizedException risponde
 *     { message: 'E_AUTH_INVALID_CREDENTIALS', error: 'Unauthorized', statusCode: 401 }
 *   senza campo `errorCode` → parseError fallback errorCode='E_UNKNOWN' → UI
 *   mostra "Errore: E_AUTH_INVALID_CREDENTIALS" (NOT la stringa italian-localized).
 *   Test documenta comportamento ATTUALE. Fix futuro: backend deve emettere
 *   errorCode esplicito (TD candidate).
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

  test('login FAIL with wrong password shows error and stays on login page', async ({ page }) => {
    const email = process.env.E2E_DEMO_EMAIL;
    if (!email) throw new Error('Missing E2E_DEMO_EMAIL env var');

    await page.goto('/t/demo/login');
    // WebKit quirk: fill() su input[type="email"] RHF non triggera onChange.
    // pressSequentially è cross-browser-safe (vedi commento auth.setup.ts).
    await page.locator('input[type="email"]').click();
    await page.locator('input[type="email"]').pressSequentially(email);
    await page.locator('input[type="password"]').fill('WRONG-PASSWORD-xyz-stop3-test');
    await page.getByRole('button', { name: /^accedi$/i }).click();

    // Empirical: backend non manda errorCode → frontend fallback
    // "Errore: E_AUTH_INVALID_CREDENTIALS" via Alert role.
    const alert = page.getByRole('alert').filter({ hasText: /E_AUTH_INVALID_CREDENTIALS/i });
    await expect(alert).toBeVisible({ timeout: 5_000 });
    // No redirect: ancora su /t/demo/login
    expect(page.url()).toContain('/t/demo/login');
  });
});
