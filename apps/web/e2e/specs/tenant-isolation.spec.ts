import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * Cross-tenant isolation test — demo user logged tenta accesso /t/acme/dashboard.
 *
 * =============================================================================
 * EVOLUZIONE SEMANTICA (sessione 15, Discovery #50)
 * =============================================================================
 *
 * PRE-F1-shell (sessione TD-4):
 *   Backend gap TD-7 ADR-0012 "Cross-tenant token UX edge":
 *   - /me ignora slug URL, ritorna profilo JWT subject
 *   - Frontend dashboard rendering = dati DEMO anche su /t/acme/...
 *   - Spec documentava: "demo logged → /t/acme/dashboard → vede dati DEMO"
 *
 * POST-F1-shell (sessione 14, PR #32 — Discovery #50 sessione 15):
 *   F1-shell AuthGate + AuthContext side-effect (NON intenzionale per TD-7):
 *   - AuthContext.loadProfile fetch /me SENZA X-Tenant-Slug (TD-7 backend invariato)
 *   - Risposta /me contiene tenantSlug del JWT subject (demo)
 *   - Frontend NON valida match tenantSlug profilo vs slug URL
 *   - MA: AuthGate + storageState cross-tenant innescano redirect implicito a
 *     /t/{slug-URL}/login (UI parzialmente chiusa, backend invariato)
 *
 * GAP RESIDUO TD-7:
 *   - UI: chiusa parzialmente via AuthGate redirect (lato UX, side-effect F1-shell)
 *   - Backend: INVARIATO — chiamate API dirette (curl, altri client non-browser)
 *     possono ancora leggere /me cross-tenant senza enforcement
 *   - Fix completo TD-7 (priority bump roadmap sessione 16+):
 *     (a) Backend Guard cross-check JWT.tenantId vs X-Tenant-Slug header
 *         su /me + endpoint auth-protetti (defense-in-depth)
 *     (b) Frontend: AuthContext passa X-Tenant-Slug + valida match profilo
 *
 * Questo spec documenta NUOVO comportamento UI (redirect implicito) come
 * regression guard contro futuri refactor F1-shell che potrebbero
 * accidentalmente riaprire il gap UI.
 *
 * Refs: ADR-0012 §TD-7, Discovery #50 sessione 15.
 * =============================================================================
 */

test.use({ storageState: path.join(import.meta.dirname, '..', '.auth', 'demo.json') });

test.describe('Cross-tenant isolation (demo user → acme tenant URL)', () => {
  test('demo logged user navigating /t/acme/dashboard → redirect implicito a login (F1-shell UI guard, Discovery #50)', async ({
    page,
  }) => {
    await page.goto('/t/acme/dashboard');

    // F1-shell AuthGate + AuthContext side-effect: cross-tenant access innesca
    // redirect implicito al login form del tenant URL (NO render dashboard
    // con dati DEMO leak come pre-F1-shell).
    //
    // Atteso: URL finale /t/acme/login (redirect interno, NO middleware-level)
    // Wait timeout generoso per AuthContext.loadProfile + redirect chain.
    await page.waitForURL(/\/t\/acme\/login(?:\?.*)?$/, { timeout: 10_000 });

    // Verifica login form renderizzato (NO flash dashboard pre-redirect)
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /accedi/i })).toBeVisible();

    // Verifica esplicita NO redirect a /t/{demo-slug}/login (no cross-tenant
    // slug rewrite). UI guard preserva slug URL utente.
    expect(page.url()).toContain('/t/acme/login');
  });
});
