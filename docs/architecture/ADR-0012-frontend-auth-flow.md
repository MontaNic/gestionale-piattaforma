# ADR-0012 — Frontend auth flow (E2)

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0008](./ADR-0008-auth-module.md) (auth backend D2a/D2b), [ADR-0011](./ADR-0011-dual-package-strategy-and-nextjs-scaffold.md) (Next.js scaffold E1)

## ✅ Status finale

**E2 completato: primo login browser end-to-end funzionante a `:3001/login`.**

- Stack: Next.js 15 App Router + React 18.3 + Tailwind 3.4 + shadcn/ui (form, input, label, card, alert)
- Flow: `/login` (form RHF+zod) → `POST /auth/login` con `X-Tenant-Slug: demo` → localStorage JWT → `/dashboard` (GET `/me`) → render `Welcome <firstName> <lastName>` + 32 permessi + logout
- Logout: `clearTokens()` local + `router.replace('/login')` (anti-pattern client-only — TD-6 sotto)
- Auto-redirect `/` → `/login` o `/dashboard` basato su auth state (localStorage check)
- 3 pages, 3 lib (`api.ts` + `auth.ts` + `types.ts`), 5 shadcn components installati via CLI
- Smoke browser **9/9 PASS** (Nicolò manuale, screenshot Welcome Admin Demo verificato)
- Backend zero regression: 8/8 Vitest + 7/7 smoke RLS + typecheck 4/4 + lint clean
- **Bug fix collaterale E2 (F3)**: CORS abilitato sul backend NestJS (`app.enableCors`) — gap esposto dal primo client browser-based
- **TD-6 risolto 2026-05-13** (in questa PR): `handleLogout` ora chiama `POST /auth/logout` PRE `clearTokens()`, session backend correttamente revocata (`is_active=false`) invece di restare orphan fino a JWT expiry.

## Context

Pre-E2: stack completo ma disconnesso. Backend [`apps/api`](../../apps/api/) :3000 con 10 endpoint funzionanti ([ADR-0008](./ADR-0008-auth-module.md) D2a/D2b + [ADR-0010](./ADR-0010-tenant-bootstrap.md) D4). Frontend [`apps/web`](../../apps/web/) :3001 con scaffold E1 ([ADR-0011](./ADR-0011-dual-package-strategy-and-nextjs-scaffold.md)) = homepage statica + Button shadcn. **Nessuna chiamata HTTP attraversava i due workspace**.

E2 è il primo macro-task end-to-end frontend↔API. Obiettivo: utente apre `:3001` → form login → JWT → dashboard "Welcome <firstName>". Primo "vero" flow utente del progetto.

Quattro decisioni stack chieste pre-E2:

1. JWT storage (localStorage vs httpOnly cookie)
2. Form validation library
3. Tenant slug resolution (hardcoded vs subdomain/path detection)
4. Pages structure + redirect logic

Più due decisioni emerse in fase:

5. Token refresh strategy (auto-refresh vs no refresh)
6. shadcn install path (CLI vs manual scaffold come E1 F4)

## Decisions

### 1. JWT storage: `localStorage` (NO httpOnly cookie)

`apps/web/src/lib/auth.ts` espone 5 funzioni che gestiscono i due token (access + refresh) in `localStorage` con keys `gestionale_access_token` + `gestionale_refresh_token`. SSR guard (`if (typeof window === 'undefined') return null`) su tutte le funzioni stateful per safe build/SSR di Next.js.

**Razionale (pragmatic over secure)**:

- Setup zero-config: `localStorage.setItem` / `getItem` in 30 LOC totali, no backend cookie middleware, no CSRF endpoint
- httpOnly cookie + CSRF richiederebbe: `@nestjs/passport-cookie` config, `SameSite=Strict` + CORS `credentials: true`, CSRF token endpoint, fetch `credentials: 'include'` ovunque — **~1.5h extra in E2 scope**
- Progetto **NOT production**: gioco/apprendimento. Tech debt esplicito > complessità setup
- XSS surface accettata: `apps/web` non monta script third-party, no `dangerouslySetInnerHTML`, CSP futuro mitigherà

**Anti-pattern riconosciuto**, tracked **TD-1** sotto.

### 2. Form validation: `react-hook-form` + `zod`

- `react-hook-form@7.75.0`: peer dep di shadcn `Form` component (CLI install ha auto-installato)
- `zod@4.4.3` + `@hookform/resolvers@5.2.2`: type-safe schema + `z.infer<typeof schema>` per inferenza FormValues automatica

Pattern `loginSchema = z.object({ email: z.string().email('Email non valida'), password: z.string().min(8, 'Password troppo corta (min 8 caratteri)') })` → `useForm({ resolver: zodResolver(loginSchema) })`. Validazione client-side + messaggi i18n IT. Server-side validation duplicata in [`apps/api/src/auth/dto/login.dto.ts`](../../apps/api/src/auth/dto/login.dto.ts) via class-validator (defense in depth).

**Versioni installate più recenti del prompt iniziale ma API invariata**:

- Prompt indicava `zod@^3.24` + `@hookform/resolvers@^3.10`
- CLI ha installato `zod@^4.4.3` + `@hookform/resolvers@^5.2.2`
- Pattern usato (`z.string().email()`, `z.string().min()`, `z.object()`, `z.infer<>`) è invariato tra zod 3 e 4 → zero issue typecheck/runtime osservata

