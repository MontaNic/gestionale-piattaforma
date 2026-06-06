import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

// Carica credenziali E2E da .env.e2e (gitignored, vedi STOP 2 Fase 2.4)
dotenv.config({ path: path.join(import.meta.dirname, '.env.e2e') });

/**
 * Playwright config — apps/restaurant-web E2E
 *
 * Pattern fondante (ADR-0016, sessione 10):
 * - testDir: apps/restaurant-web/e2e/ (separazione da Vitest unit in src/)
 * - baseURL: http://localhost:3001 (default Next.js dev frontend)
 * - webServer: NON autostart in CI (assumiamo dev server già up via docker-compose o pnpm dev)
 *   Locale: webServer opzionale, Nicolò può lanciarlo manualmente con pnpm dev
 * - browsers: Chromium default, Firefox/WebKit opt-in via --project flag
 * - retries CI: 2 (regression visiva può avere flake), retries locale: 0
 * - trace: on-first-retry (gold per debug post-mortem CI failure)
 *
 * Multi-tenant fixture (STOP 2):
 * - Project `setup` esegue auth.setup.ts (genera storage state per-tenant)
 * - Project chromium/firefox/webkit dipendono da setup (dependencies: ['setup'])
 * - testMatch su setup limita a file *.setup.ts
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['github'], ['list']] : 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
    },
  ],

  // webServer commentato di default — Nicolò gestisce dev server manualmente
  // In CI useremo workflow GitHub Actions con services già up (vedi STOP 4)
  // webServer: {
  //   command: 'pnpm dev',
  //   url: 'http://localhost:3001',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },
});
