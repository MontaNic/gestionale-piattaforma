import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

// Credenziali + PLAYWRIGHT_BASE_URL da .env.e2e (gitignored).
dotenv.config({ path: path.join(import.meta.dirname, '.env.e2e') });

/**
 * Playwright SMOKE config — apps/accountant-web.
 *
 * accountant-web non ha (ancora) e2e funzionali: questa è l'unica config e
 * serve SOLO lo smoke funzionale per-ruolo (auth.setup → page-tour) contro
 * l'URL PUBBLICO (https://studiodesk.cloud) → DB prod condiviso. ON-DEMAND.
 *
 * Invocata via `pnpm test:e2e:smoke` — NON è una task turbo né uno script
 * `test`/`test:e2e` raccolto dalla CI (invariante 2).
 *
 * Specchio del pattern restaurant-web. READ-ONLY: il guard in page-tour.spec.ts
 * aborta ogni metodo mutante.
 *
 * Profili-ruolo (storageState in .auth/<profile>.json): superadmin /
 * collaboratore / cliente, tutti sul tenant studio-demo.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://studiodesk.cloud',
    trace: 'on-first-retry',
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