### 3. Tenant slug: `'demo'` hardcoded in frontend

```typescript
// apps/web/src/app/login/page.tsx
// TODO: multi-tenant routing in future macro-task (subdomain/path detection)
const TENANT_SLUG = 'demo';
```

Header `X-Tenant-Slug: demo` passato via `apiPost('/auth/login', values, { 'X-Tenant-Slug': TENANT_SLUG })`. E2 è single-tenant flow di scope contenuto (un solo tenant `demo` seedato). Comment esplicito su soluzioni future.

**Tracked TD-2** sotto. Opzioni future: subdomain detection (`demo.gestionale.local`), path-based (`/t/demo/login`), query param.

### 4. Pages structure: `/login` + `/dashboard` + `/` redirect (tutti client-side)

- `apps/web/src/app/login/page.tsx`: form login
- `apps/web/src/app/dashboard/page.tsx`: GET `/me` + render profile
- `apps/web/src/app/page.tsx`: replace dell'homepage E1 con redirect basato su auth state

Tutti e 3 con `'use client'` directive. Server Components inadatti (servono `useState`, `useEffect`, `useRouter`, `localStorage`). `router.replace('/login' | '/dashboard')` (NON `push`) per il root `/` redirect → no history pollution.

`router.replace` anche per logout: `clearTokens()` + `router.replace('/login')`. L'utente che clicca "Esci" non dovrebbe poter tornare indietro a `/dashboard` con browser back (sarebbe stato vuoto di token, redirect loop alla peggio).

### 5. No auto-refresh token

Access token scade dopo **15 minuti** (`expiresIn: 900` da [`auth.service.ts`](../../apps/api/src/auth/auth.service.ts)). Refresh token disponibile (7 giorni con rotation) ma E2 **NON implementa** auto-refresh prima della scadenza.

- Pattern: se token expired, `/me` ritorna 401 → `apiGet` throw `ApiError(status: 401)` → dashboard catch → `clearTokens()` + `router.replace('/login')` → user re-login
- UX cost: durante uso continuo (>15min su una stessa pagina), prima azione post-scadenza fa redirect → friction
- Trade-off accettato per E2: pattern logout naturale invece di refresh in background

**Tracked TD-3** sotto.

### 6. shadcn install: CLI `add` (con `printf "N\n"` workaround interactive)

E1 F4 aveva scoperto che `shadcn@latest init` injecta T4 pollution → manual scaffold 5 file. E2 ha tentato CLI `add` (NON `init`) e funzionato:

```bash
printf "N\n" | pnpm dlx shadcn@latest add form input label card alert
```

- `add` rispetta `components.json` esistente (style `default`, baseColor `slate`, cssVariables) creato in E1
- NO pollution: zero `oklch()`, zero `@base-ui/react`, React resta 18.3.1, deps T3-compat
- Prompt `button.tsx already exists, overwrite?` (form dipende da button) → answer `N` via stdin per preservare versione E1

**Pattern senior consolidato**: `init` rompe (E1 F4), `add` rispetta config esistente (E2). Tracked discovery **non come tech debt** ma come known-good pattern.

## Discoveries E2 (4 finding empirici)

### F1 — Limitazione testing Claude Code remoto (no browser headless)

Server SSH (Hetzner) non ha Chromium/Playwright/Puppeteer installato (`which chromium google-chrome playwright` → empty). Validazione client-side React (zod + react-hook-form) richiede esecuzione JS in V8 browser-side, quindi Claude Code **non può** verificare empiricamente i 4 test validation (email vuota, email "abc", password "1234", submit success/fail).

**Trade-off in E2**:

- Server-side render verificato via curl (`HTTP 200` + token "Accedi a Gestionale", "Caricamento...", "Reindirizzamento..." in HTML)
- Bundle compile zero error verificato via Next.js log
- Pattern matching letterale con docs `ui.shadcn.com` Form+Zod example
- 9/9 smoke browser **delegati a Nicolò** su Mac (con login admin@demo.local screenshot)

**Tracked TD-4**: setup Playwright per test E2E CI.

### F2 — shadcn CLI output non passa monorepo lint strict ⭐

`apps/web/src/components/ui/form.tsx` generato dalla CLI conteneva:

```typescript
import * as LabelPrimitive from '@radix-ui/react-label';
```

Usato solo come type position (`React.ElementRef<typeof LabelPrimitive.Root>`). La root `eslint.config.js` ha `@typescript-eslint/consistent-type-imports: error` → lint fail (catturato a STOP 5, dopo che typecheck era passato).

**Fix**: 1 carattere — `import type * as LabelPrimitive`. Zero impatto runtime, lint clean.

**Pattern senior**: catturato dal gate di lint a Fase 5 (non da typecheck). Lesson: file generated-by-tool non bypassano i gate, vengono validati. **Tracked TD-5**: ogni nuovo `shadcn add` → verify lint immediato.

### F3 — CORS missing in NestJS backend ⭐⭐⭐ CRITICAL

**Sintomo** (DevTools console Nicolò, primo tentativo login da browser):

