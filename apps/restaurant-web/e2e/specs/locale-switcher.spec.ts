import path from 'node:path';

import { test, expect } from '@playwright/test';

/**
 * Locale switcher end-to-end — chiude il gap "switcher mai testato" (lo smoke
 * #142 tocca le pagine, non l'interazione). Verifica la catena completa:
 * click lingua -> POST /set-locale -> cookie NEXT_LOCALE -> router.refresh() ->
 * UI ri-renderizzata nella nuova lingua.
 *
 * AMBITO: gira dev-like (localhost, NO Caddy). NON riproduce la classe "route
 * Next dentro il namespace api ingoiata dal proxy in prod" (bug invisibile
 * senza Caddy) - quella e' chiusa dal guard CI sulle route handler dentro
 * `app/api` + verifica prod reale. Questo test protegge la LOGICA dello switcher
 * (client `@gestionale/i18n` + handler + refresh) da regressioni, es. un path
 * fetch errato o un cookie non scritto.
 *
 * Pattern storageState: riusa `e2e/.auth/demo.json` (auth.setup.ts).
 */
const DEMO_STORAGE = path.join(import.meta.dirname, '..', '.auth', 'demo.json');

test.describe('Locale switcher', () => {
  test.use({ storageState: DEMO_STORAGE });

  test('IT→EN: click cambia lingua, scrive cookie NEXT_LOCALE e ri-renderizza la UI', async ({
    page,
  }) => {
    await page.goto('/t/demo/dashboard');

    // Stato iniziale: italiano (nav "Mappa tavoli", default locale).
    const nav = page.getByTestId('sidebar');
    await expect(nav.getByText('Mappa tavoli')).toBeVisible();

    // Cattura lo status della POST /set-locale (deve essere 200, NON 404).
    const setLocaleResp = page.waitForResponse(
      (r) => r.url().endsWith('/set-locale') && r.request().method() === 'POST',
    );

    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('locale-en').click();

    const resp = await setLocaleResp;
    expect(resp.status()).toBe(200);

    // Cookie NEXT_LOCALE scritto = 'en'.
    await expect
      .poll(async () => {
        const cookies = await page.context().cookies();
        return cookies.find((c) => c.name === 'NEXT_LOCALE')?.value;
      })
      .toBe('en');

    // UI ri-renderizzata in inglese (router.refresh → RSC + messages EN).
    await expect(nav.getByText('Table map')).toBeVisible();
    await expect(nav.getByText('Mappa tavoli')).toHaveCount(0);
  });
});
