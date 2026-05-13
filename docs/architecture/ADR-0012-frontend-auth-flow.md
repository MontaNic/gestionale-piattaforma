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

## Context

Pre-E2: stack completo ma disconnesso. Backend [`apps/api`](../../apps/api/) :3000 con 11 endpoint funzionanti ([ADR-0008](./ADR-0008-auth-module.md) D2a/D2b + [ADR-0010](./ADR-0010-tenant-bootstrap.md) D4). Frontend [`apps/web`](../../apps/web/) :3001 con scaffold E1 ([ADR-0011](./ADR-0011-dual-package-strategy-and-nextjs-scaffold.md)) = homepage statica + Button shadcn. **Nessuna chiamata HTTP attraversava i due workspace**.

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

### TD-2: Multi-tenant tenant slug resolution

**Cosa**: `TENANT_SLUG = 'demo'` hardcoded in `LoginPage`. Single-tenant flow.

**Trigger di re-evaluation**:

- 2° tenant deve loggarsi via browser (oggi solo `demo` seedato)
- POST `/tenants` API ([D4](./ADR-0010-tenant-bootstrap.md)) consumato in produzione

**Stima rework**: ~1-2h. Opzioni:

- **Subdomain** (`demo.gestionale.local`, `acme.gestionale.local`): Next.js middleware estrae subdomain → tenant slug come Context. Production-grade ma richiede DNS wildcard config.
- **Path-based** (`/t/demo/login`, `/t/acme/login`): dynamic route segment `[tenantSlug]`. Più semplice per setup locale.
- **Query param** (`/login?tenant=demo`): rapido ma UX worse, no bookmark friendly.

### TD-3: Auto-refresh token prima della scadenza

**Cosa**: Access token scade dopo 15 min. Oggi user re-login forzato; preferibile auto-refresh in background.

**Trigger di re-evaluation**:

- Feedback UX "sessione scade durante uso" da test utente reali
- Sessione lunga prevedibile (es. dashboard analytics aperta tutto il pomeriggio)

**Stima rework**: ~1h. Pattern:

- `setInterval(14min) → checkExpiry → POST /auth/refresh → setTokens`
- Edge case: tab inactive (Page Visibility API), multiple tabs (BroadcastChannel sync), 401 mid-flight retry pattern
- Refresh endpoint già esiste ([D2a](./ADR-0008-auth-module.md)), JWT pair returned

### TD-4: Setup Playwright per test E2E frontend CI

**Cosa**: Oggi smoke browser 9/9 = manual run di Nicolò. Regression visiva non auto-caught su PR.

**Trigger di re-evaluation**:

- Prima regression visiva non catturata da test unit (es. shadcn upgrade rompe Card layout)
- 2° pagina critical aggiunta (es. POS cassa flow F1)

**Stima rework**: ~3-4h. Playwright install + browser binaries CI compatible + 5-10 test E2E (login flow, dashboard render, logout, validation messages) + GitHub Actions workflow integration. Beneficio: zero regression visiva auto-caught.

### TD-5: shadcn CLI output cleanup pattern

**Cosa**: `shadcn@latest add` può generare file che violano lint rules monorepo (E2 F2: triple-slash style import non-type rispetto a rule `consistent-type-imports`).

**Trigger di re-evaluation**:

- Ogni nuovo component installato via `shadcn add`
- shadcn 5.x rilascia output cleanup pre-built

**Stima rework**: 5-10 min per component. Pattern: post-`add`, run `pnpm lint` immediato, fix `import type` / formatting / unused vars, commit. Memo CHANGELOG: tracciare quando shadcn fixa upstream questi pattern.

### TD-6 (backend): Logout server-side via `/auth/logout`

**Cosa carry-over discovery E2**: `apps/web/src/app/dashboard/page.tsx#handleLogout` fa solo `clearTokens()` local. NON chiama `POST /api/v1/auth/logout` per invalidare la session backend.

**Anti-pattern**: session resta `is_active: true` in DB → access token JWT continua a passare validate fino a scadenza naturale (15 min). Refresh token ruba-bile via DB compromise → theft scenario non mitigato.

**Trigger di re-evaluation**:

- Security audit
- Multi-device session management (vedi tutte le sessioni attive)
- Production deployment

**Stima rework**: ~30 min. Frontend: `apiPost('/auth/logout', {}, { Authorization: \`Bearer ${token}\` })`con`.catch()`gracefully +`clearTokens()`always-executed (anche su error). Backend endpoint`/auth/logout` già esistente ([D2a](./ADR-0008-auth-module.md)).

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
- **Logout client-only**: tracked TD-6. Mitigations: session JWT scade comunque dopo 15 min, refresh rotation invalida vecchio refresh.
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
- 12 endpoint API totali oggi (10 pre-E2 + `/api/v1/auth/logout` già esistente ma non usato da frontend + CORS ora abilitato è cross-endpoint)