```
Access to fetch at 'http://localhost:3000/api/v1/auth/login' from origin
'http://localhost:3001' has been blocked by CORS policy: Response to
preflight request doesn't pass access control check: No
'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Root cause**: il backend NestJS **non aveva mai abilitato CORS**. Tutti gli endpoint precedenti (D2a/D2b/D3a/D3b/D4) erano stati testati esclusivamente via `curl`, che NON enforcing Origin/preflight. E2 è il **primo client browser-based** del progetto → browser invia preflight OPTIONS → backend non risponde con header CORS → `net::ERR_FAILED`.

**Causa latency**: pattern "test only-via-curl" durante 4 macro-task auth/RLS/tenant ha mascherato il gap. **Lesson generalizzabile**: ogni nuovo "tipo di client" (browser, mobile native, third-party SDK) può rivelare gap latenti del backend non visibili dal client precedente. Ricontrollare il contract surface ad ogni introduzione client class.

**Fix** ([`apps/api/src/main.ts`](../../apps/api/src/main.ts), 5 LOC funzionali + 5 commento):

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
  credentials: true,
});
```

- `origin` SPECIFIC (no wildcard `*`): security best practice
- env var `CORS_ORIGIN` configurabile per multi-env (dev/staging/prod)
- Fallback `http://localhost:3001` per dev experience zero-config
- `credentials: true` preparato per future migration localStorage → httpOnly cookie (TD-1)

**Verifica empirica curl OPTIONS preflight**:

```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:3001
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Headers: Content-Type,X-Tenant-Slug
```

Post-fix: 9/9 smoke browser PASS.

`.env.example` aggiornato con sezione CORS dedicata (default `http://localhost:3001`, commenti su multi-origin futuro per apps/kds).

### F4 — Cross-platform browser shortcuts (test 8 minor)

Prompt iniziale parlava di `F5` per refresh nei test 8/9. Nicolò usa Mac → `Cmd+R` corretto. Memo: documentazione futura test browser deve includere shortcut Mac/Windows/Linux distinti. Non un bug, solo specifica imprecisa.

## Considered Alternatives

| Alternativa                          | Esito            | Razionale                                                                                                                                                        |
| ------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **httpOnly cookie + CSRF**           | Rejected per ora | Setup `@nestjs/passport-cookie` + CSRF endpoint + `credentials: 'include'` ovunque = ~1.5h. Scope E2 ridotto, tech debt esplicito TD-1.                          |
| **sessionStorage**                   | Rejected         | Stesso XSS surface di localStorage, UX worse (logout su tab close inevitabile, no "Remember me").                                                                |
| **formik + yup**                     | Rejected         | Ecosystem in deprecating (formik manutenzione rallentata). shadcn `Form` component richiede peer dep `react-hook-form`. Switch dopo introduzione gratis.         |
| **Validation manuale `useState`**    | Rejected         | Anti-pattern: ri-implementare regex email + lunghezza password + error state + clear on change. RHF+zod gratis con shadcn.                                       |
| **Subdomain tenant routing**         | Rejected per ora | Richiederebbe `/etc/hosts` setup locale (`demo.gestionale.local`) + Next.js middleware subdomain detection. Scope E2 contenuto a single-tenant. Tracked TD-2.    |
| **Form tenant slug field**           | Rejected         | UX worse (utente non dovrebbe conoscere il proprio tenant slug). Subdomain o path-based è il pattern industry-standard.                                          |
| **Auto-refresh token in background** | Rejected per ora | `setInterval(14min) → checkExpiry → POST /auth/refresh → setTokens`. ~1h implementation + edge case (tab inactive, multiple tabs, race condition). Tracked TD-3. |
| **shadcn init (E1 F4 retry)**        | Rejected         | E1 F4 ha provato `init`, T4 pollution. CLI `add` (con `printf "N\n"` per file esistenti) rispetta `components.json` E1. Confirmed E2.                            |
| **Server Component homepage (`/`)**  | Rejected         | `isAuthenticated()` legge `localStorage` (client-only). Server Component non può accedere localStorage. Client-side redirect via `useEffect` + `router.replace`. |

## Reversibility

