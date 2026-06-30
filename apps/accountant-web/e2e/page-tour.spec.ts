import path from 'node:path';

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ACCOUNTANT_MANIFEST, type DynamicStrategy, type Surface } from './page-manifest';

/**
 * page-tour.spec.ts — smoke funzionale per-ruolo (accountant-web).
 *
 * Per ogni (ruolo × pagina) del manifest visita la pagina e fallisce se:
 *  1. una response (documento o XHR /api/*, stesso host) ha status 403 o ≥500;
 *  2. viene emesso un `pageerror` (eccezione JS non gestita);
 *  3. compare il fallback Next "client-side exception has occurred"
 *     (NON esiste un error.tsx applicativo → questo è il marker reale; TD-no-error-boundary);
 *  4. parte una richiesta MUTANTE (POST≠login / PUT / PATCH / DELETE).
 *
 * READ-ONLY ATTIVO (invariante 1): il guard NON si limita a osservare — fa
 * `route.abort()` su ogni metodo mutante, così nessuna mutazione raggiunge il
 * DB prod condiviso anche se una pagina provasse a inviarla.
 *
 * Target: URL pubblico via PLAYWRIGHT_BASE_URL (https://studiodesk.cloud).
 * Storage state: .auth/<profile>.json (auth.setup.ts, dependency `setup`).
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const isLoginRequest = (url: string, method: string): boolean =>
  method === 'POST' && /\/api\/v1\/auth\/login(\?|$)/.test(url);

interface Violations {
  mutating: string[];
  badStatus: string[];
  pageErrors: string[];
}

function appHostFromConfig(): string {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? test.info().project.use.baseURL;
  if (!baseURL) throw new Error('PLAYWRIGHT_BASE_URL / baseURL non impostato');
  return new URL(baseURL).host;
}

async function installGuards(page: Page, appHost: string): Promise<Violations> {
  const v: Violations = { mutating: [], badStatus: [], pageErrors: [] };

  // Guard read-only ATTIVO: aborta i metodi mutanti (≠ login) prima che partano.
  await page.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    if (MUTATING.has(method) && !isLoginRequest(url, method)) {
      v.mutating.push(`${method} ${url}`);
      await route.abort();
      return;
    }
    await route.continue();
  });

  // Status 403/≥500 sulle response dello stesso host (documento + /api/*).
  page.on('response', (resp) => {
    let host = '';
    try {
      host = new URL(resp.url()).host;
    } catch {
      return;
    }
    if (host !== appHost) return;
    const s = resp.status();
    if (s === 403 || s >= 500) {
      v.badStatus.push(`${s} ${resp.request().method()} ${resp.url()}`);
    }
  });

  page.on('pageerror', (err) => {
    v.pageErrors.push(String((err as Error)?.message ?? err));
  });

  return v;
}

function clearViolations(v: Violations): void {
  v.mutating.length = 0;
  v.badStatus.length = 0;
  v.pageErrors.length = 0;
}

const shellMarker = (surface: Surface): string =>
  surface === 'cliente' ? '[data-testid="portale-topbar"]' : '[data-testid="sidebar"]';

async function settle(page: Page, surface: Surface): Promise<void> {
  // Shell pronta = AuthGate ha caricato /me e la pagina sta montando le sue fetch.
  await page
    .locator(shellMarker(surface))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});
  // Lascia completare le XHR async (così un 403 latente viene catturato).
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
}

/** Risolve il primo link di dettaglio nell'index corrente. null = lista vuota. */
async function resolveFirstDetail(
  page: Page,
  slug: string,
  dyn: DynamicStrategy,
): Promise<string | null> {
  return page.evaluate(
    ({ inc, pat, idxPath }) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const re = pat ? new RegExp(pat) : null;
      for (const a of anchors) {
        const h = a.getAttribute('href') ?? '';
        if (h.endsWith('/nuovo')) continue; // mai un link di creazione
        if (re) {
          if (re.test(h)) return h;
        } else if (inc && h.includes(inc) && h.startsWith(`${idxPath}/`)) {
          return h;
        }
      }
      return null;
    },
    {
      inc: dyn.detailHrefIncludes ?? null,
      pat: dyn.detailHrefPattern ?? null,
      idxPath: `/t/${slug}/${dyn.indexPath}`,
    },
  );
}

async function assertClean(page: Page, v: Violations, label: string): Promise<void> {
  const html = await page.content();
  const hasNextCrash = html.includes('client-side exception has occurred');

  expect(v.mutating, `${label}: richieste mutanti durante il tour`).toEqual([]);
  expect(v.badStatus, `${label}: response 403/≥500`).toEqual([]);
  expect(v.pageErrors, `${label}: pageerror (eccezione JS)`).toEqual([]);
  expect(hasNextCrash, `${label}: fallback Next "client-side exception"`).toBe(false);
}

for (const role of ACCOUNTANT_MANIFEST) {
  test.describe(`tour ${role.profile}`, () => {
    test.use({ storageState: path.join(import.meta.dirname, '.auth', `${role.profile}.json`) });

    for (const entry of role.pages) {
      test(`${role.profile} › ${entry.path}`, async ({ page }) => {
        const appHost = appHostFromConfig();
        const v = await installGuards(page, appHost);

        let target: string;
        if (entry.dynamic) {
          await page.goto(`/t/${role.slug}/${entry.dynamic.indexPath}`, {
            waitUntil: 'domcontentloaded',
          });
          await settle(page, role.surface);
          const href = await resolveFirstDetail(page, role.slug, entry.dynamic);
          if (!href) {
            test.skip(true, `lista vuota in ${entry.dynamic.indexPath} → skip (404 senza dati)`);
            return;
          }
          target = entry.dynamic.appendAfterDetail ? href + entry.dynamic.appendAfterDetail : href;
          // Isola l'asserzione alla SOLA pagina target (la navigazione index ha già
          // il suo test dedicato).
          clearViolations(v);
        } else {
          target = `/t/${role.slug}/${entry.path}`;
        }

        await page.goto(target, { waitUntil: 'domcontentloaded' });
        await settle(page, role.surface);
        await assertClean(page, v, `${role.profile} ${entry.path}`);
      });
    }
  });
}
