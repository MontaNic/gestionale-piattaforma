import path from 'node:path';

import { test, expect } from '@playwright/test';

/**
 * coperti-warning.spec.ts — warning SOFT coperti > capienza (STOP 1)
 *
 * Il warning vive solo nel dialog apri-conto della mappa (unico punto dove si
 * impostano i coperti su un tavolo). È non bloccante: il submit resta abilitato
 * e il conto si apre davvero anche con coperti > capienza — il test 1 lo prova
 * end-to-end (bottone abilitato ≠ azione completa), non solo asserendo il submit.
 *
 * Nessun BE: la capienza è già lato FE (Tavolo caricato dalla mappa). Legge la
 * capienza reale del tavolo tappato da `data-capienza` per il boundary esatto.
 */

const DEMO_STORAGE = path.join(import.meta.dirname, '.auth', 'demo.json');
const SLUG = 'demo';

test.describe('Warning coperti oltre capienza (STOP 1)', () => {
  test.use({ storageState: DEMO_STORAGE });

  test('coperti > capienza → warning; = e vuoto → nessun warning; il conto si apre comunque', async ({
    page,
  }) => {
    await page.goto(`/t/${SLUG}/mappa`);

    // Tavolo libero + capienza reale (data-capienza).
    const free = page.locator('[data-testid^="tavolo-"][data-occupato="false"]').first();
    await expect(free).toBeVisible({ timeout: 10_000 });
    const capienza = Number(await free.getAttribute('data-capienza'));
    expect(capienza).toBeGreaterThan(0);

    await free.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const coperti = page.locator('#apri-coperti');
    const warning = page.getByTestId('coperti-warning');
    const confirm = dialog.getByRole('button', { name: /apri conto|open tab/i });

    // test 2 — coperti = capienza → nessun warning (boundary, `>` non `>=`)
    await coperti.fill(String(capienza));
    await expect(warning).toHaveCount(0);

    // test 4 — coperti vuoto → nessun warning
    await coperti.fill('');
    await expect(warning).toHaveCount(0);

    // test 1a — coperti > capienza → warning visibile, submit ABILITATO
    await coperti.fill(String(capienza + 1));
    await expect(warning).toBeVisible();
    await expect(confirm).toBeEnabled();

    // test 1 — il conto si apre DAVVERO con coperti > capienza (warning ortogonale)
    await confirm.click();
    await page.waitForURL(/\/comande\/[^/]+$/, { timeout: 10_000 });
    // atterraggio sulla vista conto = apertura completata (non solo bottone attivo)
    await expect(page).toHaveURL(/\/comande\/[^/]+$/);
  });
});
