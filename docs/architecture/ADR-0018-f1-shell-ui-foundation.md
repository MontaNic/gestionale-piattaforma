# ADR-0018 — F1 shell UI foundation (Next.js shell + i18n + auth refactor)

- **Status:** Accepted
- **Date:** 2026-05-17 (sessione 14)
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0010](./ADR-0010-tenant-bootstrap.md) (tenant slug D4 + reserved list), [ADR-0011](./ADR-0011-dual-package-strategy-and-nextjs-scaffold.md) (Next.js scaffold E1), [ADR-0012](./ADR-0012-frontend-auth-flow.md) (frontend auth E2 + TD-1 + TD-2 + TD-6), [ADR-0016](./ADR-0016-playwright-e2e-frontend-ci.md) (Playwright fixture `auth.setup.ts` + TD-AY errorCode coverage), [ADR-0017](./ADR-0017-rbac-permissions-guard.md) (RBAC Guard + audit `entityType` convention)

## ✅ Status finale

**F1-shell completato sessione 14: foundation UI shell per future feature F1** (Menu, Mappa tavoli, Comande, Cassa, KDS, Report, Settings, Dashboard widget, AI Assistant).

- Stack: Next.js 15.5.18 App Router + React 18.3 + Tailwind 3.4 + shadcn/ui (8 componenti: alert, button, card, form, input, label + nuovi sheet, dropdown-menu, avatar) + `next-intl@4.12.0` + `next-themes@0.4.6`
- Pattern routing: `/t/<slug>/(authenticated)/<page>` (route group, URL invariate)
- Auth: AuthContext client-side fetch `/me` on mount + AuthGate redirect login (TD-BA migration path quando TD-1 httpOnly cookie risolto)
- i18n: next-intl `localePrefix: 'never'` (cookie `NEXT_LOCALE` reader, no segment locale URL)
- Theme: next-themes `attribute='class'` (light/dark/system) integrato con `darkMode: ['class']` Tailwind config
- Shell: Sidebar 240px fixed desktop (mobile drawer Sheet) + Topbar (logo + user dropdown con theme/locale/logout)
- 9 route registrate: `/`, `/_not-found`, `/api/set-locale`, `/t/[slug]/login`, `/t/[slug]/(authenticated)/{dashboard,menu,mappa,comande,cassa,kds,report,settings}`
- Playwright smoke shell: 3/3 PASS (riusa fixture `auth.setup.ts` storageState), non-regression 6/6 PASS auth-\* (target 9/9 in 9.9s)

## Context

Pre-sessione 14: macro-task E2 (ADR-0012) chiuso con login + dashboard funzionanti su `/t/[slug]/{login,dashboard}`. Logica auth inline in dashboard, no shell visuale (sidebar/topbar), no i18n, no theme toggle, no UI placeholder per future feature.

F1-shell è foundation per le 8 nav route F1. Out-of-scope: implementation feature business (solo "Coming soon" page per ogni nav target).

Verifica empirica preliminare (STOP 1) ha rivelato:

1. **Routing tenant-slug già stabilito** `/t/<slug>/<page>` (middleware esistente + ADR-0012 TD-2 resolution + ADR-0010 D4 reserved list) → impatto su strategy locale routing (vedi Sub-DP-A)
2. **AuthGate logic già inline** in `dashboard/page.tsx` (linee 25-50): refactor estrazione, non greenfield (Sub-DP-B)
3. **TD-6 logout pattern preservato**: POST `/auth/logout` PRIMA di `clearTokens()` per revocare session backend
4. **8 ADR esistenti**, ultimo `ADR-0017` → numerazione `ADR-0018` corretta
5. **Playwright suite 6 spec + setup project** con storageState per-tenant (`e2e/.auth/<slug>.json`) → riuso obbligatorio, no duplicate login flow

## Decisions

### DP-1 — UI library: shadcn/ui (continuity E2)

Confermo pattern install via `pnpm dlx shadcn@latest add <component>`. Aggiunti per F1-shell:

