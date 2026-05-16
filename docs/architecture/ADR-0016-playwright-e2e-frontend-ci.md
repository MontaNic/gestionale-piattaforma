# ADR-0016 — Setup Playwright E2E frontend CI (TD-4 resolution)

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Macro-task:** TD-4 ADR-0012 resolution (carry-over da sessione 7 / E2)
- **Predecessor:** [ADR-0012](./ADR-0012-frontend-auth-flow.md) (TD-2 multi-tenant + TD-4 tracking), [ADR-0015](./ADR-0015-auth-e2e-hardening-b2b.md) (E2E backend simmetrico Testcontainers)
- **Branch:** `feature/td-4-playwright-setup`

## ✅ Status finale

**TD-4 RESOLVED**: foundation E2E frontend completa dopo 4 sessioni (carry-over da sessione 7). Simmetria con backend B2b Testcontainers raggiunta: backend full-bootstrap E2E + frontend Playwright E2E = stack E2E end-to-end.

- **Playwright 1.60.0** (Chromium + Firefox + WebKit installati, browser binaries cached `~/.cache/ms-playwright`)
- **Multi-tenant fixture** demo + acme (entrambi seed `packages/db/prisma/seed.ts`) via storage state pattern Playwright official
- **7 test E2E flow critici**: root redirect, login OK, login fail, logout + token clear, anonymous redirect, slug invalido, cross-tenant isolation (documenta gap TD-7 ADR-0012)
- **CI integration**: nuovo job `e2e-playwright` in [.github/workflows/ci.yml](../../.github/workflows/ci.yml), container Playwright + services Postgres/Redis/Mailpit
- **Test totali**: Chromium 11/11 PASS in 9.4s (2 setup + 7 reali + 2 smoke) + Firefox 5/5 PASS in 7.0s + WebKit 5/5 PASS in 7.2s (smoke + login OK)
- **TD-7 ADR-0012 update**: cross-tenant token UX edge ora documentato empiricamente via `tenant-isolation.spec.ts` — test PASS sul comportamento attuale (gap), diventerà regression guard quando fixato

## Context