| Scenario                                        | Costo                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rimozione completa `/login` + `/dashboard`      | ~5 min: `rm -rf apps/web/src/app/{login,dashboard}` + revert `apps/web/src/app/page.tsx` allo scaffold E1. lib/api.ts + lib/auth.ts + lib/types.ts orfani ma harmless (zero importer).                                                                     |
| Migration localStorage → httpOnly cookie        | ~1.5h: backend cookie middleware (`@nestjs/passport-cookie` o manual `res.cookie()` con SameSite=Strict) + CSRF endpoint + frontend `fetch(.., { credentials: 'include' })` + revert localStorage code. `credentials: true` già in CORS config (E2 ready). |
| Multi-tenant routing (subdomain o path)         | ~2h: Next.js middleware (`apps/web/src/middleware.ts`) subdomain detection + tenant slug come React Context propagato + revert hardcoded `TENANT_SLUG` const. Backend invariato (header `X-Tenant-Slug` già consumato).                                    |
| Migration React 18.3 → 19                       | ~1-2h (carry-over [ADR-0011 TD-2](./ADR-0011-dual-package-strategy-and-nextjs-scaffold.md#td-2-migration-react-183--19)). Nessun blocker E2 — useForm + shadcn primitives compat 19.                                                                       |
| Rimozione CORS (rollback main.ts)               | 30s ma rompe il frontend E2 → NON consigliato. Mantenibile solo se ci fosse decisione di disallineare web dev a non chiamare API (es. mock layer).                                                                                                         |
| Switch react-hook-form + zod → react-final-form | ~2-3h. Riscrittura `LoginPage` form binding + nuovo schema validation + retest. Beneficio incerto. Sconsigliato.                                                                                                                                           |

## Tech Debt Accepted

Sezione esplicita per non nascondere il debito tra altre note. Ogni voce ha trigger e stima rework. 6 voci (5 frontend + 1 backend carry-over scoperto in E2).

### TD-1: Migration `localStorage` → `httpOnly cookie`

**Cosa**: Access + refresh token in `localStorage` oggi. XSS surface accettata per scope E2.

**Trigger di re-evaluation**:

- ANY production deployment
- Introduction di feature sensitive (financial transactions, multi-user concurrent access, audit log read)
- Security review esterno

**Stima rework**: ~1.5h. Backend: cookie middleware + CSRF endpoint. Frontend: rimuovi `lib/auth.ts` localStorage code, sostituisci con `fetch(.., { credentials: 'include' })`. `credentials: true` già in CORS config (E2 ready, zero impatto cambio).

### TD-2: Multi-tenant tenant slug resolution — ✅ RESOLVED 2026-05-15 (sessione 9)

**Resolution**: pattern **path-based** scelto e implementato. Vedi sezione "TD-2 Resolution" sotto.

**~~Cosa~~** ~~(pre-resolution)~~: `TENANT_SLUG = 'demo'` hardcoded in `LoginPage`. Single-tenant flow.

**~~Trigger di re-evaluation~~**:

- ~~2° tenant deve loggarsi via browser (oggi solo `demo` seedato)~~
- ~~POST `/tenants` API ([D4](./ADR-0010-tenant-bootstrap.md)) consumato in produzione~~

**~~Stima rework~~**: ~~~1-2h~~ — **completato in ~1.5h sessione 9 post-B2 closure**. Opzioni considerate:

- ~~**Subdomain** (`demo.gestionale.local`, `acme.gestionale.local`)~~ — **Rejected**: richiede `/etc/hosts` config locale + DNS wildcard prod. Friction setup dev.
- ✅ **Path-based** (`/t/demo/login`, `/t/acme/login`) — **CHOSEN**: dynamic route segment Next.js 15 + middleware validation. Più semplice setup locale, no DNS config.
- ~~**Query param** (`/login?tenant=demo`)~~ — **Rejected**: UX worse, no bookmark friendly, slug invisibile nel breadcrumb.

### TD-3: Auto-refresh token prima della scadenza

**Cosa**: Access token scade dopo 15 min. Oggi user re-login forzato; preferibile auto-refresh in background.

**Trigger di re-evaluation**:

- Feedback UX "sessione scade durante uso" da test utente reali
- Sessione lunga prevedibile (es. dashboard analytics aperta tutto il pomeriggio)

**Stima rework**: ~1h. Pattern:

- `setInterval(14min) → checkExpiry → POST /auth/refresh → setTokens`
- Edge case: tab inactive (Page Visibility API), multiple tabs (BroadcastChannel sync), 401 mid-flight retry pattern
- Refresh endpoint già esiste ([D2a](./ADR-0008-auth-module.md)), JWT pair returned

### TD-4: Setup Playwright per test E2E frontend CI — ✅ RESOLVED 2026-05-15 (sessione 10)

**Cosa**: Oggi smoke browser 9/9 = manual run di Nicolò. Regression visiva non auto-caught su PR.

**Trigger di re-evaluation**:

- Prima regression visiva non catturata da test unit (es. shadcn upgrade rompe Card layout)
- 2° pagina critical aggiunta (es. POS cassa flow F1)

**Stima rework**: ~3-4h. Playwright install + browser binaries CI compatible + 5-10 test E2E (login flow, dashboard render, logout, validation messages) + GitHub Actions workflow integration. Beneficio: zero regression visiva auto-caught.

**Resolution** (2026-05-15, sessione 10, [ADR-0016](./ADR-0016-playwright-e2e-frontend-ci.md), PR #25):

- Playwright 1.60.0 installato (Chromium + Firefox + WebKit), config in `apps/web/playwright.config.ts`
- Multi-tenant fixture demo + acme via storage state pattern (`apps/web/e2e/auth.setup.ts`)
- 7 test E2E flow critici: routing (root + slug invalido), auth login (OK + fail), logout, anonymous redirect, cross-tenant isolation (documenta gap TD-7)
- CI integration: nuovo job `e2e-playwright` in `.github/workflows/ci.yml` (container Playwright + services Postgres/Redis/Mailpit)
- Test outcomes: Chromium 11/11 PASS in 9.4s + Firefox 5/5 PASS in 7.0s + WebKit 5/5 PASS in 7.2s
- 4 discoveries empiriche (#32-35) + 7 nuovi TD tracciati (TD-AJ → TD-AP)
- LOC: ~694 nuovi (446 Playwright/E2E + 248 ci.yml delta)
- Stima rework ~3-4h: rispettata (~4h effettivi, +30% per Discovery #35 emersa Fase 4.4)

### TD-5: shadcn CLI output cleanup pattern

**Cosa**: `shadcn@latest add` può generare file che violano lint rules monorepo (E2 F2: triple-slash style import non-type rispetto a rule `consistent-type-imports`).

**Trigger di re-evaluation**:

- Ogni nuovo component installato via `shadcn add`
- shadcn 5.x rilascia output cleanup pre-built

**Stima rework**: 5-10 min per component. Pattern: post-`add`, run `pnpm lint` immediato, fix `import type` / formatting / unused vars, commit. Memo CHANGELOG: tracciare quando shadcn fixa upstream questi pattern.

### TD-6 (backend): Logout server-side via `/auth/logout` — ✅ RESOLVED 2026-05-13

**Cosa carry-over discovery E2**: `apps/web/src/app/dashboard/page.tsx#handleLogout` fa solo `clearTokens()` local. NON chiama `POST /api/v1/auth/logout` per invalidare la session backend.

**Anti-pattern**: session resta `is_active: true` in DB → access token JWT continua a passare validate fino a scadenza naturale (15 min). Refresh token ruba-bile via DB compromise → theft scenario non mitigato.

**Trigger di re-evaluation**:

- Security audit
- Multi-device session management (vedi tutte le sessioni attive)
- Production deployment

**Stima rework**: ~30 min. Frontend: chiamata `apiPost` a `/auth/logout` con header `Authorization: Bearer <token>`, `.catch()` gracefully, e `clearTokens()` always-executed anche su error. Backend endpoint `/auth/logout` già esistente ([D2a](./ADR-0008-auth-module.md)).

**Resolution** (2026-05-13, in questa PR):

- Frontend: `apps/web/src/app/dashboard/page.tsx#handleLogout` ora async, chiama `apiPost<void>('/auth/logout', {}, {Authorization: Bearer <token>})` PRIMA di `clearTokens()` + `router.replace('/login')`
- Error handling: silent `console.warn` su fail, `clearTokens()` always-executed anche su error (Decision 1A architecture review)
- Loading state: `useState<boolean> isLoggingOut`, button `disabled={isLoggingOut}` + testo "Uscita..." durante apiPost (Decision 3A)
- Discovery collaterale: `apiPost` libreria non gestiva 204 No Content (`res.json()` su body vuoto → SyntaxError). Fix +3 LOC in `apps/web/src/lib/api.ts` con early-return `if (res.status === 204) return undefined as T`. Pattern riusabile per DELETE endpoint F1 futuri.
- Backend zero modifiche: endpoint `/auth/logout` già esistente da D2a (ADR-0008)
- LOC finali: 37 totali (+34 / -5) su 2 file. Stima rework ~30 min: rispettata.

### TD-2 Resolution — Multi-tenant slug routing path-based (2026-05-15, sessione 9 post-B2)

**Resolution highlights**:

- **Path-based routing**: `/t/<slug>/<page>` (es. `/t/demo/login`, `/t/acme/dashboard`)
- **Next.js 15 middleware** (`apps/web/src/middleware.ts`): edge-side slug validation + redirect logic
- **`useParams<{slug:string}>()`** in client components per slug runtime (App Router idiomatic)
- **`RequestOptions { tenantSlug?, accessToken? }`** interface tipizzata in `lib/api.ts` (pattern OAuth client + type completion F1+)
- **Backend INVARIATO**: header `X-Tenant-Slug` API contract preservato. Zero breaking change su `apps/api`.
- **Test 2° tenant abilitato**: `acme` (seedato D3b, `manager@acme.local / Manager123!`) ora loggabile via browser su `/t/acme/login`

**Decisioni implementative**:

- **Slug validation**: regex `^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$` + `RESERVED_SLUGS` Set hardcoded (`api`, `www`, `admin`, `system`, `app`, `public`, `static`, `health`, `auth`, `me`, `tenants`, `_next`, `favicon.ico`) — coerente con backend `FORBIDDEN_SLUGS` ([ADR-0010 D4](./ADR-0010-tenant-bootstrap.md)). Defense-in-depth: la validation backend resta primary, middleware fast-fail edge.
- **Root `/` → redirect `/t/demo/login`**: Server Component con `redirect()` next/navigation + middleware fallback. Default tenant dev hardcoded SOLO qui (non in pages).
- **Slug invalido/reserved → `/not-found`**: 307 redirect lato middleware, page `app/not-found.tsx` Next.js convention.
- **`useParams` typed generic `<{slug:string}>`**: middleware garantisce slug presente e validato upstream — il valore è safe-to-use sul client (no `null` check necessario nella signature).
- **`apiPost`/`apiGet` `RequestOptions`**: refactor da `Record<string,string>` raw a interface tipizzata. `tenantSlug` opzionale → header `X-Tenant-Slug`. `accessToken` opzionale → header `Authorization: Bearer`. Pattern security senior: no typo possibili su header name + Bearer prefix. Backward-compat break consciously: 3 call site esistenti migrati nello stesso atomic commit.
- **Refactor `page.tsx` root → Server Component**: era Client `useEffect + isAuthenticated()` check (E2 E1 pattern). Server `redirect()` è coerente con middleware-based routing e SSR-friendly (preview, prerender).

**Smoke verificati (server-side middleware logic via curl)**:

| #   | Scenario                                                                | Esito |
| --- | ----------------------------------------------------------------------- | ----- |
| 1   | `/` → 307 → `/t/demo/login`                                             | ✅    |
| 2   | `/t/demo/login` → 200 (page render)                                     | ✅    |
| 3   | `/t/acme/login` → 200 (slug valido)                                     | ✅    |
| 4   | `/t/INVALID-SLUG-FOO/login` → 307 → `/not-found` (uppercase fail regex) | ✅    |
| 5   | `/t/api/login` → 307 → `/not-found` (RESERVED_SLUG)                     | ✅    |
| 6   | `/t/admin/login` → 307 → `/not-found` (RESERVED_SLUG)                   | ✅    |
| 7   | `/not-found` → 404 (Next.js standard, render `app/not-found.tsx`)       | ✅    |

**Smoke browser interactive (delegati a Nicolò pre-merge)**:

1. Login `demo` tenant: `admin@demo.local / Admin123!` → redirect `/t/demo/dashboard` + Welcome "Admin Demo"
2. Login `acme` tenant: `manager@acme.local / Manager123!` → redirect `/t/acme/dashboard` + Welcome "Manager Acme"
3. Logout demo → redirect `/t/demo/login`
4. Session persistence: login demo → Cmd+R browser → resta loggato in `/t/demo/dashboard`
5. Cross-tenant token check: login demo + navigate `/t/acme/dashboard` → behavior osservato (atteso: dashboard render con dati demo perche' JWT contiene tenantId originale; UI mostra slug acme nell'URL ma identita' demo — UX edge case da decidere F1+, vedi TD futuro sotto)

**Discoveries empiriche (#31)**:

- **#31** — Next.js App Router dynamic segments `[slug]` richiedono single-quote shell escape per `mkdir`/`mv`/`git mv`/`ls`. Brackets unquoted vengono interpretati come glob pattern → `fatal: No such file or directory`. Pattern: `mkdir -p 'apps/web/src/app/t/[slug]'`. Trivial ma reviewer junior può perdere ~10 min su errore cryptic.

**Tech debt nuovo (1 minor)**:

- **TD-7** — Cross-tenant token UX edge: se user demo apre manualmente URL `/t/acme/dashboard`, la dashboard renderizza con dati demo (JWT contiene `tenantId=demo`, dashboard chiama `/me` che ritorna profile demo). Inconsistenza visiva: URL slug acme, dati demo. Fix opzioni F1+:
  - (a) Page-level check: leggere JWT `tenantId`, confrontare con `useParams().slug` lookup → mismatch → redirect `/t/<jwt-tenantSlug>/dashboard`
  - (b) Server Component dashboard con tenant lookup → 404 se mismatch
  - Stima ~30min. Low priority (richiede manual URL hack utente legittimo).

  **Update sessione 10** ([ADR-0016](./ADR-0016-playwright-e2e-frontend-ci.md)): comportamento ora documentato empiricamente via E2E `apps/web/e2e/specs/tenant-isolation.spec.ts` (test PASS sul gap attuale). Root cause confermato via API direct test: backend `tenant.middleware.ts:43` skippa cross-check se `req.user` post-JwtAuthGuard, `me.controller.ts` usa solo `user.id` da JWT. Fix candidato (1) preferito: Guard backend cross-check JWT.tenantId vs X-Tenant-Slug header (richiede frontend manda X-Tenant-Slug ANCHE post-auth). Quando fixato (es. Opzione 1), `tenant-isolation.spec.ts` diventa regression guard:
  - Assert attuale: `await expect(page).toHaveURL('/t/acme/dashboard')` + verifica email demo visibile
  - Assert post-fix: `await page.waitForURL(/\/t\/demo\/dashboard|\/t\/.*\/login/)` (redirect a tenant proprio O login)

#### Sessione 15 update — F1-shell side-effect (Discovery #50)

**Status:** GAP PARZIALMENTE MITIGATO lato UI, **BACKEND INVARIATO**.

##### Cosa è cambiato

F1-shell sessione 14 (PR #32) ha introdotto `AuthGate` + `AuthContext` client-side senza intento di chiudere TD-7. **Side-effect non intenzionale:**

- `AuthContext.loadProfile()` fetch `/me` (SENZA X-Tenant-Slug)
- Risposta contiene `tenantSlug` profilo (JWT subject)
- Cross-tenant access pattern `demo_storageState + /t/acme/dashboard`:
  - AuthContext popola state con dati demo
  - `AuthGate` valuta `isAuthenticated=true` → passa
  - Ma: durante navigation + render flow F1-shell, redirect implicito a `/t/acme/login`
    (meccanismo esatto da investigare in TD-7 fix completo)

##### Implicazioni

| Lato                | Stato post-F1-shell                                      | Note                                                             |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| UI browser          | **Mitigato** — redirect implicito a login del tenant URL | Side-effect AuthGate + AuthContext flow                          |
| Backend API diretto | **INVARIATO** — `/me` ignora slug URL                    | curl, client non-browser, mobile app future leggono cross-tenant |

##### Priority bump roadmap

TD-7 fix backend Guard cross-check JWT.tenantId vs X-Tenant-Slug header (defense-in-depth) **non è più cosmetico** ma **necessario** per chiusura completa gap su client non-browser (mobile app future, integrazioni API, security audit).

Stima: ~1h. Candidate sessione 16+ post Menu CRUD.

##### Spec regression guard

`apps/web/e2e/specs/tenant-isolation.spec.ts` riformulato sessione 15 (TD-BI fix in PR #35):

- Documenta nuovo comportamento UI (redirect implicito a `/t/{slug}/login`)
- Funge da regression guard contro futuri refactor F1-shell che potrebbero accidentalmente riaprire il gap UI

##### Refs

- Discovery #50 — F1-shell AuthGate cross-tenant redirect implicit (rivelato da PR #34 CI failure su stale spec sessione 14)
- TD-BI — fix stale spec (PR #35 cleanup follow-up)
- [ADR-0018](./ADR-0018-f1-shell-ui-foundation.md) §AuthContext + §AuthGate (F1-shell foundation)

#### Sessione 16 update — TD-7 RESOLVED (PR #36)

**Status:** ✅ **RESOLVED** 2026-05-20 via PR #36 (`feat/td-7-tenant-consistency-guard`).

##### Decisione (1A — TenantConsistencyGuard APP_GUARD globale)

Introdotto `TenantConsistencyGuard` `@Injectable()` registrato via `APP_GUARD` globale post-`JwtAuthGuard` pre-`PermissionsGuard` in `AppModule`. Chiude definitivamente gap defense-in-depth lato backend per client non-browser (curl, mobile app future, integrazioni API).

##### Logica Guard (5 branch detection)

1. **Skip `@Public`** (login, refresh, login-pin, root, health) — endpoint cross-tenant by-design
2. **Skip se `req.user` assente** — JwtAuthGuard ha già rejected o no JWT
3. **Skip se header `X-Tenant-Slug` assente** — backward-compat client legacy (comportamento attuale invariato)
4. **Lookup `tenantId` by slug** — cache Redis 60s TTL (RedisService riuso), fallback Postgres `withSystemContext`
5. **Mismatch detection** — confronta con `req.user.tenantId` (popolato da `JwtStrategy.validate()`):
   - Slug inesistente OR `tenantId` slug ≠ `tenantId` JWT → `throw new UnauthorizedException('E_AUTH_TENANT_MISMATCH')`
   - GlobalHttpExceptionFilter (sessione 15) intercetta e normalizza shape: `{statusCode: 401, errorCode: 'E_AUTH_TENANT_MISMATCH', message: ...}`

##### Implicazioni post-RESOLVED

| Lato                           | Stato post-PR #36                                                                                     | Note                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| UI browser                     | ✅ Mitigato (sessione 14 F1-shell AuthGate redirect implicito + sessione 16 backend lockdown layered) | Defense-in-depth completo                                                   |
| Backend API diretto            | ✅ **RESOLVED** — cross-tenant attempt → 401 `E_AUTH_TENANT_MISMATCH`                                 | curl, client non-browser, mobile app future, integrazioni API tutti coperti |
| Header `X-Tenant-Slug` assente | ✅ Backward-compat preservata (skip)                                                                  | Client legacy continuano a funzionare                                       |

##### Performance

- Cache Redis hit ~99% steady state (slug→id mapping immutabile)
- Cache miss: 1 Postgres query `SELECT id WHERE slug=$1` (indexed unique, <5ms)
- Cache TTL 60s razionale: bilancio refresh stale vs latency
- Cache invalidation immediata su soft-delete tenant: **NON implementato** (TD-BJ candidate)

##### Observability

- `Logger.warn` su 2 paths rifiuto: slug-not-found + cross-tenant mismatch
- `Logger.warn` su 2 paths fallback: Redis GET fail + Redis SET fail (resiliency: Redis down NON rompe auth)
- **TD-BK candidate:** promuovere `tenant_mismatch_attempt` ad audit log persistente (coerente pattern `permission_denied` PermissionsGuard)

##### Trade-off accettati

- **KISS inline lookup in Guard** (Pattern 29 + 5A KISS sessione 16): NO `TenantLookupService` extraction prematuro. Refactor solo quando 4° consumer compare (oggi 3: `tenant.middleware.ts`, `tenants.service.ts`, `tenant-consistency.guard.ts`)
- **Cache invalidation TTL-only 60s**: eventual consistency su soft-delete tenant. TD-BJ candidate per `DEL tenant:slug:${slug}` su endpoint "manage tenant lifecycle" futuro

##### Files modificati (PR #36)

- `apps/api/src/auth/guards/tenant-consistency.guard.ts` (NEW, 188 LOC)
- `apps/api/src/app.module.ts` (+7/-1, APP_GUARD registrazione post-JwtAuthGuard pre-PermissionsGuard)
- `apps/api/test/e2e/tenant-consistency.e2e-spec.ts` (NEW, 152 LOC, 5 scenarios E2E)
- `apps/web/src/lib/error-codes.ts` (+3, +E_AUTH_TENANT_REQUIRED +E_AUTH_TENANT_MISMATCH)

##### Discovery refs

- Discovery #50 (sessione 15) — F1-shell AuthGate cross-tenant redirect implicit (trigger TD-7 priority bump)
- **Discovery #51 candidate (sessione 16)** — Redis cache TTL persistence cross-test artifact: cache positiva TTL > test duration richiede flush selettivo `beforeEach` su test suite che muta dati cached. Test-only pattern (prod immutable UUID), convention test infra non TD. Fix applicato: `flushTenantSlugCache` helper in `beforeEach`
- Pattern 29 (Empirical re-scoping STOP 0) confermato: scope endpoint 2 reali (`/me`, `/tenants`) vs assumed N; APP_GUARD globale cattura automaticamente futuri controller
- Pattern 24 / Errore #20 prevention applicato 4x (DbService path, withSystemContext signature, error-codes structure, seed helpers split)

##### TD candidate emersi

- **TD-BJ** — Cache invalidation `DEL tenant:slug:${slug}` su endpoint manage tenant lifecycle futuro
- **TD-BK** — Audit log persistente `tenant_mismatch_attempt` (coerente pattern PermissionsGuard)

**Foundation per**: TD-H lockout key per-tenant (B1 ADR-0013 carry-over, ora sbloccato lato frontend) + future macro-task multi-tenant routing (tenant switching UI, tenant-aware command palette, ecc.).

## Consequences

### Positive

- **Primo flow end-to-end del progetto**: frontend↔API working, gate funzionale "utente può loggarsi" verde
- **9/9 smoke browser PASS**: form render, validation client+server-side, login success, dashboard /me con 32 permessi badge, refresh persistence, logout clean
- **Zero regression backend**: 8/8 Vitest + 7/7 smoke RLS + typecheck 4/4 + lint clean
- **CORS gap risolto**: bug latente dal D2a esposto e fixato in E2. Pattern testing browser-based ora baseline
- **6 tech debt esplicite**: trigger + stima rework per ognuna, visibility forte invece di lurking
- **4 discoveries empiriche documentate**: replicable per E3+ (limitazione testing remote, shadcn lint, CORS, cross-platform shortcuts)
- **Pattern senior**: empirical evidence > authority (types verificati via `curl /me` reale, non solo dal prompt iniziale)

### Negative / Trade-off

- **XSS surface accettata** (localStorage): tracked TD-1. Mitigations: no third-party script in `apps/web`, no `dangerouslySetInnerHTML`. CSP futuro.
- **~~Logout client-only~~** (RISOLTO TD-6 2026-05-13): logout ora chiama `POST /auth/logout` PRE clearTokens. Session backend correttamente revocata.
- **Single-tenant frontend**: tracked TD-2. Backend è già multi-tenant ready, gap è solo nel come frontend lo scopre.
- **No browser headless CI**: tracked TD-4. Mitigations: smoke manual Nicolò + screenshot verificato + 9/9 PASS documentati.

### Neutral

- **Versioni più recenti del prompt**: zod 4 + @hookform/resolvers 5 invece di zod 3 + resolvers 3. Zero issue, ma da menzionare per replicability.
- **CLI `add` vs E1 manual scaffold**: pattern shadcn divergent tra E1 (manual init) e E2 (CLI add). Razionale: `init` rompe, `add` rispetta config esistente. Documentato in Decision 6.

## Security considerations

**Pro E2**:

- Validation client-side (`zodResolver`) + server-side (`class-validator` DTO) → defense in depth
- No info leak su credentials wrong: backend ritorna stesso `E_AUTH_INVALID_CREDENTIALS` per email-not-found e wrong-password (ADR-0008 pattern)
- CORS specific origin (no wildcard `*`)
- `autoComplete="email"` + `autoComplete="current-password"` → password manager browser-native, riduce typo

**Contro E2** (tracked):

- localStorage XSS surface (TD-1)
- No logout server-side (TD-6)
- No rate limiting login attempts (carry-over [ADR-0008 tech debt](./ADR-0008-auth-module.md) — "Auth E2E hardening")
- No CSP headers Next.js (TD futuro post-deployment)

## Notes

- Versioni installate E2 (2026-05-13):
  - `react-hook-form@7.75.0`
  - `@hookform/resolvers@5.2.2`
  - `zod@4.4.3`
  - `@radix-ui/react-label@2.1.8`
  - `@radix-ui/react-slot@1.2.4` (bumped da `^1.1` E1 a `^1.2.4`)
- Stack invariato da E1: `next@15.5.18`, `react@18.3.1`, `react-dom@18.3.1`, `tailwindcss@3.4.19`
- Smoke browser 9/9 PASS (Mac, browser default Nicolò):
  1. `/` → redirect `/login` ✓
  2. Form login visibile (titolo + 2 input + bottone) ✓
  3. Email vuota → "Email non valida" ✓
  4. Email "abc" → "Email non valida" ✓
  5. Password "1234" → "Password troppo corta (min 8 caratteri)" ✓
  6. Wrong creds → "Email o password non corrette" ✓
  7. admin@demo.local + Admin123! → "Welcome Admin Demo" + 32 permessi (screenshot verificato) ✓
  8. Cmd+R su `/dashboard` → resta loggato ✓
  9. Logout → Cmd+R → `/login` (clean) ✓
- Curl OPTIONS preflight CORS post-fix F3 verified empiricamente (4 header attesi presenti: Allow-Origin, Allow-Credentials, Allow-Methods, Allow-Headers)
- 10 endpoint API invariati pre/post E2 (E2 non aggiunge endpoint; abilita CORS config cross-endpoint per il primo client browser-based)