- `sheet` (mobile drawer Sidebar)
- `dropdown-menu` (Topbar user/theme/locale switcher)
- `avatar` (Topbar trigger con initials fallback)

Razionale: ecosistema gia' rodato in E2, peer deps Radix automatic (radix-dialog/dropdown-menu/avatar aggiunti come transitive), nessun lock-in pesante (componenti copiati in repo).

### DP-2 — Layout: Sidebar fissa sx + Topbar (mobile drawer)

Pattern desktop classico SaaS. **Desktop** (`md` breakpoint up): Sidebar fissa 240px (`w-60`) + Topbar `h-14` + main content scrollable. **Mobile** (`< md`): Sidebar collassata, hamburger trigger in Topbar apre Sheet drawer side-left.

Razionale: 8 nav items prevedibili (placeholder F1), familiar pattern restaurant-stakeholder. Densita' OK desktop, drawer mobile evita scroll orizzontale + svuota spazio per content business F1.

### DP-3 — i18n: next-intl@4.12.0 con `localePrefix: 'never'`

Selezionata vs alternative (`react-i18next`, `next-i18next`):

- Native App Router support (server + client components via plugin `createNextIntlPlugin`)
- Server-side message loading (no client bundle bloat per IT-only utente)
- TypeScript inferenza message keys
- ~2KB bundle size
- Async cookies API Next.js 15 supportata

Versione installata: **4.12.0** (latest npm verified empirically STOP 2, 2 giorni dalla release).

### DP-4 — Auth protection: client-side AuthGate + AuthContext

Coerente con **TD-1 (localStorage JWT) ancora pendente**: token NON server-readable, quindi auth check obbligatoriamente client-side.

Pattern: `AuthContext` fetch `/me` on mount → `AuthGate` `useEffect` redirect `/login` se `!isAuthenticated && !isLoading`. Loading state spinner (`data-testid="auth-gate-loading"`) per evitare flash unauthorized content.

**Migration path TD-BA**: quando TD-1 sara' risolto (httpOnly cookie), AuthGate sara' rimpiazzato da Next.js middleware server-side (302 prima del render, NO flash possibile, allineato con SSR boundaries).

### DP-5 — Smoke Playwright: happy path login → shell → logout

Estende suite esistente. Nuovo spec `e2e/specs/shell.spec.ts` con 3 test (86 LOC):

1. **Shell render** post-login: sidebar + topbar + welcome visibili
2. **Logout via topbar** user menu: clear `gestionale_access_token` + `gestionale_refresh_token` + redirect `/login`
3. **Unauthenticated** navigate to authenticated route: redirect `/login` (AuthGate guard)

**Riusa `auth.setup.ts` storageState project** (`e2e/.auth/<slug>.json`) — pattern `test.use({ storageState: path.join(import.meta.dirname, '..', '.auth', 'demo.json') })`. **NO duplicate login flow** (coerente con `tenant-isolation.spec.ts`).

---

## Sub-DP resolutions (verifica empirica STOP 1 + emersi runtime)

### Sub-DP-A — Locale routing: `localePrefix: 'never'` (cookie-based, no segment)

Routing esistente `/t/<slug>/<page>` (ADR-0012 TD-2) collide con segment `[locale]`. Alternative valutate:

- **A1** `/[locale]/t/[slug]/...` — locale outermost, SEO-friendly. **Rompe middleware regex + URL esistenti.**
- **A2** `/t/[slug]/[locale]/...` — URL awkward (`/t/demo/it/dashboard`).
- **A3** ✅ `localePrefix: 'never'` (cookie `NEXT_LOCALE`) — zero middleware rewrite, URL invariate, switcher cambia cookie via API route + `router.refresh()`.

**Decisione: A3.** F1 SaaS authenticated, no SEO multi-locale URL richiesto. Migration path TD-BB se F2 introduce public routes (menu pubblico ristorante, landing tenant) con esigenza SEO multi-locale.

