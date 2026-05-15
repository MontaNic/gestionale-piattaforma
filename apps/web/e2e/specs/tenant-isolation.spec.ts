import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * Cross-tenant isolation test — demo user logged tenta accesso /t/acme/dashboard.
 *
 * Comportamento empirico documentato (Fase 3.1 STOP 3) — STRATEGIA (a):
 * UI inconsistency. Root cause:
 * - Backend `apps/api/src/tenant/tenant.middleware.ts:43` SKIPPA tenantId-resolution
 *   se `req.user` presente (JWT post-auth). Nessun cross-check JWT.tenantId vs
 *   X-Tenant-Slug header.
 * - Backend `apps/api/src/me/me.controller.ts` usa SOLO user.id da JWT
 *   (decorator @CurrentUser), NON legge slug URL.
 * - Frontend `apps/web/src/app/t/[slug]/dashboard/page.tsx`: apiGet('/me')
 *   passa solo accessToken, NON tenantSlug. Quindi /me ritorna profilo
 *   relativo al JWT subject (demo user) indipendente da URL slug.
 *
 * Risultato: demo loggato che naviga /t/acme/dashboard vede:
 *   - URL: /t/acme/dashboard (middleware TD-2 OK perché "acme" è slug valido)
 *   - Contenuto dashboard: dati DEMO user (firstName/lastName demo)
 *
 * Questo è il gap TD-7 ADR-0012 "Cross-tenant token UX edge".
 * Il test documenta il comportamento ATTUALE, NON forza fix ideale.
 *
 * Fix ideale (TD futuro):
 * - Opzione 1: Frontend manda X-Tenant-Slug ANCHE post-auth + backend cross-check
 * - Opzione 2: Backend Guard verifica JWT.tenantId vs URL.slug, 403 se mismatch
 * - Opzione 3: Frontend useEffect verifica /me.tenantSlug vs useParams.slug, redirect logout
 */

test.use({ storageState: path.join(import.meta.dirname, '..', '.auth', 'demo.json') });

test.describe('Cross-tenant isolation (demo user → acme tenant URL)', () => {
  test('demo logged user navigating /t/acme/dashboard sees DEMO data (TD-7 ADR-0012 gap)', async ({
    page,
  }) => {
    await page.goto('/t/acme/dashboard');

    // URL mantenuto a /t/acme/dashboard (no redirect server-side né client-side)
    await expect(page).toHaveURL('/t/acme/dashboard');

    // Dashboard caricata MA con dati demo (apiGet /me ignora slug URL)
    // Card "Welcome ..." mostrata = profilo JWT (demo user)
    await expect(page.getByText(/^welcome\s+/i)).toBeVisible({ timeout: 10_000 });

    // Verifica email mostrata = demo (CardDescription contiene profile.user.email).
    // page.tsx:95: <CardDescription>{profile.user.email}</CardDescription>
    // Se backend rispettasse slug, dovremmo vedere acme; empirico = demo.
    const demoEmail = process.env.E2E_DEMO_EMAIL;
    if (!demoEmail) throw new Error('Missing E2E_DEMO_EMAIL env var');
    await expect(page.getByText(demoEmail)).toBeVisible({ timeout: 5_000 });

    // Verifica esplicita NO redirect a /t/acme/login (no enforcement attuale)
    expect(page.url()).toBe(new URL('/t/acme/dashboard', page.url()).toString());
  });
});
