import crypto from 'node:crypto';

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Client } from 'pg';

/**
 * Test 3 (precursor auth-refresh) — single-flight: N richieste parallele in 401
 * (access token SCADUTO) → UNA sola /auth/refresh → nessuna theft-detection.
 *
 * HARNESS: Playwright restaurant-web contro BE reale. Il codice sotto test è FE
 * (refreshAccessToken di @gestionale/auth-web) → l'harness testcontainers del BE
 * non lo raggiunge senza snaturarlo; qui gira nel browser reale. L'EFFETTO lato
 * BE si prova via `pg` (DIRECT_URL = superuser → bypassa RLS). Il conteggio
 * page.on('request') prova che il FE ha emesso UNA richiesta; solo il DB prova
 * che il BE ne ha processata UNA (3 assert DB, non 2).
 *
 * CI-ONLY: richiede lo stack (BE reale) + DB interrogabile via DIRECT_URL +
 * JWT_SECRET per firmare il token scaduto. In locale mancano → skip.
 *
 * TRIGGER di concorrenza REALE: /mappa spara 2 fetch autenticati concorrenti al
 * mount — `Promise.all([listTavoli, listConti])` (mappa/page.tsx). Con l'access
 * token scaduto entrambi prendono 401 → entrambi chiamano onUnauthorized =
 * refreshAccessToken → il single-flight coalesce a UNA /auth/refresh. Se il
 * coalescing si rompe: 2 refresh → il 2° presenta un token già ruotato →
 * theft-detection → revoca sessioni + audit auth.theft_detected.
 *
 * TOKEN SCADUTO, non malformato (verificato: jwt.strategy ha
 * `ignoreExpiration:false` → sia scaduto sia malformato falliscono in passport
 * PRIMA di validate(), 401 identico; ma per fedeltà di produzione firmiamo un
 * token ben formato con `exp` nel passato, HS256 con JWT_SECRET).
 */

const SLUG = 'demo';
const DIRECT_URL = process.env.DIRECT_URL;
const JWT_SECRET = process.env.JWT_SECRET;

// CI-only: senza stack + DB interrogabile + secret, il test non è eseguibile.
test.skip(
  !DIRECT_URL || !JWT_SECRET,
  'CI-only: richiede DIRECT_URL (DB queryable) + JWT_SECRET (firma token scaduto)',
);

function demoCreds(): { email: string; password: string } {
  const email = process.env.E2E_DEMO_EMAIL;
  const password = process.env.E2E_DEMO_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD in apps/restaurant-web/.env.e2e');
  }
  return { email, password };
}

async function loginAsDemoAdmin(page: Page): Promise<void> {
  const { email, password } = demoCreds();
  await page.goto(`/t/${SLUG}/login`);
  await page.locator('input[type="email"]').click();
  await page.locator('input[type="email"]').pressSequentially(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /^accedi$/i }).click();
  await page.waitForURL(`/t/${SLUG}/dashboard`, { timeout: 10_000 });
}

interface AccessPayload {
  sub: string;
  tenantId: string;
  sessionId: string;
  type: string;
  iat?: number;
  exp?: number;
}

/** Firma un JWT HS256 con lo stesso payload ma `exp` nel passato (token SCADUTO ben formato). */
function signExpired(
  realAccessToken: string,
  secret: string,
): { token: string; sessionId: string; sub: string } {
  const [, payloadB64] = realAccessToken.split('.');
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as AccessPayload;
  const nowSec = Math.floor(Date.now() / 1000);
  const expiredPayload = { ...payload, iat: nowSec - 7200, exp: nowSec - 3600 }; // scaduto 1h fa
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${enc(header)}.${enc(expiredPayload)}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return { token: `${signingInput}.${signature}`, sessionId: payload.sessionId, sub: payload.sub };
}

test.describe('Precursor auth-refresh — single-flight (test 3, effetto lato BE)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('2 richieste parallele in 401 → UNA /auth/refresh, zero theft, una rotazione', async ({
    page,
  }) => {
    await loginAsDemoAdmin(page);

    // Cattura i token reali, poi sostituisci l'access con una versione SCADUTA
    // (refresh resta valido → il single-flight potrà rinnovare).
    const realAccess = await page.evaluate(() => localStorage.getItem('gestionale_access_token'));
    if (!realAccess) throw new Error('access token assente post-login');
    const { token: expiredAccess, sessionId, sub } = signExpired(realAccess, JWT_SECRET!);
    await page.evaluate(
      (tok) => localStorage.setItem('gestionale_access_token', tok),
      expiredAccess,
    );

    const db = new Client({ connectionString: DIRECT_URL });
    await db.connect();
    try {
      const activeSessions = async (): Promise<number> =>
        (
          await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND is_active = true`,
            [sub],
          )
        ).rows[0].n;

      // Baseline PRIMA del burst (la sessione di login è attiva; un eventuale
      // rumore da login paralleli di altri test è assorbito dal confronto prima==dopo).
      const activeBefore = await activeSessions();

      // Conta le POST /auth/refresh emesse dal FE (prova lato client).
      let feRefreshRequests = 0;
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().includes('/auth/refresh')) feRefreshRequests += 1;
      });

      // /mappa: 2 fetch autenticati concorrenti → 2× 401 → single-flight → 1 refresh.
      const refreshResp = page.waitForResponse(
        (r) => r.url().includes('/auth/refresh') && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await page.goto(`/t/${SLUG}/mappa`);
      await refreshResp;
      // Il retry con token fresco ha successo → la mappa si monta.
      await expect(page.getByTestId('mappa-canvas')).toBeVisible({ timeout: 15_000 });

      // ── Prova lato FE: una sola /auth/refresh emessa ──
      expect(feRefreshRequests).toBe(1);

      // ── Prova lato BE (3 assert via pg, superuser DIRECT_URL) ──
      // 1. Zero theft-detection per l'utente (il coalescing l'ha evitata).
      const theft = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.theft_detected' AND user_id = $1`,
        [sub],
      );
      expect(theft.rows[0].n).toBe(0);

      // 2. Una sola rotazione: esattamente 1 auth.refresh.success per LA MIA sessione
      //    (after_value->>'previousSessionId' = sessione pre-rotazione). Se il
      //    coalescing fallisse, ci sarebbero 2 rotazioni o 1 rotazione + 1 theft.
      const rotations = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs
         WHERE action = 'auth.refresh.success' AND after_value->>'previousSessionId' = $1`,
        [sessionId],
      );
      expect(rotations.rows[0].n).toBe(1);

      // 3. Nessuna revoca in massa: il numero di sessioni attive è INVARIATO. Una
      //    rotazione chiude la vecchia e apre la nuova (netto = 0). La theft-
      //    detection le disattiverebbe tutte → il conteggio crollerebbe. `==`, non `≥1`.
      const activeAfter = await activeSessions();
      expect(activeAfter).toBe(activeBefore);
    } finally {
      await db.end();
    }
  });
});
