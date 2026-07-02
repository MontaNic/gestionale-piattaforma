import path from 'node:path';

import { test, expect } from '@playwright/test';

/**
 * comande-flow.spec.ts — Smoke E2E flusso comande da tavolo (PR-2, ADR-0068)
 *
 * Esercita la catena INTEGRATA mappa↔conti da browser reale:
 *   /mappa → tap tavolo libero → dialog apertura conto cassa → /comande/{id}
 *   → aggiungi una riga → totale > 0 → chiudi conto → /mappa → tavolo di nuovo libero.
 *
 * Pattern storageState: riusa `e2e/.auth/demo.json` (auth.setup.ts, admin@demo.local
 * = Super Admin → possiede comande.* + tavoli.gestisci; nessuna modifica al seed).
 * Prerequisiti seed dev (packages/db/prisma/seed.ts): tenant demo con ≥1 tavolo
 * (seedDevTavoli: 2 tavoli), menu "Pranzo" con articoli e PriceList "Base" attivo
 * su tutti i canali (cassa incluso) → il resolver prezzo produce totale > 0.
 *
 * Nome distinto da `smoke.spec.ts` (baseURL unauth) per non confondere i due.
 * Solo Chromium in CI (config attuale) — la spec è raccolta automaticamente.
 */

const DEMO_STORAGE = path.join(import.meta.dirname, '..', '.auth', 'demo.json');
const SLUG = 'demo';

test.describe('Comande — flusso da tavolo (PR-2, ADR-0068)', () => {
  test.use({ storageState: DEMO_STORAGE });

  test('apri conto da tavolo libero → aggiungi riga → chiudi → tavolo libero', async ({ page }) => {
    await page.goto(`/t/${SLUG}/mappa`);

    // ── 1. Individua un tavolo LIBERO sul canvas e ricordane l'id ──────────────
    const freeToken = page.locator('[data-testid^="tavolo-"][data-occupato="false"]').first();
    await expect(freeToken).toBeVisible({ timeout: 10_000 });
    const testId = await freeToken.getAttribute('data-testid');
    if (!testId) throw new Error('token tavolo libero senza data-testid');

    // ── 2. Tap sul tavolo → dialog apertura conto cassa ───────────────────────
    await freeToken.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Canale fisso cassa (nessuna scelta canale nel dialog da-tavolo)
    await expect(dialog.getByText(/cassa|register/i)).toBeVisible();
    await page.locator('#apri-coperti').fill('2');

    // ── 3. Conferma apertura → atterra sulla vista conto ──────────────────────
    await dialog.getByRole('button', { name: /apri conto|open tab/i }).click();
    await page.waitForURL(/\/comande\/[^/]+$/, { timeout: 10_000 });

    // ── 4. Aggiungi una riga (articolo dal picker) ────────────────────────────
    await page.getByRole('button', { name: /aggiungi articolo|add item/i }).click();
    const articleSelect = page.locator('select').first();
    await expect(articleSelect).toBeVisible();
    // Prima opzione reale (indice 0 = placeholder vuoto)
    await articleSelect.selectOption({ index: 1 });
    await page.getByRole('button', { name: /^aggiungi$|^add$/i }).click();

    // ── 5. Totale > 0 (una riga con prezzo risolto server-side) ───────────────
    // La riga totale è l'ultimo span tabular-nums (le righe/subtotali precedono).
    const totaleSpan = page.locator('span.tabular-nums').last();
    await expect(totaleSpan).toBeVisible();
    await expect
      .poll(
        async () => {
          const txt = (await totaleSpan.innerText()).replace(/[^\d.,]/g, '').replace(',', '.');
          return Number.parseFloat(txt);
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // ── 6. Chiudi il conto (conferma) ─────────────────────────────────────────
    await page.getByRole('button', { name: /chiudi conto|close tab/i }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /conferma|confirm/i }).click();
    // Banner sola-lettura conferma la chiusura (stato != aperto)
    await expect(page.getByText(/sola lettura|read only|read-only/i)).toBeVisible({
      timeout: 10_000,
    });

    // ── 7. Torna alla mappa → lo stesso tavolo è di nuovo LIBERO ──────────────
    await page.goto(`/t/${SLUG}/mappa`);
    const token = page.locator(`[data-testid="${testId}"]`);
    await expect(token).toBeVisible({ timeout: 10_000 });
    await expect(token).toHaveAttribute('data-occupato', 'false');
  });
});
