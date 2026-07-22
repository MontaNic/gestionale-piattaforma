import { defineConfig, devices } from '@playwright/test';

// =============================================================================
// playwright.blob.config.ts — apps/accountant-web, e2e blob/multipart auth-refresh
// =============================================================================
// Config DEDICATA a blob-auth-refresh.spec.ts (Sub-1 / §7 rev.2 di
// TD-blob-download-no-refresh). Verifica route-mocked: NESSUN backend, NESSUN
// DB. Playwright `page.route()` simula la scadenza dell'access token (401) e la
// /auth/refresh; il codice sotto test è il FE reale (apiGetBlob/apiPostMultipart
// + authOptions bundle + save-bundle del call-site) in un browser vero.
//
// Distinta da playwright.smoke.config.ts (che punta a prod studiodesk.cloud,
// read-only) e dalla config funzionale restaurant-web (BE reale + pg). Qui il
// webServer è `next dev` locale su una porta dedicata: girabile in CI senza rete
// né servizi esterni. On-demand: `pnpm --filter accountant-web test:e2e:blob`.
// =============================================================================

const PORT = 3013;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /blob-auth-refresh\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // `next dev` isolato su porta dedicata (3013) — non collide con i container
    // prod (3003 interno) né con un eventuale dev server manuale su 3003.
    command: `pnpm --filter accountant-web exec next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Nessun NEXT_PUBLIC_API_URL reale necessario: tutte le /api/v1 sono
    // intercettate da page.route() prima di toccare la rete.
  },
});
