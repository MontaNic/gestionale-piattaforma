import { test as setup, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

/**
 * Auth setup accountant — genera uno storageState per PROFILO-RUOLO.
 *
 * Differenza dal pattern restaurant (1 storageState per tenant): qui i tre
 * ruoli coperti vivono nello STESSO tenant `studio-demo` ma con utenti diversi,
 * quindi le chiavi credenziali sono per-ruolo (non per-tenant).
 *
 * Pattern (Playwright official docs):
 * - 1 test per profilo esegue login flow reale via UI
 * - Cattura storageState (localStorage tokens TD-2) in .auth/<profile>.json
 * - File riusato dal page-tour via use.storageState (STOP 2)
 *
 * Tokens: localStorage `gestionale_access_token` + `gestionale_refresh_token`
 * (packages/auth-web/src/auth.ts). Lo storageState cattura localStorage.
 *
 * Credenziali: lette da .env.e2e (gitignored), MAI hardcoded.
 * Surface post-login (ADR-0046 §4): operatore → /dashboard, cliente → /portale.
 */

const AUTH_DIR = path.join(import.meta.dirname, '.auth');

type Surface = 'operatore' | 'cliente';

interface RoleProfile {
  /** Nome logico del profilo = nome del file storageState. */
  profile: string;
  /** Tenant slug per l'URL di login `/t/<slug>/login`. */
  slug: string;
  /** Superficie attesa post-login (determina la destinazione del redirect). */
  surface: Surface;
  /** Prefisso delle env var credenziali: E2E_<KEY>_EMAIL / E2E_<KEY>_PASSWORD. */
  envKey: string;
}

const PROFILES: readonly RoleProfile[] = [
  { profile: 'superadmin', slug: 'studio-demo', surface: 'operatore', envKey: 'SUPERADMIN' },
  { profile: 'collaboratore', slug: 'studio-demo', surface: 'operatore', envKey: 'COLLABORATORE' },
  { profile: 'cliente', slug: 'studio-demo', surface: 'cliente', envKey: 'CLIENTE' },
] as const;

interface Creds {
  email: string;
  password: string;
}

function getCreds(envKey: string): Creds {
  const email = process.env[`E2E_${envKey}_EMAIL`];
  const password = process.env[`E2E_${envKey}_PASSWORD`];
  if (!email || !password) {
    throw new Error(
      `Missing credentials for profile "${envKey}". ` +
        `Set E2E_${envKey}_EMAIL and E2E_${envKey}_PASSWORD in apps/accountant-web/.env.e2e`,
    );
  }
  return { email, password };
}

async function loginAndPersistStorage(page: Page, p: RoleProfile): Promise<void> {
  const { email, password } = getCreds(p.envKey);
  const storageFile = path.join(AUTH_DIR, `${p.profile}.json`);

  await page.goto(`/t/${p.slug}/login`);

  // Form login presente. Il titolo è ora il wordmark brand (ADR-0061): SVG
  // role="img" con accessible name = titolo i18n "Accedi a {brand}".
  await expect(page.getByRole('img', { name: /accedi a studiodesk/i })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();

  // pressSequentially su email per robustezza cross-browser (WebKit + RHF):
  // fill() può non triggerare onChange. Vedi restaurant auth.setup.
  await page.locator('input[type="email"]').click();
  await page.locator('input[type="email"]').pressSequentially(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /^accedi$/i }).click();

  // Redirect post-login dipende dalla superficie (ADR-0046 §4).
  if (p.surface === 'operatore') {
    await page.waitForURL(`/t/${p.slug}/dashboard`, { timeout: 15_000 });
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible({ timeout: 15_000 });
  } else {
    await page.waitForURL(`/t/${p.slug}/portale`, { timeout: 15_000 });
    await expect(page.locator('[data-testid="portale-topbar"]')).toBeVisible({ timeout: 15_000 });
  }

  await page.context().storageState({ path: storageFile });
}

for (const p of PROFILES) {
  setup(`authenticate as ${p.profile}`, async ({ page }) => {
    await loginAndPersistStorage(page, p);
  });
}
