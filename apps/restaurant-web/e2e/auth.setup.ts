import { test as setup, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

/**
 * Auth setup — genera storage state per ogni tenant.
 *
 * Pattern (Playwright official docs 2025-2026):
 * - 1 test per tenant esegue login flow reale via UI
 * - Cattura storage state (localStorage tokens TD-2) in file JSON
 * - File riusato in test "authenticated" via use.storageState
 * - Path: apps/restaurant-web/e2e/.auth/<slug>.json (gitignored)
 *
 * Credenziali: lette da .env.e2e (NON hardcoded) — vedi STOP 2 Fase 2.4
 * Tokens: localStorage keys `gestionale_access_token` + `gestionale_refresh_token`
 * (vedi apps/restaurant-web/src/lib/auth.ts).
 *
 * Anti-pattern evitati:
 * - NO login HTTP diretto API (vogliamo testare anche flow UI middleware TD-2)
 * - NO mock auth (storage state REALE post-login UI)
 */

const AUTH_DIR = path.join(import.meta.dirname, '.auth');

interface TenantCreds {
  slug: string;
  email: string;
  password: string;
}

function getTenantCreds(slug: string): TenantCreds {
  const SLUG = slug.toUpperCase();
  const email = process.env[`E2E_${SLUG}_EMAIL`];
  const password = process.env[`E2E_${SLUG}_PASSWORD`];

  if (!email || !password) {
    throw new Error(
      `Missing credentials for tenant "${slug}". ` +
        `Set E2E_${SLUG}_EMAIL and E2E_${SLUG}_PASSWORD in apps/restaurant-web/.env.e2e`,
    );
  }

  return { slug, email, password };
}

async function loginAndPersistStorage(page: Page, creds: TenantCreds): Promise<void> {
  const storageFile = path.join(AUTH_DIR, `${creds.slug}.json`);

  // Naviga a login page (middleware TD-2 valida slug)
  await page.goto(`/t/${creds.slug}/login`);

  // Verifica form login presente. NB: shadcn/ui CardTitle renderizza come <div>,
  // NON heading — getByRole('heading') non matcha. Usiamo getByText + textbox.
  await expect(page.getByText(/accedi a gestionale/i)).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();

  // Empirical Fase 3.9 STOP 3 (WebKit-specific):
  // fill() su input[type="email"] controlled RHF non triggera onChange su WebKit
  // (placeholder resta, validation "Email non valida" appare). Probabile race tra
  // sync synthetic event Playwright e React state RHF. pressSequentially emette
  // un keydown/keyup per char, allineato a interazione utente reale → robusto
  // cross-browser. Costo: ~20ms extra (15 chars × 1ms). Applichiamo solo a email;
  // password.fill() funziona su tutti i browser (no apparent type-related quirk).
  await page.locator('input[type="email"]').click();
  await page.locator('input[type="email"]').pressSequentially(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await page.getByRole('button', { name: /^accedi$/i }).click();

  // Attendi redirect a dashboard (router.push post-login OK in page.tsx)
  await page.waitForURL(`/t/${creds.slug}/dashboard`, { timeout: 10_000 });
  await expect(page).toHaveURL(`/t/${creds.slug}/dashboard`);

  // Attendi che la dashboard finisca il caricamento (apiGet /me terminato).
  // Loading state mostra "Caricamento...", post-load CardTitle "Welcome <firstName>".
  await expect(page.getByText(/^welcome\s+/i)).toBeVisible({ timeout: 10_000 });

  // Salva storage state (include localStorage tokens TD-2)
  await page.context().storageState({ path: storageFile });
}

setup('authenticate as demo admin', async ({ page }) => {
  const creds = getTenantCreds('demo');
  await loginAndPersistStorage(page, creds);
});

setup('authenticate as acme admin', async ({ page }) => {
  const creds = getTenantCreds('acme');
  await loginAndPersistStorage(page, creds);
});
