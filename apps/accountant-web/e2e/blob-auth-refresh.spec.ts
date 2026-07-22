import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

/**
 * Sub-1 / §7 rev.2 — TD-blob-download-no-refresh.
 *
 * Verifica RUNTIME (browser reale) che i download blob e gli upload multipart di
 * accountant-web, ora instradati su apiGetBlob/apiPostMultipart (#160), tentino
 * il single-flight refresh su 401 invece di fallire in silenzio.
 *
 * HARNESS route-mocked: NESSUN backend, NESSUN DB (a differenza del test 3
 * restaurant-web che parla col BE reale + pg). `page.route()` intercetta ogni
 * /api/v1 → simula la scadenza dell'access token (primo hit 401) e la
 * /auth/refresh. Il codice sotto test è FE reale: apiGetBlob/apiPostMultipart +
 * authOptions (onUnauthorized) + il save-bundle del call-site (createObjectURL →
 * <a download> → click). Login simulato iniettando i token in localStorage.
 *
 * Perché serve OLTRE agli unit (api-client-blob.test.ts): gli unit mockano
 * `fetch`; qui il fix gira nel browser reale con la vera FormData del form, il
 * vero evento 'download' e il vero wiring authOptions() → il refresh trasparente
 * non può essere invisibile a un mock infedele (STOP 1 §7).
 *
 * Coalescing single-flight: NON è criterio di pass (fragile) — assert minimo
 * refresh ≥ 1 + completamento. La concorrenza deterministica resta bonus.
 */

const SLUG = 'studio-demo';
const AZIENDA_ID = 'az-e2e-1';
const TIPO_ID = 'tipo-e2e-1';
const DOC_ID = 'doc-e2e-1';

const ME_BODY = {
  data: {
    user: {
      id: 'user-e2e-1',
      tenantId: 'tenant-e2e',
      email: 'operatore@e2e.local',
      firstName: 'Op',
      lastName: 'E2E',
      isActive: true,
      lastLoginAt: null,
      emailVerifiedAt: null,
      tipo: 'operatore',
      aziendaId: null,
      clienteRuolo: null,
    },
    roles: [{ id: 'role-1', name: 'collaboratore', sedeId: null }],
    permissions: ['documenti.visualizza', 'documenti.gestisci'],
  },
};

const AZIENDE_BODY = {
  data: [
    {
      id: AZIENDA_ID,
      tenantId: 'tenant-e2e',
      codice: 'CLI001',
      nome: 'Azienda E2E',
      tipoCliente: 'azienda',
      partitaIva: null,
      codiceFiscale: null,
      codiceAteco: null,
      email: null,
      emailOperativa: null,
      pec: null,
      sitoWeb: null,
      telefono: null,
      telefono2: null,
      indirizzo: null,
      noteOperative: null,
      attivo: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    },
  ],
};

const TIPI_BODY = {
  data: [
    {
      id: TIPO_ID,
      tenantId: null,
      nome: 'Fattura',
      direzione: 'studio_cliente',
      visibilitaDefault: 'tutti',
      ordine: 1,
      attivo: true,
    },
  ],
};

const DOCUMENTI_BODY = {
  data: [
    {
      id: DOC_ID,
      tenantId: 'tenant-e2e',
      tipoId: TIPO_ID,
      aziendaId: AZIENDA_ID,
      nomeOriginale: 'report.pdf',
      storageKey: 'k/report.pdf',
      mimeType: 'application/pdf',
      dimensione: 2048,
      visibilita: 'tutti',
      note: null,
      createdBy: 'user-e2e-1',
      deletedAt: null,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
    },
  ],
};

const REFRESH_OK = {
  data: { accessToken: 'fresh-access', refreshToken: 'fresh-refresh', expiresIn: 900 },
};

const FAKE_PDF = Buffer.from('%PDF-1.4\nfake e2e blob\n%%EOF');

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function unauthorized(route: Route): Promise<void> {
  return json(route, 401, { errorCode: 'E_AUTH_TOKEN_EXPIRED', message: 'token expired' });
}

interface Counters {
  refresh: number;
  download: number;
  /** content-type header di OGNI POST /documenti (upload), in ordine. */
  uploadContentTypes: string[];
}

interface RouteOpts {
  /** Comportamento della POST /auth/refresh. 'ok' rinnova, 'fail' → 401 (refresh scaduto). */
  refresh: 'ok' | 'fail';
}

/**
 * Installa il router mock su /api/v1. Ogni download/upload risponde 401 al PRIMO
 * tentativo (access token "scaduto") e 200 dal secondo (dopo il refresh). I dati
 * di contorno (/me, /aziende, /documenti/tipi, lista /documenti) sono sempre 200.
 */
