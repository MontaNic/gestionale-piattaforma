import path from 'node:path';

import { test, expect } from '@playwright/test';

/**
 * cassa-flow.spec.ts — Smoke E2E incasso da cassa (PR2, ADR-0082)
 *
 * È la variante PAGA-POI-CHIUDI che ADR-0081 aveva demandato a questa PR
 * (`comande-flow.spec.ts` chiude con `annulla` perché la UI di pagamento non
 * esisteva ancora). Esercita la catena INTEGRATA da browser reale:
 *   /mappa → tavolo dedicato → conto cassa → riga → invia in cucina →
 *   "Incassa" → /cassa/{id} → registra pagamento a saldo → residuo 0 →
 *   chiudi conto → /mappa → tavolo di nuovo libero.
 *
 * Copre in un colpo solo i tre pezzi nuovi: il link comande→cassa, il pannello
 * di pagamento, e il bottone chiudi legato a `conto.chiudibile` (che compare
 * SOLO dopo il saldo — se il campo fosse sbagliato, questo test fallisce sul
 * `cassa-chiudi` mai visibile).
 *
 * ⚠️ TAVOLO PROPRIO, non uno dei seedati. "Un tavolo, un conto aperto" (DP-2)
 * rende il tavolo una risorsa esclusiva: i tavoli del seed sono 2 e sono già
 * contesi tra `coperti-warning.spec.ts` (che ne lascia uno occupato) e
 * `comande-flow.spec.ts`. Questa spec ne CREA uno con numero unico e lo elimina
 * alla fine → nessuna contesa, né in CI (`workers: 1`) né in locale
 * (`fullyParallel`), e nessun consumo del pool seedato.
 *
 * Pattern storageState: riusa `e2e/.auth/demo.json` (auth.setup.ts,
 * admin@demo.local = Super Admin → comande.* + cassa.* + tavoli.gestisci;
 * nessuna modifica al seed). Prerequisiti seed dev: menu con articoli e listino
 * attivo sul canale cassa → totale > 0.
 */

const DEMO_STORAGE = path.join(import.meta.dirname, '..', '.auth', 'demo.json');
const SLUG = 'demo';

/** Legge un importo reso da `formatEuro` ("€ 8.00") come number. */
function parseEuro(text: string): number {
  return Number.parseFloat(text.replace(/[^\d.,-]/g, '').replace(',', '.'));
}