### Sub-DP-B — AuthContext: refactor estrazione da dashboard inline

Logic auth (token reader + fetch `/me` + error 401 handling) gia' presente in `app/t/[slug]/dashboard/page.tsx` linee 25-50 (ADR-0012). **Refactor estrazione** (NON greenfield) preserva pattern TD-6 (POST `/auth/logout` PRIMA `clearTokens()`).

State shape esteso:

```ts
{
  user: MeUser | null,
  roles: MeRole[],
  permissions: string[],      // estende inline dashboard
  tenant: { slug: string },   // tenant boundary scope
  isAuthenticated: boolean,
  isLoading: boolean,
  error: string | null,
  logout: () => Promise<void>,
  refresh: () => Promise<void>,
}
```

### Sub-DP-C — Provider wrap: tenant-scoped + theme root-scoped

- **`AuthProvider`** in `app/t/[slug]/layout.tsx` (server component, `params: Promise<{slug}>` Next.js 15 async) → tenant boundary
- **`ThemeProvider`** in root `app/layout.tsx` (cross-tenant, user preference cookie next-themes) → multi-tenant theme persistence
- **`NextIntlClientProvider`** in `app/t/[slug]/layout.tsx` (insieme `AuthProvider`, server `getMessages()` request-scoped)

Razionale: cross-tenant future-safe (theme cookie persiste cambiando tenant), auth NON deve leak cross-tenant (multi-tab session-per-tenant). `<html lang="it" suppressHydrationWarning>` resta hardcoded — lang attribute build-time, no dinamico (next-themes mutation gestita via suppressHydrationWarning).

### Sub-DP-D — Route group `(authenticated)` introdotto

Separa pulitamente login pubblica (`/t/[slug]/login`) da shell autenticato (`/t/[slug]/(authenticated)/{dashboard,menu,...}`). URL invariate (route group `()` non si manifesta in URL). Dashboard `git mv` preserva history (STOP 6).

`(authenticated)/layout.tsx` minimal wrap (23 LOC): `<AuthGate><MainLayout>{children}</MainLayout></AuthGate>`. Tutte le 8 route placeholder ereditano gating + shell visuale.

### Sub-DP-E — Same-tab auth sync via `AUTH_CHANGE_EVENT` (emerso STOP 4 runtime)

