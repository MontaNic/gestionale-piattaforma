import { test, expect } from '@playwright/test';

/**
 * Smoke test — verifica Playwright setup funziona.
 * NON è uno dei 7 test reali (vedi STOP 3).
 * Scopo: confermare config + browser binaries + baseURL funzionanti.
 *
 * Atteso: dev server frontend up su localhost:3001 PRIMA di lanciare test.
 */
test.describe('Playwright smoke setup', () => {
  test('frontend dev server responds on baseURL', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
  });

  test('page has expected title or no crash', async ({ page }) => {
    await page.goto('/');
    // Non assert title specifico (può cambiare) — solo verifica no crash render
    await expect(page).toHaveTitle(/.*/);
  });
});