[ADR-0012 sessione 7 (E2)](./ADR-0012-frontend-auth-flow.md#td-4-setup-playwright-per-test-e2e-frontend-ci) tracciava TD-4 con i seguenti trigger di re-evaluation:

- Prima regression visiva non catturata da test unit (es. shadcn upgrade rompe Card layout)
- 2° pagina critical aggiunta (es. POS cassa flow F1)

Sessione 10 raggiunge entrambi gli aspetti pre-trigger:

1. **Foundation pre-F1**: ogni pagina CRUD futura beneficia di regression Playwright pre-esistente
2. **Simmetria E2E completa**: B2b sessione 9 ha aggiunto E2E full bootstrap backend con Testcontainers ([ADR-0015](./ADR-0015-auth-e2e-hardening-b2b.md)) — il frontend resta l'unico tier senza E2E
3. **TD-2 risolto sessione 9** (multi-tenant routing path-based, [ADR-0012 § TD-2 Resolution](./ADR-0012-frontend-auth-flow.md#td-2-resolution--multi-tenant-slug-routing-path-based-2026-05-15-sessione-9-post-b2)) sblocca test fixture multi-tenant reali demo+acme

## Decisions

5 decision points lockati STOP 1 sessione 10:

### DP1 — Framework: Playwright (vs Cypress, vs Vitest browser mode)

- **Playwright 1.60.0** scelto:
  - Multi-browser real (Chromium + Firefox + Safari WebKit — quest'ultimo critico Mac users, browser primario di Nicolò)
  - Trace viewer integrato per debug post-mortem CI failure (`trace: on-first-retry`)
  - Parallelism nativo (`fullyParallel: true` con workers configurable)
  - Microsoft maintained, stable 2025-2026
- Cypress scartato: 1 browser real (Chromium only senza Cypress Cloud), trace viewer paid feature
- Vitest browser mode scartato: ancora experimental, no Safari WebKit support

### DP2 — Multi-tenant fixture: demo + acme

- Entrambi seedati (`packages/db/prisma/seed.ts:479-507`): `admin@demo.local / Admin123!` + `manager@acme.local / Manager123!`
- 1 tenant solo non testa isolation cross-tenant — TD-2 raison d'être = multi-tenant
- Storage state per-tenant (`apps/web/e2e/.auth/<slug>.json`) generato in setup project, riusato in test "authenticated"

### DP3 — Test scope: 7 test flow critici

| #   | Scenario                                                            | File                       |
| --- | ------------------------------------------------------------------- | -------------------------- |
| 1   | Root `/` redirect → `/t/demo/login`                                 | `routing.spec.ts`          |
| 2   | Login OK demo via form UI → dashboard                               | `auth-login.spec.ts`       |
| 3   | Login fail (wrong password) → error visibile, no redirect           | `auth-login.spec.ts`       |
| 4   | Logout → token cleared + redirect login                             | `auth-logout.spec.ts`      |
| 5   | Anonymous access dashboard → redirect login                         | `auth-redirect.spec.ts`    |
| 6   | Slug malformato → `/not-found` page                                 | `routing.spec.ts`          |
| 7   | Cross-tenant: demo loggato → `/t/acme/dashboard` documenta gap TD-7 | `tenant-isolation.spec.ts` |

- Coverage foundation senza overkill — edge case rate limit/lockout già coperti server-side ([B1 ADR-0013](./ADR-0013-auth-e2e-hardening-b1.md) + [B2b ADR-0015](./ADR-0015-auth-e2e-hardening-b2b.md))

### DP4 — CI integration: job esteso in ci.yml, Chromium-only default

- Esteso `.github/workflows/ci.yml` esistente (no file separato) — single source of truth + riuso pattern setup (pnpm/Node/.nvmrc)
- Job `e2e-playwright` sequential a `checks` esistente (`needs: [checks]`) — fail-fast economy
- **Container action** `mcr.microsoft.com/playwright:v1.60.0-jammy` (pinned alla stessa versione client per evitare API drift) + services Docker Postgres 16 / Redis 7 / Mailpit v1.30
- **Chromium-only** in CI per default (1 browser = ~3-4min). Matrix Firefox/WebKit on-demand futuro via tag `@cross-browser` (TD-AM)

### DP5 — Auth pattern: storage state file per-tenant

- Setup project (`apps/web/e2e/auth.setup.ts`) esegue login UI real demo + acme → cattura `localStorage` tokens via `context.storageState({ path })`
- Test "authenticated" usano `test.use({ storageState: '.auth/<slug>.json' })` — login NON ripetuto
- Trade-off vs POM login in `beforeEach`: storage state riduce ~3s/test (no double login HTTP)
- Anti-pattern evitato: test che mutano sessione server-side (logout) NON usano storage state condiviso — Discovery #33 sotto

## Implementation

**Files chiave (~700 LOC totali sessione 10):**

| File                                          | LOC  | Scope                                                                              |
| --------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| `apps/web/playwright.config.ts`               | 70   | config base + 4 projects (setup + chromium/firefox/webkit) + dependencies + dotenv |
| `apps/web/e2e/auth.setup.ts`                  | 91   | setup project login real UI demo + acme → storage state                            |
| `apps/web/e2e/specs/routing.spec.ts`          | 42   | test #1 + #6                                                                       |
| `apps/web/e2e/specs/auth-login.spec.ts`       | 67   | test #2 + #3                                                                       |
| `apps/web/e2e/specs/auth-logout.spec.ts`      | 60   | test #4 (login UI inline, no storage state shared — Discovery #33)                 |
| `apps/web/e2e/specs/auth-redirect.spec.ts`    | 30   | test #5                                                                            |
| `apps/web/e2e/specs/tenant-isolation.spec.ts` | 56   | test #7 (documenta gap TD-7 ADR-0012)                                              |
| `apps/web/e2e/specs/smoke.spec.ts`            | 21   | sanity check minimo (carry-over STOP 1)                                            |
| `apps/web/.env.e2e.example`                   | 9    | template committato (`.env.e2e` gitignored)                                        |
| `.github/workflows/ci.yml` (delta)            | +248 | job `e2e-playwright` con container + services + 22 step                            |

**Pre-requisiti dev locale:**

- `pnpm exec playwright install` (browser binaries ~1.2GB in `~/.cache/ms-playwright`)
- `sudo pnpm exec playwright install-deps` (host system libs apt — Discovery #32)
- Stack dev up: `docker compose -f docker-compose.dev.yml up -d` + `pnpm dev` (background)
- `apps/web/.env.e2e` con credenziali seed (template `.env.e2e.example` committato)

**Run locale:**

```bash
cd apps/web
pnpm test:e2e:chromium   # default rapido
pnpm test:e2e:ui          # debug visivo (richiede port forward Mac)
pnpm test:e2e:report      # apri ultimo HTML report
```

## Empirical discoveries (4 in sessione 10 + 2 in PR 2 sessione 12 → 37 cumulative)

### Discovery #32 — Hetzner CPX32 Ubuntu 22.04 minimal manca host deps Playwright

**Macro-task:** STOP 1

**Pattern:** ogni nuovo tipo di tooling rivela gap latente (8° caso cumulative).

**Root cause:** browser binaries Chromium/Firefox/WebKit richiedono shared libraries (`libnspr4`, `libnss3`, `libxcb-*`, `libgtk-3-0`, `libasound2`, ecc.) NON presenti in Ubuntu 22.04 minimal image Hetzner.

**Fix dev:** `sudo pnpm exec playwright install-deps` (≈15-20 pacchetti apt, ~1-2min). Comando documenta automaticamente quali libs mancano.

**Fix CI:** container image `mcr.microsoft.com/playwright:v1.60.0-jammy` (deps + browsers pre-installati, evita install step ~2-3min).

**Lesson:** verifica host deps PRIMA di smoke run su server stripped-down. Dev su Mac maschera questo gap (macOS ha deps system-wide).

### Discovery #33 — Race condition logout su storage state condiviso

**Macro-task:** STOP 3

**Root cause:** test #4 logout chiamava `apiPost('/auth/logout')` che invalida server-side il JWT del `.auth/demo.json` condiviso. Test paralleli (workers=2) che riusavano lo stesso storage state ricevevano 401 da `/me` → redirect login → fail asserzioni dashboard.

**Empirical evidence:** test `tenant-isolation.spec.ts` PASS isolato (`--grep "Cross-tenant"`) ma FAIL in run completo → race condition con `auth-logout.spec.ts` parallel.

**Fix:** test che mutano sessione server-side (logout, password change, token revoke) fanno login UI inline con JWT usa-e-getta, NON usano storage state condiviso. Costo: +~1s per test (login UI), benefit: test self-contained.

**Pattern senior generalizzabile:** per qualsiasi suite E2E con auth shared state, identificare test che mutano server-side sessione e isolarli da pool storage state. Documentato come anti-pattern in commento `auth-logout.spec.ts`.

### Discovery #34 — WebKit `fill()` non triggera onChange su RHF controlled inputs `type="email"`

**Macro-task:** STOP 3 Fase 3.9 (cross-browser smoke)

**Root cause:** WebKit gestisce differentemente eventi `InputEvent` per `<input type="email">` con controlled React Hook Form binding. `page.locator(...).fill()` setta `value` DOM ma NON triggera React `onChange` → RHF `validate` marca "Email non valida" → submit blocked. Empirical snapshot DOM accessibility tree mostra email field `[active]` con placeholder ancora visibile, password field popolato correttamente.

**Curiosità:** stesso pattern shadcn Input + RHF Controller, ma `type="password"` funziona ovunque (probabilmente WebKit gestisce evento password differently per autofill manager).

**Fix:** sostituire `fill()` con `click() + pressSequentially()`:

```typescript
// Anti-pattern (FAIL su WebKit):
await page.locator('input[type="email"]').fill(email);

// Fix cross-browser-safe (single locator, reused):
const emailInput = page.locator('input[type="email"]');
await emailInput.click();
await emailInput.pressSequentially(email);
```

`pressSequentially` emette `keydown/keyup` per ogni char (~1ms/char), allineato a interazione utente reale → triggera React onChange. Applicato in `auth.setup.ts`, `auth-login.spec.ts`, `auth-logout.spec.ts` solo per email field.

**Lesson:** RHF controlled inputs su WebKit richiedono `pressSequentially` defensive default. Pattern documentato in `auth.setup.ts` commento inline + TD-AQ tracciato per ESLint custom rule preventiva.

### Discovery #35 — Migration role rotation con placeholder password richiede step CI dedicato

**Macro-task:** STOP 4 Fase 4.4 (CI workflow scrittura)

**Root cause:** Migration `20260513002159_create_app_role_and_grants` ([packages/db/prisma/migrations/](../../packages/db/prisma/migrations/20260513002159_create_app_role_and_grants/migration.sql)) crea role PostgreSQL `gestionale_app` (NOSUPERUSER, NOBYPASSRLS, runtime app role D3b RLS) con PLACEHOLDER password (`'PLACEHOLDER_MUST_BE_ROTATED'`). Header SQL commento documenta che developer dev deve eseguire manualmente `ALTER ROLE gestionale_app PASSWORD '$APP_DB_PASSWORD'` post-`migrate deploy`. In CI: nessun developer → backend NestJS fallisce avvio (Prisma connection con `DATABASE_URL=gestionale_app:<APP_DB_PASSWORD>@...` ottiene 28P01 password authentication failed).

**Fix CI:** 2 step dedicati post-`prisma migrate deploy`:

1. **Rotate gestionale_app role password**: `apt-get install postgresql-client` + `PGPASSWORD=<superuser> psql -h postgres -c "ALTER ROLE gestionale_app PASSWORD '<value>'"`
2. **Update .env with real DATABASE_URL (post-rotate)**: `sed -i` riscrive DATABASE_URL con password URL-encoded (`encodeURIComponent`) per essere safe su char speciali

**Lesson:** ogni "tipo di environment" (locale dev, CI ephemeral, prod) può rivelare gap di post-deploy steps non automatizzati. La migration in sé è correttamente immutabile (creazione role + grant); è la rotazione password post-deploy che richiede orchestration esterna. Migration con placeholder secret è anti-pattern medio-termine — TD-AP candidato production-blocker.

### Discovery #40 — Smoke server-side standalone NON necessario quando esiste infrastruttura E2E Testcontainers

**Macro-task:** PR 2 sessione 12 Fase 3 (TD-H smoke design)

**Pattern:** ogni nuovo task di smoke deve PRIMA verificare se esiste già infrastruttura E2E in repo (9° caso cumulative).

**Root cause:** prompt operativo PR 2 richiedeva `apps/api/scripts/smoke-pr2-td-h.ts` standalone (TS script con seedMinimal 2 tenant + curl-like HTTP). Discovery empirica: `apps/api/test/e2e/auth-login.e2e-spec.ts` esiste già con full NestJS bootstrap + Testcontainers Postgres + Redis + helper `seedMinimal` (B2b foundation). Creare script standalone duplica infra senza benefici.

**Fix:** estendere `auth-login.e2e-spec.ts` con Test 4 TD-H cross-tenant lockout isolation (3 fail demo → 4° fail 429 + 1 acme NOT 429). 1 sola infra di test, full stack realistico, isolamento garantito.

**Lesson:** la "build before buy" si applica anche ai test. Smoke = test di alto livello senza framework? No: smoke = scenario E2E che verifica un comportamento critico end-to-end. Se il framework E2E esiste già con la stessa fixture richiesta (containers, seed, bootstrap), USARLO è strettamente migliore di duplicare.

### Discovery #41 — `seedMinimal` E2E helper monolitico: estensione via helper sibling vs flag opzionale

**Macro-task:** PR 2 sessione 12 Fase 3 (TD-H test fixture extension)

**Root cause:** `seedMinimal` esistente seeda SOLO tenant `demo`. Test cross-tenant TD-H richiede 2° tenant `acme`. Opzioni di refactor: (A) aggiungere flag `seedMinimal(url, {withSecondTenant: true})` allargando signature, (B) creare `seedSecondTenant(url, opts?)` come helper sibling chiamabile DOPO `seedMinimal`.

**Decisione:** B — sibling helper. Vantaggi: backward-compat strict (3 callsite `seedMinimal()` esistenti intoccati), single-responsibility (`seedMinimal` = setup base, `seedSecondTenant` = additive extension), parametrizzazione email configurabile per shared-email DoS-proof scenarios (`{email: 'admin@demo.local'}` su entrambi i tenant). Reject A: signature creep + ritorno tipo Union `SeedResult | (SeedResult & {secondTenantId, ...})` rumoroso.

**Lesson:** per fixture helper di test, preferire **composition di helper piccoli** vs **god-helper parametrizzato**. Pattern già usato in `packages/db/scripts/smoke-rls-e2e.ts` (5 scenario `record(id, name, ...)` helpers indipendenti).

## TD-AJ resolution (PR 2 sessione 12)

**Data:** 2026-05-16  
**Branch:** `feat/pr2-td-h-td-aj-lockout-pertenant-errorcode`  
**Scope (DP3.1 lockato):** solo `/auth/login`. Coverage altri endpoint → **TD-AY** nuovo.

### Enum centralizzato + DTO shape

- `apps/api/src/common/error-codes.ts`: enum `AuthErrorCode.INVALID_CREDENTIALS = 'E_AUTH_INVALID_CREDENTIALS'` + `CommonErrorCode.UNKNOWN = 'E_UNKNOWN'`.
- `apps/api/src/auth/dto/auth-error-response.dto.ts`: interface `AuthErrorResponse {statusCode, errorCode, message, timestamp}`.
- `apps/api/src/auth/auth.service.ts`: helper `throwInvalidCredentials()` sostituisce 2 callsite `throw new UnauthorizedException('E_AUTH_INVALID_CREDENTIALS')` in `login()`.

### Frontend mapping table i18n-ready

- `apps/web/src/lib/error-codes.ts`: `ERROR_CODE_MESSAGES` table + `messageForErrorCode()` helper. Pattern i18n-ready (estensione futura via i18next/nestjs-i18n keep API stabile).
- `apps/web/src/app/t/[slug]/login/page.tsx`: refactor mapping inline → `messageForErrorCode(err.errorCode)`.

### Lesson learned: errorCode taxonomy via enum centralizzato

1. **Code-as-message è anti-pattern**: `throw new UnauthorizedException('E_AUTH_INVALID_CREDENTIALS')` mette il code nel campo `message`, costringendo il client a parsing keyword-based (rischio drift + impossibilità i18n).
2. **Shape body separation of concerns**: `statusCode` = HTTP semantica, `errorCode` = machine-readable per i18n, `message` = human-readable italian (UI fallback), `timestamp` = correlation client/server. 4 ruoli distinti, ogni field ha 1 motivo per cambiare.
3. **Scope confinato (DP3.1)** > **scope creep**: TD-AY tracerà coverage altri 401. Filter globale che intercetta TUTTE le HttpException + aggiunge `errorCode`+`timestamp` è tentazione naturale ma scope creep (impatti larger blast radius).
4. **Lockout filter usa `code`, login userà `errorCode`** (Discovery #20 di B1): coesistenza temporanea accettata. TD-AY uniformerà.

## Considered Alternatives

| Alternativa                                                 | Scartata perché                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cypress (vs Playwright)                                     | 1 browser real free tier, trace viewer paid feature, no WebKit support  |
| Vitest browser mode                                         | Ancora experimental, no Safari WebKit                                   |
| Workflow CI separato `e2e.yml`                              | Duplicazione pattern setup (Node/pnpm/cache), no fail-fast su `checks`  |
| `runs-on: ubuntu-latest` + `playwright install --with-deps` | +2-3min CI per run vs container image pre-baked                         |
| Storage state UNICO condiviso per logout test               | Race condition Discovery #33 → scarted                                  |
| Page Object Model                                           | Overkill per 7 test foundation — TD-AO candidato quando suite > 15 test |
| Fixture mock `/me` API                                      | Vorremmo testare anche cross-tenant comportamento reale (TD-7 evidence) |

## Reversibility

Costo rollback: ~30min totali (rimozione `apps/web/e2e/` + `playwright.config.ts` + scripts package.json + `.env.e2e*` + job CI). Foundation pulita, no entanglement con domain code (test leggono solo, no DB mutation).

Reversibilità parziale (es. rimuovere solo CI job, mantenere test locale): ~5min (rimuove sezione `e2e-playwright` da ci.yml).

## Tech Debt registrato (8 — 1 update + 7 nuovi)

### TD-7 ADR-0012 (update sessione 10)

**Update**: cross-tenant token UX edge ora ha empirical evidence solida via E2E `apps/web/e2e/specs/tenant-isolation.spec.ts`. Comportamento documentato:

- Demo user loggato naviga `/t/acme/dashboard` → URL mantenuto, dashboard mostra dati **demo** (firstName/lastName/email)
- Backend `tenant.middleware.ts:43` skippa cross-check se `req.user` presente (post-JwtAuthGuard). `me.controller.ts` usa solo `user.id` da JWT, ignora slug URL
- Frontend `apiGet('/me')` NON passa `tenantSlug` post-auth → backend ritorna profilo JWT subject

Fix candidati (in ordine di preferenza):

- **(1) Guard backend cross-check JWT.tenantId vs X-Tenant-Slug**: frontend manda X-Tenant-Slug ANCHE post-auth, backend Guard `@CrossTenantCheck` Decorator 403 se mismatch. Pulito ma richiede modifica `apiGet`/`apiPost` callers
- **(2) Frontend useEffect verifica `/me.tenantSlug` vs `useParams.slug`**: lookup tenant via `/me` payload, mismatch → `clearTokens() + router.replace('/t/<jwt-slug>/dashboard')`. Più semplice ma client-side
- Priorità: media (security implicit, non sfruttabile via API direct ma rotto UX)

### TD nuovi ADR-0016

| TD                     | Descrizione                                                                                                                                                                                                                                                                                                                                                    | Priorità                   | Stima            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------- |
| ~~TD-AJ~~              | ~~Backend `errorCode` esplicito in 401 response~~ — **RESOLVED PR 2 sessione 12** ([feat/pr2-td-h-td-aj-lockout-pertenant-errorcode](#td-aj-resolution-pr-2)). Backend emette shape `{statusCode, errorCode, message, timestamp}`; frontend rende stringa italian-localized "Email o password non corrette" via mapping table i18n-ready.                      | ✅ DONE                    | ~20min effettivi |
| **TD-AY** (nuovo PR 2) | Coverage `errorCode` altri 401 endpoint (`/auth/refresh`, `/auth/logout`, `/auth/login-pin`, `/auth/pin-setup`). Oggi DP3.1 scope ha coperto solo `/auth/login`; gli altri lanciano `UnauthorizedException(code-as-message)` con shape NestJS default (no `errorCode` field). Frontend mapping `messageForErrorCode` ricade su `E_UNKNOWN` per quegli endpoint | Bassa (UX cosmetica)       | ~30min           |
| TD-AK                  | Script `pnpm test:e2e:reset` wrapper con Redis FLUSHDB pre-test (evita rate limit accumulation cross-run, oggi manuale via `docker exec`)                                                                                                                                                                                                                      | Bassa                      | ~10min           |
| TD-AL                  | Cache Playwright browsers in CI (`actions/cache@v4` su `~/.cache/ms-playwright`) — solo necessario se passiamo a `runs-on: ubuntu-latest` (matrix cross-browser TD-AM)                                                                                                                                                                                         | Bassa                      | ~15min           |
| TD-AM                  | Matrix Firefox/WebKit opt-in CI via tag `@cross-browser` su test selettivi — oggi Chromium-only default                                                                                                                                                                                                                                                        | Bassa                      | ~30min           |
| TD-AN                  | `JWT_SECRET_CI` da `secrets.*` GitHub invece di inline test-only (riduce noise SAST scan + impedisce copy-paste accidentale)                                                                                                                                                                                                                                   | Bassa                      | ~10min           |
| TD-AO                  | Page Object Model refactor selettori inline (quando suite > 15 test)                                                                                                                                                                                                                                                                                           | Bassa                      | 1-2h             |
| TD-AP                  | Migration role rotation automation (Vault/Doppler post-prod) — sostituisce PLACEHOLDER password manual rotation Discovery #35. Anti-pattern medio-termine                                                                                                                                                                                                      | Media (production-blocker) | 4-6h             |
| TD-AQ                  | ESLint custom rule `no-playwright-fill-on-email-rhf` per prevenire regression Discovery #34 (RHF email + WebKit `fill()` non triggera onChange). Trigger: 3+ test file con pattern email RHF                                                                                                                                                                   | Bassa                      | ~30min           |
| TD-AR                  | Pattern `.pgpass` file per `psql` in CI quando si introdurrà secret reale (sostituisce `PGPASSWORD='${{ env.X }}'` plain). Trigger: introduction secret reale GitHub Actions                                                                                                                                                                                   | Bassa                      | ~15min           |

## Consequences

### Positive

- **TD-4 RESOLVED** dopo 4 sessioni (carry-over da sessione 7)
- **Foundation E2E completa**: backend B2b Testcontainers ([ADR-0015](./ADR-0015-auth-e2e-hardening-b2b.md)) + frontend Playwright
- **Regression visiva automatic su PR** — sblocca confidence F1 UI iterations
- **Cross-tenant gap (TD-7) ora documentato empiricamente** — quando si fixa, il test diventa regression guard (`tenant-isolation.spec.ts` PASS → FAIL post-fix → adattare assert)
- **4 discoveries empiriche** catturate pre-production (#32-35)
- **Pattern fixture multi-tenant + storage state** standard riusabile per future suite E2E (es. POS cassa flow F1, tenant settings page, ecc.)

### Negative / Trade-offs

- **+1.2GB cache disco dev** (Playwright browsers binaries `~/.cache/ms-playwright`)
- **+~5min CI tempo per PR** (E2E job sequential a checks)
- **TD-AP migration role rotation manual rotation** è anti-pattern medio-termine — production blocker tracciato
- **7 test scope ridotto**: edge case (concurrency, network failure, rate limit lockout UI) NON coperti — accettabile per foundation, espansione futura via TD-AM
- **Workflow CI primo run reale non-validato**: il vero test del job `e2e-playwright` avviene post-push GitHub Actions. Possibili pitfall noti che potrebbero emergere only-on-CI (pnpm cache in container, `apt-get` in Jammy base, ecc.)

### Neutral

- Pattern fixture multi-tenant + storage state ora standard riusabile
- TD-7 RESOLVED candidate diventa naturale next-step quando si fa pulling refactor auth

## Security considerations

### Cosa è ENFORCED via E2E

- **Login fail path**: invalid password ritorna 401 + UI error visible, no redirect dashboard (regression guard)
- **Anonymous redirect**: dashboard non accessibile senza token (token check client-side useEffect)
- **Logout cleanup**: `localStorage` tokens cancellati post-logout (anti session-fixation residuale)
- **Slug malformato**: middleware redirect a `/not-found` (no info leak su esistenza tenant)

### Cosa NON è enforced (gap documentati)

- **Cross-tenant URL access** (TD-7): demo user può navigare manualmente `/t/acme/dashboard` e vedere dati demo. Non sfruttabile per leak dati acme (backend usa JWT.tenantId), ma UI inconsistent → user-confusion + privilege escalation parziale se acme user dovesse "credere" di essere in tenant proprio
- **Rate limit UI feedback** (TD-AM): 429 dopo 5 fail/min non testato via UI (testato server-side B1 [ADR-0013](./ADR-0013-auth-e2e-hardening-b1.md))
- **Lockout UI feedback** (TD-AM): post 10 fail in 15min, retry-after header non testato via UI

## Smoke + Test summary

| Browser       | Result                                    | Tempo |
| ------------- | ----------------------------------------- | ----- |
| Chromium full | 11/11 PASS (2 setup + 7 reali + 2 smoke)  | 9.4s  |
| Firefox smoke | 5/5 PASS (2 setup + 2 smoke + 1 login OK) | 7.0s  |
| WebKit smoke  | 5/5 PASS (2 setup + 2 smoke + 1 login OK) | 7.2s  |

Cumulative test totali progetto post-sessione 10:

- **Vitest unit**: 25/25 PASS
- **Vitest E2E (Testcontainers backend)**: 4/4 PASS
- **Playwright E2E (frontend)**: 11/11 PASS Chromium + cross-browser smoke

## Related ADRs

- [ADR-0012](./ADR-0012-frontend-auth-flow.md) — TD-2 (RESOLVED sessione 9) e TD-4 (RESOLVED sessione 10) entrambi originati qui
- [ADR-0015](./ADR-0015-auth-e2e-hardening-b2b.md) — E2E backend Testcontainers, pattern simmetrico
- [ADR-0013](./ADR-0013-auth-e2e-hardening-b1.md) — Rate limit B1 (TD-AK Redis FLUSHDB rationale)

## Notes

- **Tempo reale**: ~4h sessione 10 (stima iniziale 3-4h, +30% allineato a Discovery #35 emersa Fase 4.4 non in scope task iniziale)
- **LOC totali**: ~694 nuovi (446 Playwright/E2E + 248 ci.yml delta)
- **PR**: #25 atteso (24° PR del progetto)
