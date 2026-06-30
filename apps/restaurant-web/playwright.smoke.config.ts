import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

// Credenziali + PLAYWRIGHT_BASE_URL da .env.e2e (gitignored).
dotenv.config({ path: path.join(import.meta.dirname, '.env.e2e') });

/**
 * Playwright SMOKE config — apps/restaurant-web.
 *
 * Esegue SOLO lo smoke funzionale per-ruolo (auth.setup → page-tour) contro
 * l'URL PUBBLICO (https://food.studiodesk.cloud) → DB prod condiviso. ON-DEMAND.
 *
 * Separata da playwright.config.ts (che è la config CI, funzionale-locale, e
 * fa testIgnore di page-tour). Invocata via `pnpm test:e2e:smoke` — NON è una
 * task turbo, quindi NON entra nel job di test CI (invariante 2).
 *
 * READ-ONLY: il guard in page-tour.spec.ts aborta ogni metodo mutante.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://food.studiodesk.cloud',
    trace: 'on-first-retry',
    // Niente screenshot/video: contro prod, evitiamo artefatti che possano
    // catturare contenuti di sessione.
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      testMatch: /page-tour\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