**Root cause empirica (Discovery #45):** dopo refactor estrazione AuthContext, login flow falliva con redirect loop. `AuthProvider` montato su `[slug]/layout.tsx` persiste cross-route navigation client-side. Lo `storage` event nativo **NON triggera nel tab che chiama `setItem`** (browser spec: solo cross-tab). Quindi `isAuthenticated` restava stale `false` → AuthGate rediriguava indietro a `/login` → loop.

**Fix:** custom event bus decoupled in `lib/auth.ts`:

```ts
export const AUTH_CHANGE_EVENT = 'gestionale:auth-change';

function dispatchAuthChange(): void {
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

// setTokens/clearTokens dispatchano post-mutation
```

`AuthContext` ascolta `AUTH_CHANGE_EVENT` + `storage` event (cross-tab) → entrambi triggerano `loadProfile()`. Decoupled: login page non importa Context, fa solo `setTokens` con dispatch automatico. Pattern generalizzabile (future `usePermissionsChange`, `useTenantChange` possono riusare stesso event bus).

**Alternative scartate:**

- Login page chiama `useAuth().refresh()` dopo `setTokens` — accoppia login a Context (peggior decoupling)
- Polling localStorage in AuthContext — wasteful + lag
- `router.refresh()` post-setTokens — re-render RSC ma NON re-monta client components stessi

---

## Conventions

### Cookie naming: `NEXT_LOCALE`

Convention Next.js storica (Pages Router i18n). Rispettata anche con next-intl App Router (cookie name custom, doc next-intl usa `locale` come esempio ma non e' imposto). Razionale: piu' descrittivo cross-app, compatibilita' con tool/browser extension che riconoscono il name standard. **NON httpOnly** (UX cross-tab visibility tramite `document.cookie`).

### Middleware locale guard application strategy

`applyLocaleGuard()` chiamato solo su path **pass-through** (slug valid + pattern-no-match). Skip su `RedirectResponse` (root `/`, reserved slugs `/not-found`) perche' cookie set su response redirect e' no-op effettivo (browser non riusa response per next request stessa rotta). Pattern: validate locale cookie solo quando response prosegue verso pagina target.

### AuthContext strategy: client-side fetch `/me` on mount

Coerente con localStorage token reader TD-2 ADR-0012. Migration path additivo: quando TD-1 (httpOnly cookie) sara' risolto, aggiungere `initialUser` prop opzionale da Server Component layout per hydrate iniziale + skip fetch `/me` se hydrate present. Zero refactor logica esistente.

### Logout pattern (TD-6 preserved) — `lib/auth-logout.ts`

`performLogout()` shared helper (39 LOC):

```ts
const token = getAccessToken();
try {
  if (token) {
    await apiPost<void>('/auth/logout', {}, { accessToken: token });
  }
} catch (err) {
  if (err instanceof ApiError && err.status === 401) {
    // Token gia' invalido — clearTokens idempotente
  } else {
    console.warn('[logout] server-side failed', err);
  }
} finally {
  clearTokens();
}
```

`clearTokens()` SEMPRE eseguito (`finally`) anche su POST fail. `401` ignorato silenzioso (server non puo' revocare token gia' invalido, clearTokens idempotente).

### Shared `PlaceholderPage` component (anti-DRY refactor)

7 nav placeholder route F1 (menu/mappa/comande/cassa/kds/report/settings) usano shared component `components/shell/PlaceholderPage.tsx` (41 LOC) + 7 `page.tsx` 1-line ciascuna (5 LOC × 7 = 35 LOC totali, 875 B bundle uniforme per page).

Pattern: `<PlaceholderPage section="menu" />` legge `placeholder.{section}.{title,desc}` i18n + render Card con `data-testid={'placeholder-${section}'}`. Modifica futura (badge "in development", icona, link doc) propaga automatica a tutti i placeholder.

---

## Tech debt

### TD-BA — Auth protection client-side → middleware migration post-TD-1

`AuthGate` client-side e' workaround per TD-1 (localStorage JWT non server-readable). Quando TD-1 → httpOnly cookie, sostituire con Next.js middleware server-side (302 pre-render, NO flash unauthorized possibile, allineato con SSR boundaries). Stima: ~30min refactor + verifica E2E.

### TD-BB — i18n SEO multi-locale future F2

`localePrefix: 'never'` ottimo per F1 SaaS authenticated, ma F2 potrebbe introdurre public routes (menu pubblico ristorante, landing tenant) dove SEO multi-locale URL e' richiesto. Migration path: route group separato `(public)` con next-intl middleware routing standard (`localePrefix: 'as-needed'` o `'always'`), mantenere `(authenticated)` cookie-based. Stima: ~1h refactor + SEO meta tags.

### TD-BC — `/api/set-locale` senza rate limit

API route Next.js `app/api/set-locale/route.ts` (POST cookie set NEXT_LOCALE). Validation locale whitelist presente, no rate limit. Low-risk F1 (SaaS authenticated, no DoS vector realistico). Re-evaluation in F2 se public routes ammettono cookie set anonimo high-volume. Stima: ~20min `@nestjs/throttler` equivalent in Next.js API route.

### TD-BD — Webpack warnings next-intl extractor dynamic require

3 occorrenze warning in `pnpm build`: `next-intl extractor/format/index.js dynamic require cache invalidation tracking`. Issue noto upstream, no impatto runtime/bundle. Re-evaluation quando next-intl rilascia patch o quando migrating a Turbopack production-ready (Next.js 15+ feature flag).

Cattura preventiva utile: se in futuro un warning vero "annega" tra questi 3 noti, si evita normalizzazione cognitiva ("e' solo un altro warning") che maschera bug reali.

### TD-BE — `lib/error-codes.ts` mapping incompleto + parseError fallback chain

**Sub-1 RESOLVED in questa PR (STOP 8.5).** Frontend mapping esteso runtime verified:

- `apps/web/src/lib/api.ts:parseError` legge fallback chain `body.errorCode ?? body.code` (backend taxonomy inconsistente: `/auth/login` 401 usa `errorCode` TD-AJ PR 2; `/auth/login` 429 lockout TD-H usa `code` ADR-0013). Sintetizza `E_RATE_LIMITED` su `statusCode === 429` senza errorCode (ThrottlerException default NestJS no errorCode field).
- `apps/web/src/lib/error-codes.ts` +2 entry mapping IT (i18n-ready commento esistente):
  - `E_AUTH_ACCOUNT_LOCKED` → "Account temporaneamente bloccato per troppi tentativi falliti. Riprova tra qualche minuto."
  - `E_RATE_LIMITED` → "Troppe richieste. Attendi qualche istante e riprova."

Verifica empirica runtime STOP 8.5: alert "Troppe richieste" rendering correttamente in full suite Playwright quando backend ritorna 429 (era fallback generico "Si è verificato un errore" pre-fix).

**Sub-2 PENDING (cross-ref TD-AY sessione 15).** Full Playwright suite chromium (`pnpm test:e2e:ci`) flake **NON risolto** dal mapping UX. Root cause empirica: `THROTTLE_AUTH_LIMIT=5` per `/auth/login` con TTL 60s; test parallel (2 workers + 2 setup login + 4 auth-\* + tenant-isolation + 3 shell) saturano 5/min/IP cumulative → cascading 429 sui test che dipendono da fresh login (`auth-login` wrong-password, `auth-logout`, `tenant-isolation`).

Mitigation candidate sessione 15 (cross-ref TD-AY ADR-0016):

- (a) Bump `THROTTLE_AUTH_LIMIT` per env `NODE_ENV=test` o CI flag
- (b) `beforeAll` backoff in spec critici (60s sleep cumulative)
- (c) Throttler reset via Redis flush in setup project (anti-pattern: shared state mutation)
- (d) Unified errorCode taxonomy (TD-AY) + retry-on-429 in Playwright config

**Stima rimanente Sub-2:** ~30-45min test infra tuning (parte di TD-AY closure).

---

## Files

### Nuovi file (LOC effettivi, totale 1114 source+test)

| Path                                                                                                | LOC                  |
| --------------------------------------------------------------------------------------------------- | -------------------- |
| `apps/web/src/i18n/config.ts`                                                                       | 15                   |
| `apps/web/src/i18n/request.ts`                                                                      | 29                   |
| `apps/web/src/i18n/messages/it.json`                                                                | 76                   |
| `apps/web/src/i18n/messages/en.json`                                                                | 76                   |
| `apps/web/src/contexts/AuthContext.tsx`                                                             | 166                  |
| `apps/web/src/components/auth/AuthGate.tsx`                                                         | 48                   |
| `apps/web/src/components/shell/Sidebar.tsx`                                                         | 96                   |
| `apps/web/src/components/shell/Topbar.tsx`                                                          | 192                  |
| `apps/web/src/components/shell/MainLayout.tsx`                                                      | 26                   |
| `apps/web/src/components/shell/PlaceholderPage.tsx`                                                 | 41                   |
| `apps/web/src/components/ui/{avatar,dropdown-menu,sheet}.tsx`                                       | shadcn-cli generated |
| `apps/web/src/lib/auth-logout.ts`                                                                   | 39                   |
| `apps/web/src/app/api/set-locale/route.ts`                                                          | 46                   |
| `apps/web/src/app/t/[slug]/layout.tsx`                                                              | 34                   |
| `apps/web/src/app/t/[slug]/(authenticated)/layout.tsx`                                              | 25                   |
| `apps/web/src/app/t/[slug]/(authenticated)/dashboard/page.tsx` (moved + refactor)                   | 88                   |
| `apps/web/src/app/t/[slug]/(authenticated)/{menu,mappa,comande,cassa,kds,report,settings}/page.tsx` | 5 × 7 = 35           |
| `apps/web/e2e/specs/shell.spec.ts`                                                                  | 82                   |

### File modificati (delta LOC)

| Path                          | Δ LOC   | Cosa cambia                                                             |
| ----------------------------- | ------- | ----------------------------------------------------------------------- |
| `apps/web/src/app/layout.tsx` | +14     | ThemeProvider next-themes wrap + `suppressHydrationWarning`             |
| `apps/web/src/middleware.ts`  | +18     | Cookie `NEXT_LOCALE` validation (slug logic + reserved list preservate) |
| `apps/web/src/lib/auth.ts`    | +14     | `AUTH_CHANGE_EVENT` dispatch (Sub-DP-E fix)                             |
| `apps/web/next.config.mjs`    | +6      | `createNextIntlPlugin('./src/i18n/request.ts')` wrap                    |
| `apps/web/package.json`       | +5 deps | `next-intl@4.12.0`, `next-themes@0.4.6` + 3 peer deps shadcn            |

### Documentazione (questa PR)

| Path                                                   | LOC stimati                               |
| ------------------------------------------------------ | ----------------------------------------- |
| `docs/architecture/ADR-0018-f1-shell-ui-foundation.md` | 300 (questo file)                         |
| `PROGRESS.md`                                          | +80 (entry sessione 14 + counter 44 → 47) |
| `README.md`                                            | +10 (status bump F1 shell ✅)             |

---

## Discovery refs (PROGRESS.md sessione 14)

- **#45** — Same-tab auth sync via custom event (Sub-DP-E STOP 4). Storage event nativo cross-tab-only, custom event bus necessario per same-tab refactor estrazione Context da inline auth. Pattern decoupled (login page ignora Context, dispatch automatico in `lib/auth.ts`).
- **#46** — Dev server zombie post `pnpm build` parallelo (STOP 5). `.next/` artefatti misti + child `next-server` zombie post parent kill (EADDRINUSE silente). Mitigation: stop dev prima di build (`pkill -9 -f "next-server"` + `rm -rf .next`). Pattern preventivo confermato funzionante STOP 6.
- **#47** — Full Playwright suite flaky per TD-H lockout backend (STOP 7). Multipli login successivi `demo` (auth.setup + 4 auth-\* + tenant-isolation) saturano contatore lockout per-tenant. Fallback `messageForErrorCode` su errorCode non-mapped → cascading failures. Mitigation futura: TD-BE resolution. **NOT regression F1-shell** (pre-existing post-merge PR #29).

---

## Definition of Done F1-shell

- [x] Shell visuale completa: Sidebar 8 nav + Topbar + theme toggle + i18n switcher + mobile responsive
- [x] AuthContext + AuthGate refactor estrazione (pattern TD-6 preservato)
- [x] 8 route placeholder `(authenticated)/{dashboard,menu,...}` registrate
- [x] i18n cookie-based (it/en) con switcher funzionante
- [x] Build production OK in 7.2s (10 route registrate)
- [x] Smoke shell Playwright 3/3 PASS
- [x] Non-regression auth-\* 6/6 PASS (target 9-spec suite 9/9 in 9.9s)
- [x] ADR-0018 scritto con DP-1→DP-5 + Sub-DP A-E + 5 TD + 3 Discovery refs
- [x] PROGRESS.md aggiornato entry sessione 14
- [x] Screenshot manuale Nicolò light + dark + navigation: ✅ verificato STOP 6 post-implementation
- [x] No PII / no secret nei commit
- [ ] HEAD main avanzato + branch locale pulito (post-STOP 10)