async function installRoutes(page: Page, opts: RouteOpts): Promise<Counters> {
  const c: Counters = { refresh: 0, download: 0, uploadContentTypes: [] };

  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname;

    // /auth/refresh (single-flight)
    if (path.endsWith('/auth/refresh') && method === 'POST') {
      c.refresh += 1;
      return opts.refresh === 'ok'
        ? json(route, 200, REFRESH_OK)
        : json(route, 401, { errorCode: 'E_AUTH_INVALID_REFRESH_TOKEN', message: 'refresh dead' });
    }

    // Profilo utente — sempre valido (non è il path sotto test)
    if (path.endsWith('/me') && method === 'GET') return json(route, 200, ME_BODY);

    // Download documento: 1° hit 401 (token scaduto) → 2° hit blob
    if (/\/documenti\/[^/]+\/download$/.test(path) && method === 'GET') {
      c.download += 1;
      if (c.download === 1) return unauthorized(route);
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'content-disposition': 'attachment; filename="report.pdf"' },
        body: FAKE_PDF,
      });
    }

    // Upload documento (multipart): registra il content-type di OGNI tentativo;
    // 1° hit 401 → 2° hit 201 JSON
    if (path.endsWith('/documenti') && method === 'POST') {
      c.uploadContentTypes.push(req.headers()['content-type'] ?? '');
      if (c.uploadContentTypes.length === 1) return unauthorized(route);
      return json(route, 201, { data: { ...DOCUMENTI_BODY.data[0], id: 'doc-e2e-2' } });
    }

    // Dati di contorno della pagina
    if (path.endsWith('/aziende') && method === 'GET') return json(route, 200, AZIENDE_BODY);
    if (path.endsWith('/documenti/tipi') && method === 'GET') return json(route, 200, TIPI_BODY);
    if (path.endsWith('/documenti') && method === 'GET') return json(route, 200, DOCUMENTI_BODY);

    // Default difensivo: qualsiasi altra chiamata (shell) → 200 vuoto, mai hang
    return json(route, 200, { data: [] });
  });

  return c;
}

/** Inietta i token PRIMA degli script di pagina → AuthContext parte autenticato. */
async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('gestionale_access_token', 'e2e-access');
    localStorage.setItem('gestionale_refresh_token', 'e2e-refresh');
  });
}

async function gotoDocumenti(page: Page): Promise<void> {
  await page.goto(`/t/${SLUG}/documenti`);
  // La lista è caricata (1 documento) → il bottone download della riga è presente.
  await expect(page.locator('button:has(svg.lucide-download)').first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('blob/multipart auth-refresh (Sub-1, route-mocked, no BE/DB)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('download: 401 → /auth/refresh → retry → il save del browser scatta', async ({ page }) => {
    const c = await installRoutes(page, { refresh: 'ok' });
    await seedAuth(page);
    await gotoDocumenti(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.locator('button:has(svg.lucide-download)').first().click(),
    ]);

    // Il download reale è scattato (non un 401 silenzioso).
    expect(download.suggestedFilename()).toBe('report.pdf');
    // 2 GET /download: 1° 401 + retry 200. Nessun terzo (no loop).
    expect(c.download).toBe(2);
    // Il refresh è stato tentato (≥1, coalescing non asserito).
    expect(c.refresh).toBeGreaterThanOrEqual(1);
  });

  test('upload: 401 → refresh → retry; multipart+boundary su entrambi, nessun Content-Type manuale', async ({
    page,
  }) => {
    const c = await installRoutes(page, { refresh: 'ok' });
    await seedAuth(page);
    await gotoDocumenti(page);

    // Apri il form (bottone "Nuovo documento", icona lucide-plus).
    await page.locator('button:has(svg.lucide-plus)').first().click();
    const form = page.locator('form');
    await expect(form).toBeVisible();

    // Compila: azienda + tipo (select in ordine DOM) + file.
    await form.locator('select').nth(0).selectOption(AZIENDA_ID);
    await form.locator('select').nth(1).selectOption(TIPO_ID);
    await form.locator('input[type="file"]').setInputFiles({
      name: 'upload.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 upload e2e'),
    });

    await form.locator('button[type="submit"]').click();

    // 2 POST /documenti: 1° 401 + retry 200.
    await expect.poll(() => c.uploadContentTypes.length, { timeout: 20_000 }).toBe(2);
    expect(c.refresh).toBeGreaterThanOrEqual(1);

    // Entrambi i tentativi restano multipart/form-data con boundary generato dal
    // browser: nessun Content-Type manuale (che romperebbe il parsing lato BE).
    for (const ct of c.uploadContentTypes) {
      expect(ct).toContain('multipart/form-data');
      expect(ct).toContain('boundary=');
    }
    expect(c.uploadContentTypes).not.toContain('application/json');

    // Upload riuscito → il form si chiude (uploading=false + reload lista).
    await expect(form).toBeHidden({ timeout: 10_000 });
  });

  test('refresh fallito → nessun loop, la pagina non crasha', async ({ page }) => {
    const c = await installRoutes(page, { refresh: 'fail' });
    await seedAuth(page);
    await gotoDocumenti(page);

    await page.locator('button:has(svg.lucide-download)').first().click();

    // Il refresh è tentato e fallisce (→ clearTokens); nessun retry infinito.
    await expect.poll(() => c.refresh, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    expect(c.download).toBeLessThanOrEqual(2);

    // Refresh fallito → i token sono ripuliti (logout pulito), non un crash JS.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('gestionale_access_token')), {
        timeout: 10_000,
      })
      .toBeNull();
    // La pagina è ancora viva (documento renderizzato o redirect a login, mai overlay di errore).
    await expect(page.locator('body')).toBeVisible();
  });
});