test.describe('Cassa — incasso e chiusura conto (PR2, ADR-0082)', () => {
  test.use({ storageState: DEMO_STORAGE });

  test('apri conto → riga → invia → incassa a saldo → chiudi → tavolo libero', async ({ page }) => {
    // Numero unico per run: `numero` è unique per tenant (E_TABLE_NUMERO_EXISTS)
    // e più run in parallelo non devono collidere.
    const numero = `E2E-CASSA-${Date.now()}`;

    await page.goto(`/t/${SLUG}/mappa`);

    // ── 1. Crea il tavolo dedicato ────────────────────────────────────────────
    await page.getByRole('button', { name: /nuovo tavolo|new table/i }).click();
    const createDialog = page.getByRole('dialog');
    await expect(createDialog).toBeVisible();
    await createDialog.locator('input:not([type="number"])').first().fill(numero);
    await createDialog.locator('input[type="number"]').first().fill('4');
    await createDialog.getByRole('button', { name: /^crea$|^create$/i }).click();
    await expect(createDialog).toBeHidden({ timeout: 10_000 });

    // Riga dell'elenco accessibile del tavolo appena creato: è la superficie
    // stabile (il token sul canvas ha per testid l'id, che qui non conosciamo).
    const row = page.getByRole('listitem').filter({ has: page.getByText(numero, { exact: true }) });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // ── 2. Apri il conto cassa dal tavolo ─────────────────────────────────────
    // Il bottone azione ha aria-label `tavoli.apri.actionAria` (l'etichetta
    // visibile alterna "Apri conto"/"Vai al conto" a seconda dell'occupazione).
    await row.getByRole('button', { name: /apri o vai al conto|open or go to the tab/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.locator('#apri-coperti').fill('2');
    await dialog.getByRole('button', { name: /apri conto|open tab/i }).click();
    await page.waitForURL(/\/comande\/[^/]+$/, { timeout: 10_000 });

    // ── 3. Aggiungi una riga ──────────────────────────────────────────────────
    await page.getByRole('button', { name: /aggiungi articolo|add item/i }).click();
    const articleSelect = page.locator('select').first();
    await expect(articleSelect).toBeVisible();
    await articleSelect.selectOption({ index: 1 }); // indice 0 = placeholder
    await page.getByRole('button', { name: /^aggiungi$|^add$/i }).click();

    // ── 4. Invia in cucina (la riga diventa immutabile: caso reale di incasso) ─
    await page.getByRole('button', { name: /invia in cucina|send to kitchen/i }).click();
    const inviaConfirm = page.getByRole('dialog');
    await expect(inviaConfirm).toBeVisible();
    await inviaConfirm.getByRole('button', { name: /^invia$|^send$/i }).click();
    await expect(page.getByText(/inviata|inviate|order sent|orders sent/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── 5. "Incassa" → pannello cassa (il link nuovo di questa PR) ────────────
    await page.getByRole('link', { name: /incassa|take payment/i }).click();
    await page.waitForURL(/\/cassa\/[^/]+$/, { timeout: 10_000 });

    // ── 6. Residuo > 0 e importo pre-compilato col residuo ────────────────────
    const residuo = page.getByTestId('cassa-residuo');
    await expect(residuo).toBeVisible({ timeout: 10_000 });
    const residuoIniziale = parseEuro(await residuo.innerText());
    expect(residuoIniziale).toBeGreaterThan(0);
    const importo = page.locator('#cassa-importo');
    await expect(importo).toHaveValue(residuoIniziale.toFixed(2));

    // Finché il conto non è saldato il bottone chiudi NON esiste (`chiudibile`
    // false lato BE): al suo posto c'è il residuo da incassare.
    await expect(page.getByTestId('cassa-chiudi')).toHaveCount(0);

    // ── 7. Registra il pagamento a saldo (metodo di default: contanti) ────────
    await page.getByTestId('cassa-registra-pagamento').click();
    await expect
      .poll(async () => parseEuro(await residuo.innerText()), { timeout: 10_000 })
      .toBe(0);
    await expect(page.getByTestId('cassa-pagamenti')).toBeVisible();

    // ── 8. Ora il conto è chiudibile → chiudi ─────────────────────────────────
    const chiudi = page.getByTestId('cassa-chiudi');
    await expect(chiudi).toBeVisible({ timeout: 10_000 });
    await chiudi.click();
    const chiudiConfirm = page.getByRole('dialog');
    await expect(chiudiConfirm).toBeVisible();
    await chiudiConfirm.getByRole('button', { name: /conferma|confirm/i }).click();
    // Banner sola-lettura = transizione terminale avvenuta.
    await expect(page.getByText(/sola lettura|read only|read-only/i)).toBeVisible({
      timeout: 10_000,
    });
    // Riepilogo IVA congelato alla chiusura (ADR-0081 D4) reso a schermo.
    await expect(page.getByTestId('cassa-riepilogo-iva')).toBeVisible();

    // ── 9. Il tavolo torna LIBERO (il conto non è più `aperto`) ───────────────
    await page.goto(`/t/${SLUG}/mappa`);
    const rowAfter = page
      .getByRole('listitem')
      .filter({ has: page.getByText(numero, { exact: true }) });
    await expect(rowAfter).toBeVisible({ timeout: 10_000 });
    await expect(rowAfter.getByText(/^libero$|^free$/i)).toBeVisible();

    // ── 10. Cleanup: elimina il tavolo dedicato ───────────────────────────────
    // Solo sul percorso felice: se il test fallisce prima, il tavolo resta per
    // l'ispezione post-mortem (ed è comunque libero, quindi innocuo).
    await rowAfter
      .getByRole('button', { name: new RegExp(`(elimina tavolo|delete table) ${numero}`, 'i') })
      .click();
    const deleteConfirm = page.getByRole('dialog');
    await expect(deleteConfirm).toBeVisible();
    await deleteConfirm.getByRole('button', { name: /^elimina$|^delete$/i }).click();
    await expect(rowAfter).toHaveCount(0, { timeout: 10_000 });
  });
});
