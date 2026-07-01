import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Mappa tavoli — drag-persist end-to-end (FE-5, ADR-0064).
 *
 * Chiude il buco storico: il drag-drop della mappa sala non era mai stato
 * esercitato a livello browser (la contract API è coperta da restaurant-api
 * `tables-crud #4` + `tables-rbac`, ma il pointer-event reale → PATCH no). Qui
 * verifichiamo la catena completa da utente **non-superuser** con `tavoli.gestisci`:
 *   pointer down/move/up sul token → PATCH /tables/:id 200 → reload → posizione persistita.
 *
 * Utente: `direzione@demo.local` (ruolo Direzione, non-super) — seedato in
 * packages/db/prisma/seed.ts (seedDevDirezione). Credenziali da .env.e2e
 * (E2E_DIREZIONE_*), come gli altri tenant.
 *
 * Contesto pulito: NIENTE storageState admin (auth.setup.ts logga admin@demo.local,
 * Super Admin). Login fresco per provare anche il gating FE (`canManage`).
 *
 * AMBITO: gira dev-like (localhost, NO Caddy). Protegge la LOGICA drag→persist da
 * regressioni; il routing prod è coperto da smoke/ADR-0062.
 */

const SLUG = 'demo';

function direzioneCreds(): { email: string; password: string } {
  const email = process.env.E2E_DIREZIONE_EMAIL;
  const password = process.env.E2E_DIREZIONE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Missing E2E_DIREZIONE_EMAIL / E2E_DIREZIONE_PASSWORD in apps/restaurant-web/.env.e2e ' +
        '(utente Direzione seedato da seedDevDirezione — credenziali dal seed dev).',
    );
  }
  return { email, password };
}

async function loginAsDirezione(page: Page): Promise<void> {
  const { email, password } = direzioneCreds();
  await page.goto(`/t/${SLUG}/login`);
  // pressSequentially su email: robustezza cross-browser RHF (vedi auth.setup.ts).
  await page.locator('input[type="email"]').click();
  await page.locator('input[type="email"]').pressSequentially(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /^accedi$/i }).click();
  await page.waitForURL(`/t/${SLUG}/dashboard`, { timeout: 10_000 });
}

test.describe('Mappa tavoli — drag-persist (FE-5, non-superuser)', () => {
  // Contesto pulito: nessun token admin ereditato.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Direzione trascina un tavolo → PATCH 200 → posizione persiste dopo reload', async ({
    page,
  }) => {
    await loginAsDirezione(page);
    await page.goto(`/t/${SLUG}/mappa`);

    // ── 1. Gating FE: con `tavoli.gestisci` i controlli gestione sono montati ──
    // (prova che canManage === true per un utente non-super).
    await expect(page.getByRole('button', { name: /nuovo tavolo/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /modifica tavolo/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /elimina tavolo/i }).first()).toBeVisible();

    // ── 2. Individua un tavolo (token) e la posizione iniziale ──
    const token = page.locator('[data-testid^="tavolo-"]').first();
    await expect(token).toBeVisible();
    const testId = await token.getAttribute('data-testid');
    if (!testId) throw new Error('token tavolo senza data-testid');
    const before = await token.boundingBox();
    if (!before) throw new Error('boundingBox token assente');

    const canvas = page.getByTestId('mappa-canvas');
    const cbox = await canvas.boundingBox();
    if (!cbox) throw new Error('boundingBox canvas assente');

    // ── 3. Drag reale via page.mouse (down → move a nuova coord → up) ──
    // page.mouse su Chromium emette anche i pointer-event consumati da
    // handlePointerDown/Move/Up (setPointerCapture su pointerdown instrada i
    // move successivi al token). Muoviamo in step per garantire pointermove
    // (drag.moved=true) prima del rilascio.
    //
    // Target = angolo OPPOSTO al quadrante corrente del token: il drag persiste
    // la posizione (muta il seed), quindi un re-run parte da dove il run
    // precedente ha lasciato il tavolo. Un target assoluto fisso coinciderebbe
    // con la posizione già raggiunta → spostamento nullo. L'angolo opposto
    // garantisce sempre un delta ampio, in-bounds, indipendente dallo start.
    const startX = before.x + before.width / 2;
    const startY = before.y + before.height / 2;
    const canvasCenterX = cbox.x + cbox.width / 2;
    const canvasCenterY = cbox.y + cbox.height / 2;
    const targetX = startX < canvasCenterX ? cbox.x + cbox.width - 130 : cbox.x + 30;
    const targetY = startY < canvasCenterY ? cbox.y + cbox.height - 110 : cbox.y + 30;

    const patchResp = page.waitForResponse(
      (r) => r.url().includes('/tables/') && r.request().method() === 'PATCH',
    );

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + targetX) / 2, (startY + targetY) / 2, { steps: 8 });
    await page.mouse.move(targetX, targetY, { steps: 8 });
    await page.mouse.up();

    const resp = await patchResp;
    expect(resp.status()).toBe(200);

    // ── 4. Persistenza: reload → il token riflette la nuova posizione ──
    await page.reload();
    const tokenAfter = page.locator(`[data-testid="${testId}"]`);
    await expect(tokenAfter).toBeVisible();
    const after = await tokenAfter.boundingBox();
    if (!after) throw new Error('boundingBox post-reload assente');

    // La posizione è cambiata in modo significativo verso il target (non un no-op).
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(50);
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(50);
  });
});
