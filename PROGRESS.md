# PROGRESS.md — Stato del progetto Gestionale

> File vivente che documenta cosa è già fatto, cosa è in corso, cosa è ancora da fare.
> **Da leggere PRIMA del `PROJECT_BRIEF.md` per capire lo stato corrente.**
> Aggiornato dopo ogni macro-task completato.

**Ultimo aggiornamento:** 5 giugno 2026 (passo 9 — riframe verticale a scaffold + **chiusura estrazione core ADR-0027 §D5**: 9 package estratti, `apps/*` = verticale ristorazione scaffold congelato, naming A mantenuto, TD-CC; 142 unit / 13 task turbo)
**Aggiornamento 6 giugno 2026:** rename verticale ristorazione eseguito — `apps/api,web` → `apps/restaurant-api,restaurant-web` + package name `@gestionale/restaurant-*` (PR #68, `6e32528`); **TD-CC risolto**; doc allineati (apps/README, PROJECT_BRIEF, ADR-0027). `docs/handoff/HANDOFF.md` differito a riscrittura di fine sessione.
**Fase corrente:** Foundation tecnica completa e **ora estratta nel core condiviso**. Macro-task costruiti (sessioni 1-21): Monorepo + stack dev + CI/CD + Husky + Prisma + typecheck Turbo + NestJS scaffold + D2a/D2b Auth (email/password + PIN POS) + D3a/D3b RLS (framework + activation) + D4 Tenant bootstrap + E1/E2 Next.js scaffold + Login UI + B1/B2a/B2b Auth E2E hardening (rate-limit + lockout + email + Testcontainers) + TD-2 multi-tenant routing + TD-4 Playwright E2E + RBAC enforcement Guard + TD-7 cross-tenant defense-in-depth. **Estrazione core ADR-0027 §D5 chiusa (passo 9)**: 9 `packages/` condivisi (api-client, auth, auth-web, db, eslint-config, i18n, platform, shared, ui); `apps/*` = verticale ristorazione **congelato a scaffold/boilerplate** (shell 8-nav, auth gating, i18n it/en, theme) per ADR-0025. **Test**: 142 unit + 13 task turbo verdi. **Prossimo scope:** avvio primo verticale reale (studi commercialisti).

## [2026-06-01] SVOLTA — da gestionale ristorazione a piattaforma a verticali con core condiviso
Decisione registrata in ADR-0025. In sintesi:
- La ristorazione NON è più il prodotto: diventa starter/boilerplate interno.
- Si estrae ORA il core TECNICO condiviso nei packages/ (auth+MFA, multi-tenant+RLS,
  RBAC+guard cross-tenant, audit, i18n, ui, shared, infra Docker/Caddy, CI). È ciò
  che è già costruito e testato (foundation sessioni 1-21).
- NON si estrae ora il core di DOMINIO (anagrafica/fatturazione/ecc.): astrazione
  prematura (vietata da BRIEF §F1). Si estrarrà col secondo verticale reale.
- Ogni verticale = app separata in apps/<verticale> che consuma i packages condivisi.
- Primo verticale reale: COMMERCIALISTI, in TS sulla base condivisa, riusando il
  modello dati del vecchio portale PHP StudioDesk (il PHP resta in beta finché non
  sostituito).
- Politica "build as if real": architettura/sicurezza da prodotto da subito;
  validazioni legali esterne (BRIEF §E) rimandate al go-live; nessuna scorciatoia
  architetturale col pretesto "è un test".
- I moduli di dominio ristorazione NON verranno sviluppati: restano scaffold.

Prossimo task: analisi di Code per inventario del core da estrarre (file → package).

## [2026-06-03] Estrazione core — passo 1: `packages/eslint-config` (ADR-0027 §D5)

Primo passo dell'estrazione del core condiviso secondo l'ordine D5 (dal più sicuro al più rischioso): tooling puro, zero runtime, nessun impatto su auth/RLS/dominio.

**Stato reale prima dell'estrazione (rilevante per il design):** il linting era **centralizzato a root** — `pnpm lint` = `eslint .`, unico flat config `eslint.config.js` a root come sorgente di verità per tutto il monorepo. `apps/web/.eslintrc.json` (`{extends: next/core-web-vitals}`) serve solo a `next lint` (script di workspace, NON invocato da `pnpm lint`) → lasciato invariato, fuori scope. `apps/api`/`packages/db` non hanno flat config propri: ereditano dal root via upward-search.

**Cosa fatto:**
- [x] Nuovo workspace `packages/eslint-config` (`@gestionale/eslint-config`, `type: module`, `exports["."] → ./index.js`). Deps `@eslint/js` + `typescript-eslint` (spostate da root devDeps), peerDep `eslint`.
- [x] `packages/eslint-config/index.js` esporta `base` (default — config condivisa agnostica: ignores, `js.configs.recommended`, `tseslint.configs.recommended`, regole base `no-unused-vars`/`consistent-type-imports`, override `.cjs`) + `nestjs` (preset framework: parserOptions decorator + 3 override, **senza `files`**).
- [x] Root `eslint.config.js` ridotto a thin composer: `import base, { nestjs }` → `[...base, { files: ['apps/api/**/*.ts'], ...nestjs }]`. ESLint risolve i glob relativi al root → comportamento identico.
- [x] Root `package.json`: aggiunta `@gestionale/eslint-config: workspace:*`; rimosse `@eslint/js` e `typescript-eslint` (ora nel package). `eslint` runner resta a root.
- [x] `pnpm install` per linkare il workspace.

**Coupling strutturale segnalato e risolto (non bloccante):** il root config referenziava un path app-specifico (`files: ['apps/api/**/*.ts']`). Per non incollare il layout del repo dentro un package destinato al riuso dai verticali futuri, il package esporta il **preset NestJS agnostico** e il **glob** resta nel root config (che conosce il layout). Nessuna modifica di versione né dipendenze nuove non banali.

**Gate ADR-0027 rispettato — comportamento di linting INVARIATO, baseline test verde costante (prima → dopo):**

| Gate | Prima | Dopo |
|---|---|---|
| `pnpm lint` (`eslint .`) | exit 0, 0 warn/err | exit 0, 0 warn/err |
| `pnpm format:check` | clean | clean |
| `pnpm typecheck` | 4/4 task | 4/4 task |
| `pnpm test` | 95 test / 12 file | 95 test / 12 file |

Verifica aggiuntiva via `eslint --print-config`: file `apps/api` → override NestJS `off` + `emitDecoratorMetadata: true`; file base → `consistent-type-imports: error` + `no-unused-vars` con ignore pattern. Config risolto identico pre/post.

**Non toccato:** `turbo.json` (`pnpm lint` non passa da Turbo), `.lintstagedrc.json` (`eslint --fix` risolve il root config), `pnpm-workspace.yaml` (`packages/*` già incluso), `apps/web/.eslintrc.json`, e ogni altro package del piano (ui/shared/auth/db…). Un passo per PR.

Prossimo passo estrazione (D5 passo 2): `packages/ui` (shadcn + `cn`) + smoke test render.

## [2026-06-03] Estrazione core — passo 2: `packages/ui` (ADR-0027 §D5)

Secondo passo: design system condiviso. Rischio basso (nessun impatto auth/RLS/dominio). Chiude il gap "il design system non ha test propri" rilevato in pre-estrazione.

**Confine verificato (nessuna sorpresa):** gli 11 componenti shadcn + `cn` sono completamente agnostici — dipendono solo da radix/cva/lucide/clsx/tailwind-merge/react-hook-form, **nessun import di dominio né stringa i18n hardcoded**. Tutti core-eligible. Nessun componente domain-aware (Menu/Comanda…) è stato spostato: quelli restano in `apps/web/src/components/menu`.

**Cosa fatto:**
- [x] Nuovo workspace `packages/ui` (`@gestionale/ui`, `type: module`). Esporta i **sorgenti** `.tsx` via barrel `src/index.ts` (`exports["."].types/default → ./src/index.ts`); consumati da Next via `transpilePackages` (preserva `"use client"`). Deps proprie: 5 `@radix-ui/*` + cva + clsx + tailwind-merge + lucide-react + react-hook-form; peerDeps react/react-dom.
- [x] Spostati con `git mv` (storia preservata) gli 11 componenti (`alert, avatar, button, card, dialog, dropdown-menu, form, input, label, sheet, textarea`) + `cn` da `apps/web/src/components/ui/` e `apps/web/src/lib/utils.ts` → `packages/ui/src/`. Import interni riscritti a relativi (`@/lib/utils`→`./utils`, `@/components/ui/label`→`./label`).
- [x] **Decisione meccanismo (confermata con owner):** consumo Next via `transpilePackages: ['@gestionale/ui']` (source export, pattern shadcn-in-monorepo), non prebuild tsup. Aggiunto a `apps/web/next.config.mjs`.
- [x] Wiring consumer: 48 import `@/components/ui/*` su 15 file + 4 import `cn` riscritti a `@gestionale/ui`. Rimossi i path locali. `apps/web/package.json`: `+ @gestionale/ui: workspace:*`; rimosse le 5 `@radix-ui/*` + `class-variance-authority` (0 usi non-ui); restano lucide/react-hook-form/clsx/tailwind-merge (usate direttamente).
- [x] **Fix resa (critico):** aggiunto `'../../packages/ui/src/**/*.{ts,tsx}'` al `content` di `apps/web/tailwind.config.ts` — senza, Tailwind purgherebbe le classi usate nei componenti estratti cambiando la resa.
- [x] **Gap test chiuso (decisione confermata con owner):** stack Vitest + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` (+ `@vitejs/plugin-react`) come **nuove devDeps del package**. `packages/ui/src/ui.smoke.test.tsx`: 9 test (cn, Button incl. variant/asChild, Input, Label, Card, Alert role+variant, Dialog Radix che richiede DOM). Aggiunto `packages/ui/vitest.config.ts` (jsdom) + setup; registrato in `vitest.config.mts` root.

**Gate ADR-0027 — resa e comportamento INVARIATI (prima → dopo):**

| Gate | Prima | Dopo |
|---|---|---|
| `pnpm lint` | exit 0 | exit 0 |
| `pnpm typecheck` | 4/4 task | **5/5** (+`@gestionale/ui`) |
| `pnpm test` | 95 / 12 file | **104 / 13 file** (95 api + **9 ui** nuovi) |
| `pnpm format:check` | clean | clean |
| `next build` (apps/web) | ok | ok (tutte le route compilano, `transpilePackages` + `"use client"` ok) |
| Playwright chromium | 9/9 atteso | **14/14 PASS** (2 setup + 12 spec: auth/shell/routing/tenant-isolation) su stack live (API :3000 + web dev :3001) |

**Nuove dipendenze introdotte (solo test, in `packages/ui` devDeps):** `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react`, `vitest`, `@types/react(-dom)` — confermate con owner prima dell'esecuzione.

**Nota ambiente:** `next start` (build di produzione) crasha qui con `EvalError: Code generation from strings disallowed` nel middleware edge-runtime (next-intl) — quirk ambientale pre-esistente, indipendente da questa PR (il middleware non è toccato). Verifica runtime fatta quindi su `next dev`, supportato.

Prossimo passo estrazione (D5 passo 3): `packages/shared` (error-codes unificati FE/BE con test di parità, tipi/utility comuni).

## [2026-06-03] Estrazione core — passo 3: `packages/shared` (ADR-0027 §D5)

Terzo passo: codice condiviso non-UI/non-auth, in particolare la tassonomia error-code. NON è solo spostamento — c'è unificazione. Rischio basso-medio.

**STOP iniziale — la premessa "due copie duplicate" era inesatta (segnalato prima di agire):** i due file NON erano copie:
- `apps/api/.../common/error-codes.ts` = `enum` con **2 soli codici** (`E_AUTH_INVALID_CREDENTIALS`, `E_UNKNOWN`); di fatto il BE emetteva i codici come **string literal sparse** (es. `'E_AUTH_SESSION_INVALID'` in ~10 controller).
- `apps/web/src/lib/error-codes.ts` = **catalogo messaggi** IT (`Record<code→stringa>`, ~60 chiavi) + helper, con dipendenza `ApiError` (FE).
- La deriva reale era **BE-stringhe-sparse ↔ FE-chiavi**, non file-vs-file.

**Confine applicato (decisione owner: Opzione A — solo codici agnostici):** in `packages/shared` vanno SOLO gli **8 codici agnostici** presenti sia nel catalogo FE sia emessi dal BE: `E_AUTH_{INVALID_CREDENTIALS, ACCOUNT_LOCKED, TENANT_REQUIRED, TENANT_MISMATCH, SESSION_INVALID}`, `E_RATE_LIMITED`, `E_VALIDATION`, `E_UNKNOWN`. **NON** spostati (e segnalati): i codici di **dominio** (`E_MENU_*/E_ARTICLE_*/E_PRICE_LIST_*` → restano nel verticale); gli altri `E_AUTH_*` **auth-interni** (validation/refresh/PIN/RBAC: `E_AUTH_INVALID_REFRESH_TOKEN`, `E_AUTH_PIN_*`, `E_AUTH_NOT_AUTHENTICATED`, validation DTO… → andranno in `packages/auth`, passo 7); i codici **BE-only HTTP-default** del `GlobalHttpExceptionFilter` (`E_UNAUTHORIZED/E_FORBIDDEN/E_NOT_FOUND/E_CONFLICT/E_INTERNAL`, non mappati dal FE → restano literal nel filter); i **messaggi IT** (i18n → `packages/i18n`, passo 4); `lib/types.ts` FE (`LoginResponse/MeResponse…`, contratti auth → `packages/auth-web`).

**Cosa fatto:**
- [x] Nuovo workspace `@gestionale/shared` **dual-package tsup** (ESM+CJS+dts, mirror di `@gestionale/db`) — consumabile da NestJS (CJS, via dist) e Next (ESM). `src/error-codes.ts` (creato con `git mv` dal vecchio enum BE, storia preservata) espone `AuthErrorCode` + `CommonErrorCode` (enum) + `PLATFORM_ERROR_CODES` + tipo `PlatformErrorCode`.
- [x] BE wiring: rimosso `apps/api/src/common/error-codes.ts`; **~40 emission site agnostici** in **13 file** (controller/middleware/guard/strategy/filter/service) passati da string literal → enum della fonte unica (runtime identico: il valore enum È la stringa). Sanata l'incoerenza in `auth.service` (usava enum in un punto, literal in altri 3). `+ @gestionale/shared` a `apps/api`.
- [x] FE wiring: le 8 chiavi agnostiche del catalogo `apps/web/src/lib/error-codes.ts` ora sono **computed key** dalla fonte unica (`[AuthErrorCode.X]`, `[CommonErrorCode.X]`); messaggi IT e chiavi di dominio invariati. `+ @gestionale/shared` a `apps/web`.
- [x] Test di parità/forma: `packages/shared/src/error-codes.test.ts` (5 test: set atteso, naming `E_*`, no duplicati, **no codici di dominio**, stabilità valori enum). Nuovo vitest project registrato in `vitest.config.mts`.

**Gate ADR-0027 — comportamento INVARIATO (prima → dopo):**

| Gate | Prima | Dopo |
|---|---|---|
| `pnpm lint` | exit 0 | exit 0 |
| `pnpm typecheck` | 5/5 | **7/7** (+`@gestionale/shared` typecheck/build) |
| `pnpm test` | 104 / 13 file | **109 / 14 file** (95 api + 9 ui + **5 shared**) |
| `pnpm format:check` | clean | clean |
| `next build` (apps/web) | ok | ok |
| Playwright chromium | 14/14 | **14/14 PASS** (incl. `login FAIL wrong password` → `E_AUTH_INVALID_CREDENTIALS` end-to-end, messaggio IT invariato) |

**Dipendenze nuove:** nessuna runtime; solo devDeps di tooling già nel repo (tsup, vitest, typescript) nel nuovo package.

Prossimo passo estrazione (D5 passo 4): `packages/i18n` (solo meccanismo; messaggi per-app con namespacing; +test switch/fallback). Qui confluiranno i messaggi IT del catalogo error-codes.

## [2026-06-04] Estrazione core — passo 4: `packages/i18n` (ADR-0027 §D5)

Quarto passo: il **meccanismo** di internazionalizzazione (NON i messaggi). Rischio basso. Chiude il gap "switch locale e fallback non testati a unità".

**Confine applicato (meccanismo → package, contenuto → resta in app):**
- **→ `@gestionale/i18n`:** config locale (`locales`/`defaultLocale`/`isValidLocale` + costanti cookie), risoluzione cookie `NEXT_LOCALE` + fallback, factory next-intl `getRequestConfig` (parametrizzata sul loader di messaggi), handler `/api/set-locale`, locale guard del middleware (edge), helper di switch client. Il meccanismo NON era intrecciato con le chiavi di dominio (nessuna sorpresa).
- **→ resta in `apps/web` (contenuto del verticale):** i file `src/i18n/messages/{it,en}.json` (`shell.*`, `dashboard.*`, `menu.*`, `placeholder.*` **+ i messaggi IT degli error-code** del passo 3). Confermata con l'owner la **decisione di deferire** un namespacing core-vs-verticale: l'app fornisce l'intero oggetto messaggi via `loadMessages`, il package resta agnostico; lo schema si introdurrà col secondo verticale o quando esisterà un messaggio davvero core. Confermato anche che `config.ts` (lista locale `it`/`en`) **possiede** le locale a livello piattaforma (boundary del prompt).

**Cosa fatto:**
- [x] Nuovo workspace `@gestionale/i18n` **source export + `transpilePackages`** (mirror di `@gestionale/ui` — solo-Next, **nessun `dist/`/tsup**). Subpath export per separare i runtime context: `./config` (puro), `./request` (RSC, next/headers), `./route` (route handler), `./middleware` (edge, next/server), `./client` (`'use client'`). `git mv` di `config.ts`/`request.ts`/`set-locale.ts` (storia preservata). Cuore puro `resolve.ts` (`resolveLocale` + `buildI18nRequestConfig`) senza dipendenze runtime da Next → unit-testabile in node.
- [x] Wiring `apps/web`: thin `src/i18n/request.ts` (entrypoint plugin che inietta i messaggi del verticale), `route.ts` re-export `handleSetLocale as POST`, `middleware.ts` importa `applyLocaleGuard` (rimosse le const locali `VALID_LOCALES`/`DEFAULT_LOCALE`), `Topbar.tsx` usa `setLocale` + `locales` dal package. `+ @gestionale/i18n` a `apps/web`; `next-intl` resta dep dell'app (peerDep del package); `next.config.mjs` `transpilePackages` aggiornato.
- [x] Test meccanismo: `packages/i18n/src/i18n.test.ts` (8 test: `isValidLocale`, `resolveLocale` switch it↔en + fallback su undefined/invalid/empty/case-mismatch, `buildI18nRequestConfig` carica i messaggi della locale risolta con loader iniettato). Nuovo vitest project registrato in `vitest.config.mts`.

**Gate ADR-0027 — comportamento INVARIATO (prima → dopo):**

| Gate | Prima | Dopo |
|---|---|---|
| `pnpm lint` | exit 0 | exit 0 |
| `pnpm typecheck` | 7/7 | **8/8** (+`@gestionale/i18n`) |
| `pnpm test` | 109 / 14 file | **117 / 15 file** (95 api + 9 ui + 5 shared + **8 i18n**) |
| `pnpm format:check` | clean | clean |
| `next build` (apps/web) | ok | ok (da `.next` pulito; `/api/set-locale` + middleware compilano con i subpath export) |
| Playwright chromium | 14/14 | **14/14 PASS** (incl. `login FAIL wrong password` → errore localizzato end-to-end) |

**Verifica runtime mirata del meccanismo:** `POST /api/set-locale` → `200`+cookie (valido) / `400 INVALID_LOCALE` / `400 INVALID_BODY`; nav della shell server-rendered switcha col cookie (`it` → "Mappa tavoli/Comande/Impostazioni"; `en` → "Table map/Orders/Settings"), confermando che la factory del package risolve il cookie e carica i messaggi dell'app.

**Dipendenze nuove:** nessuna runtime nuova; solo devDeps di tooling già nel repo (`next`, `next-intl`, `typescript`, `vitest`) dichiarate nel nuovo package per typecheck/test. `next-intl`/`next` come peerDeps.

> **Nota build-order CI (lezione del passo 3):** i package **dual-package (tsup)** consumati da `apps/api` vanno aggiunti allo step "Build workspace packages" del job `e2e-playwright` in `ci.yml`, perché quel job avvia l'api con `pnpm dev` diretto (fuori da Turbo, quindi `^build` non scatta). Vale già per `db` e `shared`; varrà per `packages/auth` (passo 7). NB: **`packages/i18n` NON è interessato** perché è consumato solo da Next (`transpilePackages`, nessun `dist/`).

Prossimo passo estrazione (D5 passo 5): `packages/auth-web` (FE: AuthContext/AuthGate/middleware/lib auth, coperto da Playwright).

## [2026-06-04] Estrazione core — passo 5a: `packages/api-client` (ADR-0027 §D5, deviazione d'ordine)

**Deviazione dall'ordine ADR-0027 §D5 (decisione owner, registrata qui):** nell'analisi pre-estrazione di auth-web (passo 5) è emerso che `apps/web/src/lib/api.ts` **non è auth-specifico** ma **infrastruttura HTTP trasversale**: il client generico (`apiGet/apiPost/apiPatch/apiDelete` + `ApiError` + `RequestOptions`) è consumato sia dall'auth FE (`AuthContext`, `auth-logout`, `login`) sia dal **dominio** (`menu-api.ts`, pagina `menu/[menuId]`, `error-codes.ts`). Metterlo in `auth-web` accoppierebbe il dominio ad "auth-web"; lasciarlo app-owned impedirebbe al package di consumarlo (un package non importa dal codice dell'app). → **Si estrae prima `packages/api-client` (passo 5a), poi `auth-web` (passo 5b) lo consumerà.** auth-web resta la sessione successiva.

**Confine (nessuna sorpresa oltre a quella sopra):** spostato **solo** `api.ts` (client HTTP). Restano in `apps/web`: lo slug-routing del `middleware.ts` (dominio) + il locale guard (`@gestionale/i18n`) — verificato che **il middleware NON contiene logica auth** (l'auth FE è interamente client-side via AuthContext/AuthGate, coerente col TD-BA). `error-codes.ts` (catalogo messaggi IT + codici dominio) resta contenuto verticale e continua a consumare i codici da `@gestionale/shared`. **TD-1 (token in localStorage) NON toccato** — `api.ts` estratto com'è, comportamento identico.

**Cosa fatto:**
- [x] Nuovo workspace `@gestionale/api-client` **source export + `transpilePackages`** (mirror di ui/i18n — solo-Next, **nessun `dist/`/tsup**; il source export preserva l'inline di `process.env.NEXT_PUBLIC_API_URL` fatto da Next). `git mv` di `api.ts` → `src/index.ts` (storia preservata). **Zero dipendenze runtime** (solo `fetch`/`process.env`).
- [x] Wiring **6 import site** ripuntati a `@gestionale/api-client` (era `@/lib/api` o `./api`): `contexts/AuthContext`, `lib/auth-logout`, `lib/error-codes`, `lib/menu-api`, `login/page`, `menu/[menuId]/page`. `+ @gestionale/api-client` a `apps/web`; `next.config.mjs` `transpilePackages` aggiornato.
- [x] Test (chiude il gap "`api.ts` senza test propri"): `packages/api-client/src/api-client.test.ts` (10 test, `fetch` globale mockato: header tenant/bearer/content-type, 204 No Content, catena `parseError` errorCode → `code` → sintetico `E_RATE_LIMITED`/`E_UNKNOWN` → unwrap `E_VALIDATION`). Nuovo vitest project in `vitest.config.mts`.

**Gate ADR-0027 — comportamento INVARIATO (prima → dopo):**

| Gate | Prima | Dopo |
|---|---|---|
| `pnpm lint` | exit 0 | exit 0 |
| `pnpm typecheck` | 8/8 | **9/9** (+`@gestionale/api-client`) |
| `pnpm test` | 117 / 15 file | **127 / 16 file** (95 api + 9 ui + 5 shared + 8 i18n + **10 api-client**) |
| `pnpm format:check` | clean | clean |
| `next build` (apps/web) | ok | ok (da `.next` pulito; `NEXT_PUBLIC_API_URL` inlinato via transpilePackages) |
| Playwright chromium | 14/14 | **14/14 PASS** |

**Conferma flussi auth identici (gate critico):** i Playwright auth verdi end-to-end attraverso il client estratto — **login OK** (`apiPost /auth/login` → `setTokens` → dashboard), **login FAIL** (`E_AUTH_INVALID_CREDENTIALS` localizzato via `ApiError`), **logout** (`performLogout` → `apiPost /auth/logout` → clear + redirect), **redirect anonimo** (AuthGate), **shell render** (`apiGet /me` in AuthContext), **cross-tenant isolation**. Nessuna regressione su login/logout/redirect/refresh.

**Dipendenze nuove:** nessuna runtime; solo devDeps di tooling già nel repo (`typescript`, `vitest`) nel nuovo package.

Prossimo passo estrazione (D5 passo 5b): `packages/auth-web` (AuthContext/AuthGate/lib auth/types) che consumerà `@gestionale/api-client`. Il middleware resta in app (slug-routing dominio + locale guard i18n, nessuna logica auth da estrarre).

## [2026-06-04] Estrazione core — passo 5b: `packages/auth-web` (ADR-0027 §D5)

Passo 5 vero e proprio: l'**autenticazione frontend client-side**. Rischio basso-medio (auth FE), mitigato dal fatto che il client HTTP era già estratto al 5a (`@gestionale/api-client`) e che il middleware non contiene logica auth (l'auth FE è interamente client-side, coerente con TD-BA). Chiude il gap "AuthContext/AuthGate senza test propri".

**Confine applicato (mappa pre-estrazione confermata, due assunzioni del prompt corrette prima di agire):**
- **→ `@gestionale/auth-web`** (5 file, `git mv` storia preservata): `AuthContext.tsx` (`'use client'`, fetch `/me` + cross-tab sync), `AuthGate.tsx` (`'use client'`, redirect anonimo), `auth.ts` (token storage localStorage), `auth-logout.ts` (`performLogout`), `types.ts` (contratti `LoginResponse/MeUser/MeRole/MeResponse`).
- **Sorte di `types.ts`:** separa pulitamente — contiene **solo** contratti auth del flusso login/`/me`, **zero tipi di dominio** (i tipi Menu vivono nel separato `lib/menu-types.ts`, che resta in app). Estratto interamente.
- **Grafo dipendenze reale = `auth-web → @gestionale/api-client`** soltanto (+ peerDeps `react`/`react-dom`/`next` per `useRouter`). **NON** dipende da `@gestionale/shared`: il prompt ipotizzava un consumo di error-codes, ma nessuno dei 5 file li importa (usano `ApiError` da api-client). Nessun ciclo. Più pulito dell'atteso.
- **→ resta in `apps/web`:** `middleware.ts` (slug-routing dominio + locale guard i18n), `lib/error-codes.ts` (catalogo messaggi IT + codici dominio), `lib/menu-api.ts`/`menu-types.ts`/pagine `menu/*` (consumer, ripuntati al package).

**Cosa fatto:**
- [x] Nuovo workspace `@gestionale/auth-web` **source export + `transpilePackages`** (mirror di ui/i18n/api-client — solo-Next, **nessun `dist/`/tsup**; le direttive `"use client"` di AuthContext/AuthGate sono preservate). Barrel `src/index.ts` esporta la public surface (`AuthProvider`/`useAuth`/`AuthGate` + token helper + `performLogout` + tipi). `git mv` dei 5 file (storia preservata); import interni riscritti a relativi (`@/lib/auth`→`./auth`, ecc.), `@gestionale/api-client` invariato.
- [x] Wiring **9 import site** ripuntati a `@gestionale/auth-web`: `login/page` (setTokens+LoginResponse), `lib/menu-api` (getAccessToken), `t/[slug]/layout` (AuthProvider), `shell/Topbar` + 4 pagine `(authenticated)/*` (useAuth), `(authenticated)/layout` (AuthGate). `+ @gestionale/auth-web` a `apps/web`; `next.config.mjs` `transpilePackages` aggiornato; **`tailwind.config.ts` content** `+ '../../packages/auth-web/src/**'` (critico — AuthGate rende lo spinner con classi Tailwind, lezione del passo `ui`); root `vitest.config.mts` `+` nuovo project.
- [x] Test (chiude il gap auth FE): `auth.test.ts` (6 — token storage + dispatch `AUTH_CHANGE_EVENT`) + `auth-context.test.tsx` (6 — jsdom, mock api-client/next: AuthProvider monta→fetch `/me`→stati `useAuth` anonimo/autenticato/401-clear; AuthGate redirect anonimo / spinner loading / render autenticato).

**Gate ADR-0027 — comportamento INVARIATO (prima → dopo):**

| Gate | Prima | Dopo |
|---|---|---|
| `pnpm lint` | exit 0 | exit 0 |
| `pnpm typecheck` | 9/9 | **10/10** (+`@gestionale/auth-web`) |
| `pnpm test` | 127 / 16 file | **139 / 18 file** (95 api + 9 ui + 5 shared + 8 i18n + 10 api-client + **12 auth-web**) |
| `pnpm format:check` | clean | clean |
| `next build` (apps/web) | ok | ok (da `.next` pulito; login/dashboard/menu compilano con `transpilePackages` + `"use client"`) |
| Playwright chromium | 14/14 | **14/14 PASS** |

**Conferma flussi auth identici (gate critico):** i Playwright auth verdi end-to-end attraverso il package estratto — **login OK** (setup demo+acme + `auth-login` → dashboard), **login FAIL** (`E_AUTH_INVALID_CREDENTIALS` localizzato, resta su login), **logout** (`auth-logout` + topbar → clear token + redirect), **redirect anonimo** (`auth-redirect` + AuthGate via shell), **shell render** (`apiGet /me` in AuthContext), **cross-tenant isolation**. `refresh` = `AuthContext.refresh()` (re-fetch `/me`) preservato; lo storage del refresh-token resta identico. Nessuna regressione.

**TD-1 (token in localStorage) NON toccato:** estratto com'è, comportamento identico. La migrazione a httpOnly cookie resta task separato (porterà con sé lo spostamento di AuthGate a middleware server-side, TD-BA).

> **Nota di parametrizzazione futura (registrata, NON task ora):** `AuthContext`/`AuthGate` assumono lo schema URL multi-tenant path-based `/t/<slug>/login` (convenzione core piattaforma, TD-2). È un'assunzione di routing **da parametrizzare** quando arriverà un secondo verticale con schema URL diverso — annotata nel barrel `packages/auth-web/src/index.ts`.

> **Nota build-order CI:** `auth-web` è consumato **solo** da Next (`transpilePackages`, nessun `dist/`) → **NON** richiede lo step "Build workspace packages" del job `e2e-playwright` (come ui/i18n/api-client; vale solo per i dual-package tsup `db`/`shared`/futuro `packages/auth`).

Prossimo passo estrazione (D5 passo 6): `packages/db` (RLS engine, soft-delete, tabelle multi-tenant) — **prerequisito** il test RLS core-only non-superuser (ADR-0026 §D5). Poi passo 7 `packages/auth` (BE, massimo rischio).

> **Rettifica d'ordine (vedi passo 6 sotto):** questa previsione del 5b è stata superata. L'ordine autoritativo resta quello dell'**ADR-0027 §D5**: passo 6 = `packages/platform`, passo 7 = `packages/auth`, passo 8 = `packages/db` (preceduto dal test RLS core-only non-superuser). `packages/db` resta quindi al passo 8, non al 6.

## [2026-06-04] Estrazione core — passo 6: `packages/platform` (ADR-0027 §D5)

Primo package estratto con **codice NestJS + DI** (i 5 precedenti erano front-end o funzionali). Infra backend cross-cutting in `@gestionale/platform`, **dual-package tsup** (ESM+CJS+dts, mirror di `db`/`shared`), consumato da `apps/api` (NestJS/CJS via `dist/`). Rischio applicativo basso (infra senza logica di dominio), ma primo banco di prova della DI sotto tsup → preceduto da una **probe di build** (STOP 0.5) prima di toccare il codice.

**Confine applicato (scope ristretto vs §D5):**
- **→ `@gestionale/platform`** (15 file, `git mv` storia preservata R100): `redis` (module+service), `mail` (module+service), `throttler` (module + guard `app-throttler` + 3 decorators + 2 utils + spec = 8), `common` (`GlobalHttpExceptionFilter` + `prisma-errors` + spec = 3).
- **`health` DIFFERITO (deviazione registrata in ADR-0027 Addendum 2026-06-04):** dipende da `@Public` (decorator di `auth`, passo 7) e `DbService` (wrapper in `apps/api/src/db/`, passo 8), entrambi estratti DOPO platform → estrarlo ora invertirebbe il layer (`platform → apps/api/{auth,db}`). È inoltre endpoint terminale (0 consumatori) che *compone* auth+db+redis: concern applicativo, non infra di base. Resta scaffold in `apps/api`; rientro valutato al passo 7.
- **Dipendenze incrociate (invariate):** `common → @gestionale/{db,shared}` (Prisma + `CommonErrorCode`); `throttler → redis` diventa intra-package. Nessun import di dominio (ristorazione) nei moduli estratti.

**Cosa fatto:**
- [x] Nuovo workspace `@gestionale/platform` dual-package tsup. Barrel `src/index.ts` espone la public surface; i 3 `*_METADATA` risiedono in `throttler.module.ts` (non nei decorator) → re-export dal file reale.
- [x] **Convenzione build NestJS-dual (nuova, riusabile al passo 7):** `tsconfig.json` del package dichiara ESPLICITAMENTE `experimentalDecorators` + `emitDecoratorMetadata` (il `tsconfig.base.json` NON li eredita); `tsup.config.ts` elenca i runtime NestJS in `external`. Probe STOP 0.5: verificato nel dist che `design:paramtypes` è emesso coi **tipi reali** (`[ConfigService]`, non `Object`) e che `Test.createTestingModule().compile()` risolve la DI.
- [x] Consumatori `apps/api` ripuntati a `@gestionale/platform` (**17 file**, incl. un `import()` dinamico in `auth.service.spec`; consolidati i 4 import di `app.module.ts` e i 2 di `auth.controller.ts`). `+ @gestionale/platform` (`workspace:*`) alle deps di `apps/api`.
- [x] **CI build-order** (`ci.yml`, job `e2e-playwright`): step "Build workspace packages" esteso a `@gestionale/platform` (dual-package tsup consumato da `pnpm dev`, fuori da Turbo — lezione passo 3). Topo-order verificato: `pnpm --filter db --filter shared --filter platform build` compila platform per ultimo, nessuno split necessario.

**Gate ADR-0027 — comportamento INVARIATO (prima → dopo):**

| Gate | Esito |
|---|---|
| Build workspace (topo-order db+shared→platform) | ok |
| `typecheck` (platform + api) | ok |
| `test` unit | **95/95** (82 api + 13 platform; i 2 spec migrati girano in-package) |
| `test:e2e` (full AppModule bootstrap, testcontainers Postgres+Redis) | **56 pass + 4 skip**, 10/10 file |
| Bootstrap DI runtime | nessun `Nest can't resolve dependencies` (verificato via e2e che monta l'intero AppModule) |

**Conferma DI reale (gate critico):** la suite e2e bootstrappa l'intero `AppModule` con i moduli estratti consumati da `dist/` — coperti `td-ad-throttler-redis-down` (fail-open Redis), `auth-login`, `rbac-permissions` (RedisService + AppThrottlerGuard), `tenant-consistency` (RedisService). `health` (intatto) continua a rispondere. Nessuna regressione.

> **Nota build-order CI:** `platform` è il terzo dual-package tsup (dopo `db`/`shared`) che richiede lo step "Build workspace packages" del job `e2e-playwright`. Il futuro `packages/auth` (passo 7) lo erediterà.

Prossimo passo estrazione (D5 passo 7): `packages/auth` (auth+rbac+users+tenancy + i 4 APP_GUARD) — **massimo rischio applicativo** (ordine guard deterministico da ri-verificare; e2e auth/rbac/tenant-consistency verdi costanti). La convenzione build NestJS-dual di questo passo è il riferimento. Resta valida la **nota/rischio sul passo 8** (`packages/db`): scrivere PRIMA il test RLS core-only come `gestionale_app` non-superuser (ADR-0026 §D5), perché gli e2e attuali girano da superuser e non esercitano la RLS a livello DB.

## [2026-06-04] Estrazione core — passo 7: `packages/auth` (ADR-0027 §D5)

Il **blocco multi-tenant sicuro** (auth + rbac + users + tenancy) — massimo rischio applicativo del piano. Eseguito in **due PR** per separare il rischioso dal meccanico: **7a** (#58, refactor d'accesso DB) + **7b** (estrazione vera e propria).

**7a — disaccoppia `DbService` (preparatorio, #58):**
- I moduli auth iniettavano il wrapper locale `DbService` (`apps/api/src/db/`, estratto solo al passo 8) → **back-ref bloccante** per l'estrazione. Disaccoppiati **7 file di produzione** usando direttamente il singleton `prisma` di `@gestionale/db` (già loro fonte per le funzioni RLS `runInTenantContext`/`withSystemContext*`). 3 spec migrati da mock-via-costruttore a `vi.mock('@gestionale/db')`.
- `DbService` **invariato**, ancora iniettabile per i consumatori fuori scope (`health` + 5 service di dominio): dipendenza `apps/api → apps/api` valida fino al passo 8. Anti-astrazione (§F1): singleton concreto già condiviso, nessuna porta/interfaccia per un wrapper di ~12 righe.

**7b — estrazione `@gestionale/auth` (questa PR):**
- **→ `@gestionale/auth`** dual-package tsup: `git mv` di **39 file** (storia preservata) — `auth` (21), `rbac` (6), `users` (3), `tenants` (5, CRUD onboarding), `tenant` (3, infra middleware/decorator), `context` (1, interceptor). Zero riferimenti di dominio (ristorazione).
- Barrel `src/index.ts` = **17 simboli** (superficie consumata): `AuthModule/RbacModule/UsersModule/TenantsModule/TenantModule`, 3 guard (`JwtAuthGuard/TenantConsistencyGuard/PermissionsGuard`), `TenantContextInterceptor`, `TenantMiddleware`, `Public/IS_PUBLIC_KEY/CurrentUser/CurrentTenant/RequirePermissions`, `UsersService`, interfacce `AuthenticatedUser/AuthenticatedRequest/FullProfile`.
- **Wiring resta nello scaffold** `app.module.ts`: `APP_INTERCEPTOR` (`TenantContextInterceptor`) + i 4 `APP_GUARD` in ordine deterministico (`AppThrottlerGuard`[platform] → `JwtAuthGuard` → `TenantConsistencyGuard` → `PermissionsGuard`) + `configure()/forRoutes(TenantMiddleware)`. L'estrazione ha cambiato **solo i path d'import**; ordine e logica **byte-identici** (ADR-0017 / Discovery #36).
- **10 consumatori** `apps/api` riscritti a `@gestionale/auth` (import-only; `health.controller` solo per `@Public`). `+ @gestionale/auth` (`workspace:*`) alle deps di `apps/api`.
- **CI build-order**: step esteso a `--filter @gestionale/auth` (topo-order ok, nessuno split). Profilo NestJS-dual del passo 6 riusato senza probe; `external` esteso (jwt/passport/argon2/class-validator/rxjs/platform).

**`health` differito (DP-health = A):** importa `@Public` da `@gestionale/auth` ma **resta scaffold** in `apps/api` (back-ref `DbService` locale, risolto al passo 8). Rientro pieno impossibile senza re-introdurre il back-ref appena rimosso al 7a. Cfr. ADR-0027 Addendum passo 7.

**Gate ADR-0027 — comportamento INVARIATO:**

| Gate | Esito |
|---|---|
| Build topo-order (db+shared+platform+**auth**) | ok (auth per ultimo, DTS emessi) |
| `typecheck` (auth + api) | ok |
| `test` unit — redistribuzione | **39 auth + 43 api = 82** (somma conservata vs pre-7b) |
| `test:e2e` (full AppModule bootstrap, testcontainers) | **56 pass + 4 skip**, 10/10 file |
| Catena guard e2e (ordine reale) | ok (auth → tenant-consistency → permissions; throttler fail-open) |

**Conferma catena guard (gate critico):** la suite e2e bootstrappa l'intero `AppModule` con i guard consumati da `@gestionale/auth` (dist) — coperti `rbac-permissions` (deny → 403 `E_AUTH_INSUFFICIENT_PERMISSIONS` + audit insert), `tenant-consistency`, `auth-login` (+ `forRoutes(TenantMiddleware)`), `td-ad-throttler-redis-down` (fail-open). Nessun `Nest can't resolve dependencies`.

> **Nota:** `@gestionale/auth` è il quarto dual-package tsup (db/shared/platform/auth) nello step "Build workspace packages" del job `e2e-playwright`.

Prossimo passo estrazione (D5 passo 8): `packages/db` — **massimo rischio dati**. **VINCOLO FERMO:** PRIMA scrivere il **test RLS core-only** come `gestionale_app` **NON-superuser** (ADR-0026 §D5) — i test e2e attuali girano da superuser (Testcontainers Postgres default) e quindi **NON esercitano la RLS a livello DB**: senza questa correzione il test "core-only" non testerebbe l'isolamento reale. Solo dopo: separazione enum/seed core vs dominio + indirezione `getClientForTenant` (ADR-0026 §D3).

## [2026-06-04] Estrazione core — passo 8a: prerequisito RLS (`smoke:rls-core` in CI)

Il passo 8 (`packages/db`) è preceduto dal **prerequisito RLS** (ADR-0026 §D5 / ADR-0027 §D4): un test che esercita la RLS **DB-level** girando come `gestionale_app` **non-superuser**. Finora era una **blind spot in CI** — gli e2e attuali si connettono come superuser `postgres`, che **bypassa la RLS anche con `FORCE`** → la barriera di isolamento più importante aveva test verdi che non la testavano.

**Finding del preflight:** gli e2e api Vitest+testcontainers (56) **non girano in CI** (girano solo unit + Playwright web). Quindi non bastava aggiungere uno spec alla suite e2e api. → **Percorso X (footprint minimo):** un check DB-level dedicato che riusa l'infra **già presente** nel job CI `e2e-playwright` (ruolo `gestionale_app` ruotato a password nota, `DATABASE_URL` app-role, seed demo/acme), invece di portare l'intera suite e2e api in CI (scope ben più ampio + Docker-in-CI, dentro il passo a massimo rischio dati).

**Cosa fatto (additivo):**
- [x] `packages/db/scripts/smoke-rls-core.ts` (script npm `smoke:rls-core`): **9 scenari core-only** su `tenants/sedi/users/audit_logs` (+ `roles/user_roles`), come `gestionale_app`:
  - **S0** preludio auto-diagnostico (query raw fuori contesto): `current_user = gestionale_app`, `rolsuper = false`, `rolbypassrls = false` — un fallimento spiega da sé che l'env punta al ruolo sbagliato (e che gli altri PASS sarebbero falsi positivi);
  - read-isolation cross-tenant (S1-S3), write-block cross-tenant `WITH CHECK` non-distruttivo (S4-S5), bypass system/super-admin (S6-S7), fail-fast `RlsNoContextError` fuori contesto (S8).
- [x] **1 step CI** in `e2e-playwright` dopo `db:seed`: `pnpm --filter @gestionale/db smoke:rls-core` (exit ≠0 → step rompe = falla di isolamento rilevata). `DATABASE_URL` = app-role dal `.env` post-rotate (via `dotenv -e`, stesso pattern di `db:seed`).

**Gate:** 9/9 PASS, `exit=0`; **non-distruttivo** (2° run identico, insert cross-tenant respinti non persistono — verificato: `users=2` seed-only, zero righe `rls.smoke.writeblock`); **zero** modifiche a schema/migrazioni/seed/e2e/harness (56 e2e invariati).

> **TD-CB — e2e api Vitest+testcontainers non in CI** (~~aperto~~ → **FOLDED [2026-07-22]** in `TD-ci-e2e-testcontainers-be`, ADR-0071): i 56 e2e e `smoke:rls-e2e` girano solo in locale. Conseguenza: in CI i 3 test "isolation" applicativi (`menu-tenant-isolation`, `soft-delete-rls`, `tenant-consistency`) girerebbero da superuser → validano isolamento applicativo, non DB-level. Migration path: portare la suite e2e api in CI come `gestionale_app` (Docker-in-CI o riuso del service container `e2e-playwright`). Mitigazione attuale: `smoke:rls-core` copre l'enforcement DB-level core-only in CI. Passo dedicato (non in 8a/8b). Cfr. ADR-0027 Addendum passo 8a. **→ non più TD autonomo:** l'aspetto "RLS DB-level non esercitata come `gestionale_app` in CI" è ora sotto-obiettivo esplicito di `TD-ci-e2e-testcontainers-be` (vedi [2026-07-12] + [2026-07-22]).

Prossimo passo estrazione (D5 passo 8b): `packages/db` — separazione **enum/seed core vs dominio** + indirezione **additiva** `getClientForTenant(ctx)` (ritorna il client condiviso, ADR-0026 §D3 fase 1). Prerequisito di confine: definire l'interfaccia **tenancy ↔ db** (chi possiede la mappa routing-key, §D4). **Prerequisito RLS ora soddisfatto (8a).**

> ✅ **TD-7 sessione 16 RESOLVED** (ADR-0012 §TD-7 sessione 16 update): `TenantConsistencyGuard` `@Injectable()` registrato `APP_GUARD` globale post-`JwtAuthGuard` pre-`PermissionsGuard` chiude defense-in-depth backend per client non-browser (curl, mobile app future, integrazioni API). Logica 5 branch: skip `@Public` + skip se `req.user` assente + skip se header `X-Tenant-Slug` assente (backward-compat) + lookup `tenantId` by slug (cache Redis 60s TTL, fallback Postgres `withSystemContext`) + mismatch detection vs `req.user.tenantId` (JWT subject) → `401 E_AUTH_TENANT_MISMATCH` via `GlobalHttpExceptionFilter` (sessione 15) ZERO config aggiuntivo. 1A SPLIT decision: TD-7 standalone S16 + Menu CRUD progressivo S17+ (scope F1 reale ~5-7 modelli Prisma da BRIEF B3 + gate accettazione D5). 2 TD candidate nuovi (TD-BJ cache invalidation tenant lifecycle + TD-BK audit log persistente `tenant_mismatch_attempt`). Discoveries cumulative: **51** (+1 sessione 16, candidate Redis cache TTL persistence cross-test artifact). Foundation cleanup carry-over sessioni 11-15: **100% ✅**. **TD-7 cross-tenant defense-in-depth backend: 100% ✅** (sessione 16). Prossimo task: sessione 17 jump a F1 Menu CRUD schema completo F1 design + migration + CRUD backend (5-7 modelli Prisma).

## [2026-06-05] Estrazione core — passo 9: riframe verticale a scaffold + **chiusura §D5** (ADR-0027)

Ultimo passo dell'ordine §D5. Passo **atomico, documentale** (zero file di codice toccati).

**Estrazione core COMPLETA.** I passi §D5 1→8b sono chiusi. Il core tecnico agnostico vive in **9 package**: `eslint-config`, `ui`, `shared`, `i18n`, `auth-web`, `api-client` (FE) · `platform`, `auth`, `db` (BE). `apps/api` + `apps/web` = **verticale ristorazione, scaffold congelato** (ADR-0025: dominio non sviluppato, riferimento boilerplate). Confine core/dominio dei verticali documentato in `apps/README.md` (nuovo).
- Passi 8b-1 (`#62`, separazione seed core/dominio + convention confine schema) e 8b-2 (`#63`, indirezione `getClientForTenant` fase 1 + addendum ADR-0026 §D4) mergiati prima del 9.

**Decisione naming (§D3, deferita → presa ora) = A — mantieni i nomi.** `apps/api`/`apps/web` NON si rinominano: con un solo verticale è churn anticipato; il trigger è l'arrivo del 2° verticale (commercialisti/StudioDesk). → registrato **TD-CC**.

**Chiusura differiti "al passo 8/9" — tutti RESTANO app-level/scaffold (decisionale, zero codice):**
- **health** resta in `apps/api` (estrarlo → ciclo `platform → apps/api/db`; concern applicativo, endpoint terminale).
- **DbService** resta in `apps/api` (wrapper ~12 righe, 6 consumer tutti scaffold/app → infra di scaffold, non core; §F1).
- **me** resta in `apps/api` (core-residuo app-level, thin controller su `@gestionale/auth`).

**Invariato:** wiring `APP_INTERCEPTOR` + 4 `APP_GUARD` deterministici + `TenantMiddleware.forRoutes` in `app.module.ts` byte-identico (Discovery #36). Nessun `.ts`/`.tsx`/`.prisma`/`.json` di codice toccato.

**Test totali (realtà post-8b):** **142 unit** su **13 task turbo** (95 api~~/82~~→ ora 43 api + 39 auth + 13 platform + 12 auth-web + 10 api-client + 9 ui + 8 i18n + 5 shared + **3 db**) · **56 e2e** Testcontainers backend (4 skip) · **14 Playwright** chromium. Sostituisce il conteggio stale "95/95".

> **TD-CC — rename `apps/api`/`apps/web` → `apps/restaurant-*` al 2° verticale** (RISOLTO 2026-06-06, PR #68): naming mantenuto oggi (decisione A); rename al secondo verticale per disambiguare. Strutturale-ma-meccanico (directory + `package.json` name + path-alias + CI build-order + import). Severità BASSA, trigger = avvio 2° verticale, ~1-2h. Cfr. ADR-0027 Addendum passo 9.

---

## [2026-06-07] STOP-a — estrazione `DbService` → `@gestionale/db/nest` (ADR-0028)

**Branch**: `feat/db-nest-subentry` · **Tipo**: 1 PR refactor backend (sub-entry additivo) · **ADR**: [ADR-0028](docs/architecture/ADR-0028-dbservice-nest-subentry.md)

Primo STOP dell'avvio 2° verticale (commercialisti) dopo il rename TD-CC. `DbService`/`DbModule` estratti da `apps/restaurant-api/src/db/` a **sub-entry NestJS additivo** `@gestionale/db/nest` (NON package nuovo), così lo skeleton `accountant-api` lo consumerà senza duplicarlo. Decisione **C** verificata empiricamente a STOP 0.

**Decisioni** (dettaglio [ADR-0028](docs/architecture/ADR-0028-dbservice-nest-subentry.md)):

- Sub-entry `./nest` additivo; entry `.` resta agnostico verso `@nestjs/*` (`DbService`/`DbModule` solo in `./nest`).
- **Singolo pool**: `db.service.ts` importa `prisma` da `'@gestionale/db'` (self-reference, mai relativo) + `@gestionale/db` in `external` tsup → `require('@gestionale/db')` risolve all'entry `.` = una sola istanza. Probe STOP 0.5: `same prisma reference: true`.
- Build NestJS-dual = pattern `platform` (decorator flags nel `tsconfig` di `db` — il base non li eredita, divergenza #7 — + runtime NestJS in `external`).
- NestJS come **optional peer + devDep** (NON dep hard, divergenza motivata da `platform`): preserva `db` agnostico nel dependency graph; i consumer FE non ereditano NestJS né ricevono unmet-peer.
- `typesVersions` bridge per il `moduleResolution: node` di `restaurant-api` (subpath `exports` risolti a runtime ma ignorati da TS node10 per i tipi).

**Discoveries cumulative bump 56 → 57**:

- **Discovery #57** — package multi-entry (`exports` subpath) consumato da app `moduleResolution: node`: subpath risolto a runtime ma ignorato da TS per i tipi → `typesVersions` necessario (TS2307); il DTS rollup di tsup richiede le dep dei tipi risolvibili nel workspace, ma una devDep basta (no dep hard). Generalizzabile a ogni futuro sub-entry su package del core consumato da app node10.

**Tech debt:** nessuno nuovo. `health`/`me` restano app-level come da piano (ADR-0027 §D5 / ADR-0028): `health` consuma `db/nest` ma resta in-app (evita di accoppiare `db/nest` ad `auth`), `me` non tocca `db`.

**Test (GATE shared-config — baseline → post-fix, invarianti):**

- `typecheck`: **14/14** ✅ · unit: invariati ✅
- e2e Testcontainers: **56 pass / 4 skip** ✅ (full `AppModule` bootstrap = gate DI reale; zero `Nest can't resolve dependencies`)
- `smoke:rls-core`: **9/9** ✅
- Probe STOP 0.5: `require("@gestionale/db")` presente nel bundle nest, singleton non inlinato, `same prisma reference: true` ✅; DTS sub-entry generati con NestJS in devDep (fallback opzione A non necessario).

**File:**

| File | Type |
|---|---|
| `apps/restaurant-api/src/db/db.service.ts` → `packages/db/src/nest/db.service.ts` | git mv (storia preservata) |
| `apps/restaurant-api/src/db/db.module.ts` → `packages/db/src/nest/db.module.ts` | git mv (storia preservata) |
| `packages/db/src/nest/index.ts` | new (barrel) |
| `packages/db/package.json` | mod (`exports["./nest"]`, `typesVersions`, optional peer + devDep) |
| `packages/db/tsup.config.ts` | mod (multi-entry + `external`) |
| `packages/db/tsconfig.json` | mod (decorator flags) |
| `apps/restaurant-api/src/{articles/articles,articles/article-prices,menu-categories/menu-categories,price-lists/price-lists,health/health,menus/menus}.service.ts` (6) | mod (import → `@gestionale/db/nest`) |
| `apps/restaurant-api/src/app.module.ts` | mod (import `DbModule` → `@gestionale/db/nest`) |
| `docs/architecture/ADR-0028-dbservice-nest-subentry.md` | new |
| `PROGRESS.md` | mod (questa entry) |

**Foundation status post-merge:**

- **`DbService` condiviso via `@gestionale/db/nest`: 100% ✅** (singolo pool verificato)
- Next: **STOP-b** — walking skeleton `accountant-api` + `accountant-web` (boot + auth/login + `me`, zero dominio). Preflight residuo: anatomia `restaurant-web` (shell/auth riusabile vs route dominio menu) da leggere a STOP 0 di `accountant-web`.

---

## [2026-06-07] STOP-b1 — walking skeleton `accountant-api` (ADR-0029)

**Branch**: `feat/accountant-api-skeleton` · **Tipo**: 1 PR feature (nuovo workspace, scaffold) · **ADR**: [ADR-0029](docs/architecture/ADR-0029-accountant-api-skeleton.md)

Avvio backend del 2° verticale (commercialisti). Nuovo workspace `apps/accountant-api` (`@gestionale/accountant-api`) = **replica core-only** di `restaurant-api` (boot + auth/login + `me`, **ZERO dominio**). Consuma `DbService` dal sub-entry `@gestionale/db/nest` (ADR-0028). Split STOP-b confermato: **b1 `accountant-api`** (questo) → **b2 `accountant-web`** (prossimo, anatomia FE già letta a STOP 0).

**Decisioni** (dettaglio [ADR-0029](docs/architecture/ADR-0029-accountant-api-skeleton.md)):

- `app.module.ts`/`main.ts` derivati da `restaurant-api`; rimossi i 4 moduli dominio (`Menus`/`MenuCategories`/`Articles`/`PriceLists`) dagli `imports[]`. 4 APP_GUARD + `TenantContextInterceptor` + `TenantMiddleware.forRoutes` **byte-identici** (Discovery #36 / ADR-0017): unico delta in `app.module.ts` = riga di commento.
- `health` + `me` + `app.controller` duplicati (thin, import `@gestionale/*` assoluti). `health` resta app-level (evita di accoppiare `db/nest` ad `auth`), `me` non tocca `db`.
- Tenant dedicato `studio-demo` (`admin@studio.local`) via `seedDevTenant` esistente, **senza** `seedDevMenu` → skeleton isolato dalla ristorazione. Catalogo `PERMISSIONS` globale ereditato dal Super Admin (permessi del verticale a STOP-c).
- Porte env-driven: `accountant-api` `:3002` (CORS `:3003` per `accountant-web`); script `dev` forza `PORT`/`CORS_ORIGIN` via `dotenv-cli -v` (no collisione col `.env` condiviso).
- ESLint root glob → `apps/*-api/**/*.ts` (future-proof), `...base` preservato.

**Gate (2a — build/typecheck/lint + boot DI + smoke HTTP locale, NO e2e):**

- `typecheck` **15/15** (+`@gestionale/accountant-api`) ✅ · `lint`/`format:check` clean ✅
- Boot DI pulito ✅ (zero `Nest can't resolve dependencies`; `DbService` da `@gestionale/db/nest`, Redis PONG, SMTP verificato, listening `:3002`)
- Smoke HTTP `:3002`: root 200, health 200 `{status:"ok", db:"connected"}`, login (`studio-demo`) 200 + access/refresh, `me` 200 + `admin@studio.local` + Super Admin + 32 permessi ✅
- Seed `studio-demo` idempotente (2° run 0 created) ✅
- `app.module.ts` diff vs `restaurant-api` = solo riga di commento ✅

**Tech debt:** nessuno nuovo. DevDeps solo-test omesse (no script `test` nello skeleton) → rientrano a STOP-c con la e2e. Permessi ristorazione su `studio-demo` = atteso (catalogo globale; permessi del verticale a STOP-c).

**File:**

| File | Type |
|---|---|
| `apps/accountant-api/package.json`, `tsconfig.json`, `nest-cli.json` (3) | new |
| `apps/accountant-api/src/{main,app.module,app.controller}.ts` (3) | new (derivati core-only da restaurant-api) |
| `apps/accountant-api/src/health/{health.module,health.controller,health.service,health.dto}.ts` (4) | new (duplicati) |
| `apps/accountant-api/src/me/{me.module,me.controller}.ts` (2) | new (duplicati) |
| `packages/db/prisma/seed.ts` | mod (+`seedDevTenant('studio-demo')`, no menu) |
| `eslint.config.js` | mod (glob → `apps/*-api/**/*.ts`) |
| `docs/architecture/ADR-0029-accountant-api-skeleton.md` | new |
| `PROGRESS.md` | mod (questa entry) |

**Foundation status post-merge:**

- **Backend skeleton `accountant-api`: 100% ✅** (boot + auth/login + `me`, zero dominio, smoke verde)
- Next: **STOP-b2** — walking skeleton `accountant-web` (shell/auth riusabile da `restaurant-web`; scarta dominio menu + 6 route placeholder ristorazione + Sidebar ridotta + messaggi i18n del verticale; `accountant-web` su `:3003`, consuma `accountant-api` `:3002`; **niente** `@gestionale/db` — dead-dep nel FE).

---

## [2026-06-07] STOP-b2 — walking skeleton `accountant-web` (ADR-0030) — chiude STOP-b

**Branch**: `feat/accountant-web-skeleton` · **Tipo**: 1 PR feature (nuovo workspace FE, scaffold) · **ADR**: [ADR-0030](docs/architecture/ADR-0030-accountant-web-skeleton.md)

Frontend del 2° verticale (commercialisti) — chiude lo **skeleton** (STOP-b: BE ADR-0029 + FE ADR-0030). Nuovo workspace `apps/accountant-web` (`@gestionale/accountant-web`), Next.js 15, **replica shell/auth** di `restaurant-web` con **ZERO dominio menu**; consuma `accountant-api` `:3002`, gira su `:3003`.

**Decisioni** (dettaglio [ADR-0030](docs/architecture/ADR-0030-accountant-web-skeleton.md)):

- 11 file shell/auth copiati byte-identici (ThemeProvider/`AuthProvider`/`AuthGate`/`MainLayout`/`Topbar`/login/dashboard/`api/set-locale`/`i18n/request`/`not-found`/`globals.css`).
- `middleware.ts` copia identica; unico delta = redirect root → `/t/studio-demo/login`.
- **Sidebar ridotta (scelta b)**: `dashboard` + `clienti`/`fatture` (stub via `PlaceholderPage`, "in arrivo") → predispone gli slot nav per STOP-c, zero dominio reale. Omesse route `menu/*` + 6 placeholder ristorazione.
- `error-codes.ts` potato (solo auth/common; rimossi `E_MENU_*`/`E_ARTICLE_*`/`E_PRICE_LIST_*` + `messageForError`).
- i18n riscritto: `shell.nav` 3 voci + `placeholder.{clienti,fatture}` + `dashboard`/`shell.topbar` generici; omessi `menu.*` + placeholder ristorazione.
- API env-driven `NEXT_PUBLIC_API_URL=http://localhost:3002/api/v1` (`.env.local` gitignored + `.env.local.example`); base include `/api/v1`. **`@gestionale/db` non in deps** (dead-dep FE, ADR-0028).

**Gate (typecheck/lint/`next build` + boot dev + smoke SSR, no e2e):**

- `typecheck` **16/16** (+`@gestionale/accountant-web`) ✅ · `lint` + `next lint` + `format:check` clean ✅
- `next build` OK — 7 route, zero dominio ✅
- Boot dev `:3003` + SSR: `/` 307 → `/t/studio-demo/login`; login/dashboard/clienti/fatture 200; slug riservato 307 → `/not-found` ✅
- Conferme: zero residui dominio, `@gestionale/db` assente, Sidebar 3 voci, i18n senza `menu.*`, `error-codes` potato, middleware diff = solo tenant ✅

**Tech debt:** nessuno nuovo. DevDeps solo-test (Playwright) omesse → rientrano a STOP-c con la e2e. Flusso login interattivo coperto per derivazione (byte-identico a `restaurant-web` + Playwright lì); verifica browser di Nicolò opzionale pre-merge (port-forward VS Code, `:3002`+`:3003` up).

**File:** nuovo workspace `apps/accountant-web/` (28 file: 10 config/root + 18 `src/` — 11 copiati byte-identici + 7 adattati/nuovi: `middleware`, `page` root, `Sidebar` ridotta, `error-codes` potato, `i18n` it/en, 2 route stub `clienti`/`fatture`) + `docs/architecture/ADR-0030-accountant-web-skeleton.md` + `PROGRESS.md` (questa entry). Nessuna modifica a file shared esistenti (solo `pnpm-lock`).

**Foundation status post-merge:**

- **Skeleton 2° verticale (commercialisti) COMPLETO ✅**: backend `accountant-api` (ADR-0029) + frontend `accountant-web` (ADR-0030) — boot + auth/login + `me`, zero dominio.
- Next: **STOP-c** — prima slice dominio = anagrafica `aziende` (da StudioDesk): DDL (FK posticipate, soft-delete, unicità naturale → partial-unique-index Pattern 42, policy RLS), modulo NestJS + DTO, UI lista/form, e2e isolamento tenant. STOP 0 dedicato sul DDL. Qui nasce anche la e2e Testcontainers di `accountant-api` e i 2 slot nav (`clienti`/`fatture`) iniziano a riempirsi.

---

## [2026-06-08] STOP-c1 — prima slice dominio `aziende` (ADR-0031)

**Branch**: `feat/aziende-backend` · **Tipo**: 1 PR feature (schema + backend + e2e) · **ADR**: [ADR-0031](docs/architecture/ADR-0031-aziende-domain-slice.md)

Primo dominio reale del 2° verticale (commercialisti): anagrafica clienti `aziende` (da StudioDesk `01_studio_template.sql`), in `accountant-api`. Eseguita in due passi (c1 backend smoke-HTTP + c1b e2e) su un unico branch, **una PR**.

**Decisioni** (dettaglio [ADR-0031](docs/architecture/ADR-0031-aziende-domain-slice.md)):

- Modello `Azienda` MVP 15 campi + standard (UUID v7, `tenantId`+FK Cascade, `deletedAt`, timestamps). RFM `operatore_riferimento_id` + arricchimento `32_*` **deferiti** (circolare users / YAGNI).
- Unicità naturale `codice` per-tenant → partial-unique `aziende_tenant_codice_active_uq … WHERE deleted_at IS NULL` (Pattern 42, no `@@unique`). P.IVA/CF non-unique.
- RLS `aziende_tenant_isolation` USING-only + FORCE (forma identica a menu, ADR-0009); GRANT ereditato (no esplicito).
- Soft-delete via `update({deletedAt})` esplicito (ADR-0021); conflict = pre-check `findFirst` + `catchUniqueViolation` (`@gestionale/platform`, ADR-0024).
- Modulo `aziende` (controller/service/2 DTO/unit) `@Inject` esplicito; rotte `/api/v1/aziende` con `anagrafica.cliente.{visualizza,crea,modifica,elimina}`. DELETE → `200 {id,deleted:true}`.
- **Permesso `anagrafica.cliente.elimina` aggiunto** (catalogo 32→33; Super Admin + Admin sede + Direzione).
- **Nasce la suite e2e Testcontainers di `accountant-api`** (infra da restaurant-api: `.swcrc`, project e2e, helper + fixture); e2e api solo locale (TD-CB).

**Gate:**

- DB: partial-unique + policy `aziende_tenant_isolation` + FORCE ✅
- typecheck 16/16 · lint · format · 12 unit DTO ✅
- Smoke HTTP `:3002`: create 201 / dup 409 / update 200 / soft-delete 200 / ricrea-201 / isolamento `[]` ✅
- E2E `aziende-crud` **11/11** (CRUD, 409, ricrea-201, 404, RBAC-403 viewer, isolamento applicativo), DI pulito ✅

**Tech debt:** **TD-RLS-aziende** — RLS DB-level di `aziende` non esercitata da e2e (suite superuser, TD-BV) né da `smoke:rls-core` (solo core); isolamento verificato applicativamente + policy presente in DB. Estensione futura. | TD-CB (e2e api non in CI), TD-BS Sub-2 (ValidationPipe e2e) invariati.

**File:** `packages/db` (schema +enum/+model `Azienda`, migration `add_aziende`, seed +`.elimina`, barrel +re-export) · `apps/accountant-api` (modulo `src/aziende/` + `app.module` + suite e2e `test/e2e/` + `.swcrc` + `vitest.config.mts` + devDeps) · `docs/architecture/ADR-0031-*.md` + `PROGRESS.md`.

**Foundation status post-merge:**

- 2° verticale: skeleton (ADR-0029/0030) + **prima slice dominio `aziende`** (ADR-0031) ✅
- Next: **STOP-c2** — UI lista/form `aziende` in `accountant-web` (slot nav `clienti`/`aziende`) + seed demo aziende per `studio-demo`. Eventuale STOP-c3 per le entità satellite (referenti, log) o per riagganciare RFM/arricchimento.

---

## [2026-06-10] STOP-scad1 — backend scadenze (calendario fiscale) (ADR-0039)

> Le slice intermedie del verticale (referenti ADR-0033/34, RLS isolation ADR-0035, preventivi ADR-0036/37, dashboard ADR-0038) sono tracciate nel running-snapshot `docs/handoff/HANDOFF.md`. Questa entry riprende il log narrativo per il primo modulo che introduce un **pattern nuovo** (categorie piattaforma+custom), corsia FULL.

**Cosa:** primo modulo del livello operatore-studio oltre anagrafica/preventivi/dashboard. `scadenze` (calendario fiscale) tenant-level + `scadenze_categorie` con seed di piattaforma (`tenant_id NULL`, immutabili) + custom per tenant. Pattern di riferimento: aziende (ADR-0031, CRUD tenant-level + soft-delete + partial-unique + RLS) + preventivi (ADR-0036).

**Decisioni chiave (dettaglio in ADR-0039):**
- `Scadenza` tenant-level (NON nested sotto azienda); `aziendaId` opzionale, obbligatorio solo se `visibilita='azienda'` (validato nel service, non nei DTO — la ValidationPipe non gira in e2e, TD-BS).
- `scadenze_categorie` **NON ha RLS** (le righe piattaforma sono `tenant_id NULL` → una policy per-tenant le filtrerebbe via): scoping **applicativo** nel service (read `OR[null, tenant]`, write `tenant`, ogni `categoriaId` validato accessibile). `scadenze` ha RLS+FORCE standard.
- Partial-unique `scadenze_categorie (tenant_id, nome) WHERE tenant_id IS NOT NULL` → unicità nome solo sulle custom; piattaforma senza vincolo (idempotenza seed applicativa). Partial-unique predisposto `scadenze (tenant_id, codice_import) WHERE deleted_at IS NULL`.
- Categorie piattaforma seedate **incondizionatamente** (reference data come i permessi), non dev-only. Ruoli studio estesi con `scadenze.*` (mirror preventivi). Catalogo permessi **35→37**.
- Gotcha routing: `GET/POST /scadenze/categorie` dichiarate **prima** di `:id` (Express match per ordine di dichiarazione).

**GATE:** typecheck 16/16 · lint/format clean · e2e accountant **61/61** (48 regression invariati + 13 scadenze). Seed idempotente (37 permessi, 7 categorie: re-run 0 created / 7 re-affirmed).

**File:** `packages/db` (schema +enum `VisibilitaScadenza` /+model `Scadenza`+`ScadenzaCategoria`, migration `add_scadenze`, seed +2 permessi/+ruoli/+`seedScadenzeCategorie`, barrel re-export) · `apps/accountant-api` (modulo `src/scadenze/` + `app.module` + e2e `scadenze-crud` + helper `scadenze-test-fixtures` + `test-app` TRUNCATE) · `docs/architecture/ADR-0039-*.md` + `PROGRESS.md`.

**Tech debt:** TD-RLS-scadenze candidate (non esercitata da `rls-isolation` e2e — suite superuser TD-BV; isolamento applicativo scenario #11). `scadenze_categorie` senza RLS → protezione interamente applicativa (ogni accesso DEVE passare dallo scoping del service). `visibilita='utente'` + `codiceImport` predisposti ma inerti (YAGNI).

---

## [2026-06-11] STOP-scad2 — UI scadenze (calendario fiscale) (ADR-0040)

**Cosa:** UI scadenze in `accountant-web`, segue il backend ADR-0039. Route top-level `/t/[slug]/scadenze` (tenant-level, NON nested sotto cliente come preventivi) + voce di sidebar dedicata. Lista raggruppata per mese + barra filtri + form create/edit inline + ConfirmDialog soft-delete. Corsia FULL → ADR-0040 dedicato (scelte filtro client/server + limite PATCH-null FK), pur replicando i pattern UI di aziende/preventivi.

**Decisioni chiave (dettaglio in ADR-0040):**
- Normalizzazione `dataScadenza` (@db.Date → ISO datetime) a YYYY-MM-DD `.slice(0,10)` nel layer `scadenze-api.ts` (ADR-0037 Gotcha, come `validoFino`).
- Lista senza relazioni embedded → colore categoria (dot) + nome azienda risolti client-side con `Map` da `getScadenzeCategorie()` + `listAziende()` (riuso aziende-api); le stesse liste popolano i `<select>` del form.
- Partizione filtri: backend = categoria + range date (refetch su cambio); client-side = stato (attive/scadute/future, date-derived) + visibilità (`visibilita` non è filtro backend).
- Form: `superRefine` zod `visibilita='azienda' ⇒ aziendaId` (mirror service), select azienda visibile solo in quel caso, azzeramento `aziendaId` cambiando visibilità.
- Sidebar: pattern reale `{ key, icon }` (non `{ href, label }` del prompt) → union esteso con `'scadenze'`, icona `CalendarDays`.
- Gating azioni gestione su `scadenze.gestisci` (Nuova/Modifica/Elimina).

**GATE:** typecheck 16/16 · lint + next build OK (route `/t/[slug]/scadenze` generata, 4.69 kB) · nessun test mirror (nessuna formula client-side, pattern ADR-0032/0034). Smoke browser non-superuser a cura di Nicolò pre-merge.

**File:** `apps/accountant-web` — nuovi `lib/scadenze-{types,api}.ts` + `components/scadenze/ScadenzaForm.tsx` + route `scadenze/page.tsx`; modificati `components/shell/Sidebar.tsx` + `lib/error-codes.ts` (+3 codici E_SCADENZA_*) + `i18n/{it,en}.json` (+`shell.nav.scadenze`, +namespace `scadenze`). `docs/architecture/ADR-0040-*.md` + `PROGRESS.md`.

**Tech debt:** TD-PATCH-null-FK (il `UpdateScadenzaDto` non azzera `categoriaId`/`aziendaId` — `@IsUUID` opzionali senza `null`: in edit, cambiando visibilità via UI l'`aziendaId` resta in DB, semanticamente ignorato). Gestione categorie custom non ancora in UI (`createScadenzaCategoria` esposta in api ma senza schermata dedicata — il form sceglie solo tra categorie esistenti).

---

## [2026-06-11] UI gestione categorie scadenze custom (LEAN, segue ADR-0040) — PR #92

**Cosa:** completa la coda di STOP-scad2 — UI per creare/gestire le categorie custom delle scadenze (`createScadenzaCategoria` era esposta in `scadenze-api.ts` ma senza schermata). Nuova sezione **"Categorie personalizzate"** in fondo a `/t/[slug]/scadenze`: lista categorie piattaforma (`tenantId NULL`, badge "Predefinita") + custom del tenant (dot colore + nome) + form inline di creazione. **Corsia LEAN** (replica pattern `ReferentiSection`/`ReferenteForm`, zero schema/migration/RLS, nessuna DP nuova) → **nessun ADR dedicato, segue ADR-0040**.

**Scelte (nessuna nuova decisione di prodotto):**
- Solo **create**: il backend non espone update/delete categorie → la lista è read-only, label "Predefinita" sulle piattaforma è puramente visiva.
- `CategorieSection` **non possiede stato categorie**: lo riceve via prop dalla page (fetch unico in `loadReference`); `onCreated` → refetch della page, così la nuova categoria appare anche nel **picker del `ScadenzaForm`** (no doppio fetch).
- `CategoriaForm`: 2 campi — `nome` (required, max 100, mirror del DTO) + `colore` (`input type="color"`, default `#3b82f6`), zod+RHF; riuso chiavi i18n `create/creating/cancel`.
- `E_SCADENZA_CATEGORIA_NOME_EXISTS` mappato in `error-codes.ts` (conflitto runtime uniqueness per-tenant, non preventibile dalla zod client).
- Bottone "Aggiungi categoria" gated su `scadenze.gestisci`.

**GATE:** typecheck ✅ · lint ✅ · next build ✅ (route `/t/[slug]/scadenze` 5.23 kB) · JSON i18n valido ✅ · **smoke runtime non-superuser** (`collaboratore@studio.local`, ha `scadenze.gestisci`): sezione visibile, 7 badge "Predefinita", create categoria custom → appare in lista **e** nel picker del form scadenza. PASS ✅ · CI verde (Lint·Typecheck·Format·Test + Playwright). Squash-merge **e5ea9df**.

**File:** `apps/accountant-web` — nuovi `components/scadenze/{CategoriaForm,CategorieSection}.tsx`; modificati `scadenze/page.tsx` (+import +1 riga render) + `lib/error-codes.ts` (+1 codice) + `i18n/{it,en}.json` (+namespace `scadenze.categorie`). Nessun ADR.

**Tech debt:** invariati. Chiude la coda "gestione categorie custom non ancora in UI" di STOP-scad2. TD-PATCH-null-FK resta aperto (bassa priorità).

---

## [2026-06-14] Infra — HTTPS + dominio reale su `gestionale-test` (ADR-0041)

**Cosa:** primo HTTPS di produzione del progetto. Caddy serve `studiodesk.cloud` + `*.studiodesk.cloud` con certificati Let's Encrypt reali (auto-rinnovo), challenge **DNS-01 Cloudflare** (obbligatorio per i wildcard). Il dominio (registrar Aruba, DNS Cloudflare) è stato **ripuntato dal vecchio server StudioDesk** (legacy dismesso) a questo host (`178.105.56.116`). Dietro il proxy per ora solo un **placeholder** (le app non sono ancora containerizzate). Corsia FULL → ADR-0041 (l'ADR "futuro" che ADR-0001 rimandava per la strategia ACME).

**Decisioni chiave (dettaglio in ADR-0041):**
- **Build Caddy custom** (`infra/caddy/Dockerfile`, xcaddy + `caddy-dns/cloudflare`, pin `2.11`): l'immagine `caddy:2-alpine` standard non ha il modulo DNS. NB 2.8.x ha un bug zapslog con xcaddy → 2.11.
- **Override prod** (`docker-compose.prod.yml`): si applica *in aggiunta* al base dev, cambia solo `caddy` (build, porte `80/443`+`443/udp` con `!override`, dir-mount config). Comando: `docker compose -f docker-compose.dev.yml -f docker-compose.prod.yml up -d --build caddy`.
- **HTTPS-only** (requisito Nicolò): redirect 308 `:80`→`https://` (default `auto_https`) + header **HSTS** `max-age=31536000; includeSubDomains`. Mai contenuto in chiaro.
- **Segreti fuori dal repo**: `CF_API_TOKEN` (token Cloudflare scoped `Zone:DNS:Edit`+`Zone:Read` su `studiodesk.cloud`, riuso del token "Certbot wildcard" rollato) + `ACME_EMAIL` solo in `.env` (gitignored), referenziati `{env.*}`. Token creato/installato da Nicolò, mai transitato dall'AI.
- **DNS-only (grey)** in avvio per validare il cert d'origine; proxy Cloudflare (orange + Full strict) deciso in seguito.

**Gotcha risolto in corsa:** bind-mount di un **singolo file** lega l'inode → riscritture dell'editor non viste dal container (`caddy reload` → "config unchanged", continuava a servire lo staging). Risolto montando la **directory** `infra/caddy/conf/`.

**GATE:** build immagine ✅ (`caddy version` 2.11.4, `list-modules` include `dns.providers.cloudflare`) · `caddy validate` config ✅ · merge compose ✅ (8080 sostituita da 80/443) · emissione **LE staging** ✅ (~13s, de-risk rate-limit) → switch **LE prod** ✅. Validazione esterna: `https://studiodesk.cloud` **200** + cert prod valido · wildcard `<sub>.studiodesk.cloud` **200** trusted · `http://`→**308** https · HSTS presente · posta `mx`/Brevo intatta. Pre-commit security check (.env.example): .env ignorato ✅ / nessun token reale versionato ✅ / solo placeholder ✅.

**File:** nuovi `infra/caddy/Dockerfile` + `infra/caddy/conf/Caddyfile` + `docker-compose.prod.yml` + `docs/architecture/ADR-0041-*.md`; modificato `.env.example` (+`CF_API_TOKEN`/`ACME_EMAIL` placeholder). **PR #94, squash-merge 0463533.**

**Tech debt / follow-up aperti:**
- **TD-backup-caddy_data** — il volume `caddy_data` contiene ora certificati *veri*: perderlo = riemissione + consumo rate-limit LE. Va incluso nello script di backup F1 (già previsto da ADR-0001/0041).
- **Cloudflare proxy** (orange + Full strict) — non attivato, da valutare.
- **App dietro il proxy** — oggi solo placeholder; sostituire `respond` con `reverse_proxy` richiede containerizzare api/web (task separato).

---

## [2026-06-19] Infra — formalizzazione domini + host co-locati fuori dal git (ADR-0042)

**Cosa:** formalizza ciò che gira *dietro* il cert wildcard di ADR-0041 e toglie dal git di prodotto gli host **co-locati di terzi** (verticali "game"/Lumimondo: adventure, superpang, music) che nel frattempo erano finiti inline nel `Caddyfile` versionato (con credenziali `basic_auth` altrui). Principio: **repo == prodotto gestionale**. Corsia FULL → ADR-0042.

**Decisioni chiave (dettaglio in ADR-0042):**
- **Modello domini/resolver:** `studiodesk.cloud` + `*.studiodesk.cloud` su un solo site block; le superfici gestionale (tenant `<slug>`, api/web) passano dal resolver multi-tenant; gli host co-locati di terzi **fuori dal resolver** — reverse-proxy diretto via rete `web` + `basic_auth`, niente tenant/RLS (deciso 14/06).
- **Pattern host co-locati → snippet gitignored:** i vhost di terzi vivono in `infra/caddy/conf/colocated.adventure.caddy` (gitignored, pattern `colocated.*.caddy`); il `Caddyfile` committato porta solo gestionale + `import colocated.*.caddy` + fallback. Il mount-dir di ADR-0041 carica lo snippet a runtime pur non essendo in git.
- **DP2 — glob tollerante:** `import colocated.*.caddy` (non path letterale). Verificato su Caddy v2.11.4: import **letterale** di file assente = errore hard (Caddy non parte); **glob** senza match = no-op (`Valid configuration`). → host pulito senza snippet non rompe. Niente `.example` placeholder.
- **DP1 — fallback `respond 200`:** resta versionato nel Caddyfile (comportamento gateway, non co-locato).
- **DP4 — mount-stale:** runbook nell'ADR (`up -d --force-recreate caddy` se si sostituisce la dir `conf/`), no re-arch a named volume (YAGNI).
- **Ops:** rete `web` external one-time su host pulito (`docker network create web`); TODO backup `caddy_data` ribadito.

**GATE:** `caddy validate` config refactorata ✅ · test glob-vuoto (snippet rinominato → `Valid configuration`, fallback risponde) ✅ → ripristino ✅ · probe HTTP adventure/superpang/music invariati ✅. Pre-commit security: snippet con credenziali di terzi gitignored ✅ / nessuna credenziale di terzi nel Caddyfile committato ✅.

**File committati:** `Caddyfile` (refactor), `docker-compose.prod.yml` (rete `web` external), `.gitignore` (+`colocated.*.caddy`), `docs/architecture/ADR-0042-*.md`, questa entry. **NON committato:** `infra/caddy/conf/colocated.adventure.caddy` (gitignored, vive su disco).

**Drift segnalato:** tra preflight e refactor il blocco `@music` nel working-tree è passato utente `maurizio`→`pietro` (modifica non dell'AI); lo snippet estratto riflette lo stato on-disk attuale (`pietro`).

---

## [2026-06-19] Modulo Comunicazioni — thread studio↔cliente (ADR-0043)

**Cosa:** canale di comunicazione tracciato tra operatori studio e aziende clienti per il verticale commercialisti. Modello dati riusato dal PHP StudioDesk (non il codice), scope tagliato a MVP **operatore-only** (la UI cliente è livello 2/portale, fuori scope). Corsia FULL → ADR-0043.

**Backend:**
- 3 model (`Comunicazione`, `ComMessaggio`, `ComAllegato`) + `com_counter`. **DP-N1**: thread ancorato ad azienda+referente, NON a user cliente (`autoreUserId` nullable pre-portale). **DP-N2**: `tenantId` denormalizzato su tutte e 3 → RLS **flat** USING-only+FORCE (forma reale repo, `tenant_id` TEXT, **no `::int`**; niente nesting verso il parent).
- **`codice` per-tenant** (`COM-0001…`) via counter-row `com_counter`, **`SELECT … FOR UPDATE` nella stessa tx** dell'insert (atomico/seriale per-tenant) + partial-unique soft-delete-aware come backstop (Pattern 42).
- **`StorageService` astratto** (nuovo, 1° consumer) + impl filesystem locale (cap 20MB; path-safety: guard di shape `<uuid>/<uuid>(.ext)?` + containment `resolve`/`startsWith`, 5 test). I consumer iniettano il token astratto → swap R2 = cambio `useClass`. **TD-storage-platform**: estrarre in `packages/platform` al 2° consumer.
- **RLS isolation** verificata su tutte e 3 (tenant A insert → tenant B 0/0/0, A 1/1/1; `com_allegati` incluso). Nota: gira via helper RLS (setup super-admin), non sotto `gestionale_app` HTTP end-to-end (TD-BV noto, delegato agli e2e).
- **+2 permessi** `comunicazioni.gestisci`/`.visualizza` (37→39), forma imperativa; mapping Socio/Collaboratore/Segreteria (gestione) + Praticante (sola lettura).

**Frontend (accountant-web, operatore):** inbox filtrabile + dettaglio thread + composer + allegati (upload/download via fetch raw, l'api-client fa solo JSON) + **note interne** (`lato=interno`) + assegnazione/presa-in-carico + read tracking. Voce Sidebar + i18n it/en + error-codes `E_COM_*`. Niente UI cliente.

**GATE:** typecheck 16/16 ✅ · lint 0 ✅ · test 15/15 task (accountant-api unit 12→17 con i 5 storage path-safety) ✅. Pre-commit security: nessun segreto nei file (solo codice).

**Fuori scope (backlog ADR-0043):** multi-canale telegram/whatsapp/email/sa, `whatsapp_inbound_log`, reazioni, snooze, auto-chiusura cron, AI, firma automatica. **PR feature/comunicazioni-adr-0043** (non ancora mergiata).

---

## [2026-06-20] Modulo Documenti + graduazione StorageService (ADR-0044)

**Cosa:** archivio documenti studio↔cliente per il verticale commercialisti, modello riusato dal PHP StudioDesk (non il codice). 2 commit atomici nello stesso branch/PR (split A): (1) graduazione StorageService, (2) modulo Documenti sopra.

**⚠️ Provenienza scope:** le esclusioni MVP derivano dalla product-interview 10/06, **NON dal BRIEF** (che ha solo una sezione `### Documenti` sulla ristorazione, muta sul modulo accountant). L'ADR-0044 è la fonte autoritativa finché il BRIEF non recepisce.

**Commit 1 — graduazione StorageService (refactor isolato):** Documenti = 2° consumer → chiusa `TD-storage-platform` (ADR-0043). `git mv` di `StorageService`+impl+module+spec da `apps/accountant-api/src/storage` a `packages/platform/src/storage` + re-export. Move puro, **zero cambi di logica** (sanitizzazione anti-traversal invariata). Check anti-regressione: GATE intero verde, **Comunicazioni 12/12 dal nuovo path**, 5 test storage da platform. Unica modifica: `import type Readable` (regola `consistent-type-imports` più stretta sotto `packages/`).

**Commit 2 — modulo Documenti:**
- 2 model: `DocumentoTipo` (platform tenantId NULL + custom, **NO RLS** + scoping applicativo + partial-unique, pattern ScadenzaCategoria) + `Documento` (**RLS+FORCE flat**, `storageKey` opaca, soft-delete).
- 2 enum: **`VisibilitaDocumento` = tutti|azienda** (no `utente`, backlog), `DirezioneDocumento`.
- **DP-codice**: nessun counter — `documenti` (i file) non ha codice nel PHP (il codice è sul *tipo*).
- Seed: **16 tipi platform** (find-then-create) + **+2 permessi** `documenti.gestisci`/`.visualizza` (39→41) + mapping ruoli.
- Upload/download via StorageService da `@gestionale/platform`. RLS isolation verificata (A insert → B 0, A 1).
- UI accountant-web (operatore): archivio filtrabile + upload + download + soft-delete + nav/i18n it-en + error-codes. Niente UI cliente.

**GATE:** typecheck 16/16 ✅ · lint 0 ✅ · test 15/15 (accountant-api 12 · platform 18 con 5 storage · accountant-web 7) ✅.

**Backlog (ADR-0044):** letture/ricevute, user_state archivia/elimina, modelli con schema campi (fase 6C), password per-documento, scade_il+avvisi, cron-gc orfani. **TD:** documenti-tipo-codice (chiave macchina se fase 6C), utente-enum forward (portale), storage-gc.

---

## [2026-06-21] Modulo Circolari MVP — broadcast studio→clienti (ADR-0045, PR #101)

**Cosa:** ultimo modulo del **livello 1 operatore-studio** del verticale commercialisti: comunicazioni broadcast **unidirezionali** studio→clienti. Modello riusato dal PHP StudioDesk (DDL base `07`, non il codice), scope tagliato a MVP. Corsia FULL → ADR-0045. **Chiude il livello 1.**

**Scope (locked a STOP 0/1):** lean — testata + destinatari + macchina di stato. **Defer:** versioning (`13_v2`), AI, Telegram/push, A/B, solleciti+cron, letture/conferma, email, destinatario reparto, rich editor (tutto in ADR-0045 §out-of-scope).

**Backend (accountant-api):**
- 2 model: `Circolare` (testata + soft-delete) + `CircolareDestinatario` (`tipo` tutti/azienda/utente). **DP-N2**: `tenantId` denormalizzato sui destinatari → RLS **flat** USING-only+FORCE (TEXT no-cast), come comunicazioni/documenti. Nessun counter/codice (le circolari non hanno numerazione naturale).
- 2 enum: `CircolareStato` (bozza/pubblicata/archiviata), `DestinatarioTipo` (`utente` = **forward** livello 2, rifiutato in validazione → TD-circolari-utente-forward).
- **Macchina di stato**: `publish` (bozza→pubblicata, setta `pubblicataIl`) / `archive` (pubblicata→archiviata); modifica/elimina solo su bozza → **422** altrove. Destinatari replace-integrale in tx atomica (`withTenantContextAtomicTx`).
- **+4 permessi** `circolari.{create,publish,archive,read_report}` (**41→45**); `create` = operativo (CRUD bozza), publish/archive transizioni separate, `read_report` allora forward (endpoint consegnato il 2026-06-23 → PR #107, ADR-0048 §1, vedi entry sotto). Socio/Super Admin via `ALL_PERMISSION_CODES`; Collaboratore solo `create`.
- **Email alla pubblicazione: DEFER** — `MailService` repo è security-only, manca il framework `notifiche_config`. MVP solo in-app.

**Frontend (accountant-web, operatore):** lista (filtro stato + badge + azioni contestuali gated sui permessi) + form inline crea/modifica (titolo, oggetto, body textarea — no rich editor MVP, priorità, scadenza, destinatari tutti|aziende) + dettaglio read-only. Sidebar + i18n it/en.

**GATE + CI:** typecheck 16/16 ✅ · lint 0 ✅ · **8 unit + 16 e2e** nuovi (CRUD, transizioni, 422 guard, RBAC publish-mancante 403, isolamento cross-tenant) · CI PR #101 verde (incl. Playwright). **Deploy host** allineato (migration `add_circolari` applicata + RLS verificata in DB + seed 45). **Smoke runtime** non-superuser (Collaboratore) confermato via tunnel SSH: create/edit/delete OK, publish → 403.

**Divergenze spec→repo (forma, scope invariato):** id UUID v7 app-side via `id()` (no `generate_ulid()`); seed shape reale `{code,description,category}`; relazioni Tenant/Azienda + FK `tenant_id` (richieste da Prisma); ruoli reali Socio/Collaboratore.

**TD (ADR-0045):** circolari-utente-forward, circolari-render (body come testo, serve sanitizzazione server-side prima di HTML), circolari-letture (livello 2), circolari-email.

---

## [2026-06-23] Livello 2 — Portale cliente: documenti/comunicazioni/circolari + report letture studio (ADR-0046/0047/0048, PR #103→#107)

**Cosa:** apertura del **livello 2 — portale cliente** del verticale commercialisti (il lato-cliente, finora sempre differito). Arco di 5 PR squash-merge consecutivi (#103→#107) che porta i clienti dentro la piattaforma in lettura/reply e chiude l'ultimo TD forward di Circolari. **Catalogo permessi 45→49.** Main @ `b43aeb1`.

**#103 — Foundation identità + routing (ADR-0046):** `User.tipo` (`UserTipo` operatore|cliente), `aziendaId`, `clienteRuolo` (`ClienteRuolo`); invariante DB `tipo='cliente' ⟺ aziendaId NOT NULL` (CHECK `chk_cliente_azienda_id`, CASCADE su azienda). Auth routing operatore vs cliente + shell portale. Permesso `portale.documenti.visualizza` seedato **forward** (consumer reale nel task successivo). Migration `add_portale_cliente_identity`.

**#104 — Documenti read-only (ADR-0046):** lettore cliente dei documenti della propria azienda (visibilità `tutti`|`azienda`), download via StorageService (`@gestionale/platform`). Primo consumer reale di `portale.documenti.visualizza`.

**#105 — Comunicazioni reply-only (ADR-0047):** prima superficie portale **bidirezionale** — il cliente legge e **risponde** ai thread della propria azienda (no apertura nuovi thread). 2 permessi distinti `portale.comunicazioni.{visualizza,rispondi}` (la scrittura giustifica lo split, a differenza del singolo `documenti.visualizza`).

**#106 — Circolari letture + conferma (ADR-0048):** lettore circolari cliente (read + `markLetta` on-open + conferma presa-visione). **Attiva i due deferral di ADR-0045 §6:** `Circolare.richiedeConferma` (ALTER) + nuova tabella `circolari_letture` (riga per `(circolare,utente)` con `lettaAt`/`confermataAt?`, `@@unique([circolareId,userId])`, **RLS flat** USING+FORCE TEXT no-cast). Permesso `portale.circolari.visualizza`. ACL cliente sempre in-query (`clienteWhere`): non visibile ⟺ inesistente (404, no leak per id indovinato). Migration `add_circolari_letture`.

**#107 — Report letture lato studio (ADR-0048 §1, oggi):** consumer reale di `circolari.read_report` (seedato forward da ADR-0045). `GET /circolari/:id/report`: risoluzione del set destinatari **atteso** (`tutti`→tutti i clienti del tenant, `azienda`→clienti dell'azienda, dedup in-query) × left-join `circolari_letture` → **summary** (attesi/letti/confermati) **+ breakdown** per destinatario. Bozza → **422** `E_CIRCOLARE_NOT_REPORTABLE`. FE: pannello "Report letture" nel dettaglio circolare studio, **gated** `read_report` + nascosto su bozza; colonna "Confermata" solo se `richiedeConferma`. **Nessuna migration. Chiude TD-circolari-read-report.**

**GATE + CI (#107):** typecheck api+web ✅ · lint 0 ✅ · **e2e `circolari-report` 6/6** (RBAC 403/200, risoluzione tutti/azienda, count lettura/conferma, bozza 422) · CI PR #107 verde (Lint·Typecheck·Format·Test + Playwright). **Verifica runtime** 6/6 a livello API+RBAC con attori reali (Socio `admin@studio.local` con `read_report`, Collaboratore `collaboratore@studio.local` senza).

**Decisioni read_report (STOP 0):** summary+breakdown (D1), bozza→422 (D2), conferma condizionata a `richiedeConferma` (D3), pannello gated (D4), no paginazione MVP (D5).

**Deploy host:** `gestionale-test` allineato a `main` lato **sorgente** (migration `add_portale_cliente_identity` + `add_circolari_letture` applicate, seed 49, RLS verificata in DB). ⚠️ **Scoperto:** il tier applicativo NON è in esecuzione sull'host — Caddy serve un placeholder statico, quindi `/api/health` 200 è un **falso positivo** (stesso body su path inesistenti). Deploy app reale (build prod + container + Caddy `reverse_proxy`) = task infra separato da pianificare con STOP dedicato (ricognizione fatta: Dockerfile app assenti, stack live = `docker-compose.dev.yml` + override `prod.yml` solo-caddy).

**Backlog livello 2 (non implementati):** destinatario `utente` (broadcast a singolo), storico circolari archiviate lato cliente, notifiche email/push alla pubblicazione, rendering HTML sanitizzato del body (TD-circolari-render), download allegati circolari, paginazione/export CSV del report.

## [2026-06-25] Deploy applicativo + Onda 1 completa (#109-112)

Deploy applicativo reale: Dockerfile api/web multi-stage, compose prod, Caddy reverse_proxy path-based (PR #109, `8a06f88`). App live su gestionale-test.

Onda 1 — Sblocca l'uso reale:
- Reset password (#110, `e67c5f9`): forgot/reset flow, token sha256 TTL 1h, no-oracle, logout globale.
- Invito cliente (#111, `09e7998`): token sha256 TTL 7gg, auto-promote admin, auto-login post-accept, permesso `clienti.invitare` (50 permessi totali).
- Superadmin minimale (#112, `6f7e0d2`): tenant `oneplatform`, PlatformGuard, lifecycle tenant (list/create/suspend/restore/delete), UI `/platform/tenants`.

Ricognizione AI betadesk: subsistema Groq mappato, chiave ruotata, piano portare su NestJS (Onda 6).
Prossimo: Onda 2 — identità visiva + homepage portale cliente + dashboard operatore differenziata.

> **Nota log:** il dettaglio macro-task delle **Onde 2–3** (#114–#125) non è ripreso qui ma è tracciato in `docs/handoff/HANDOFF.md` (snapshot rolling, fonte di verità per le sessioni recenti). La voce qui sotto riallinea il log all'Onda 4.

## [2026-06-29] Onda 4 Task 3b — Tariffario orario (#127, ADR-0055)

Chiude il **TD-tariffario** di Onda 3. La tariffa è il **costo orario interno** per ruolo (default) o utente (override) da cui deriva automaticamente `Prestazione.importo` (`ore × tariffa`) → sblocca `importoPrestazioni`/`margine` del report (ADR-0054) e gli insight AI margine (deferiti).

- **Schema**: `TariffaOraria` (`tariffe_orarie`, RLS FORCE), scope esclusivo `roleId` XOR `userId` via CHECK raw SQL + 2 partial-unique soft-delete-aware. Migration `20260629090933_add_tariffe_orarie` applicata al DB condiviso.
- **BE**: `TariffeModule` CRUD `/tariffe` + lookup `/tariffe/{roles,users}`; `resolveTariffaOraria` (override-utente → tariffa-ruolo più alta → null); derivazione importo in `PrestazioniService` su create/update (precedenza manuale > derivato > null); `round2` estratto in `common/money.util`.
- **Permessi** `tariffario.{visualizza,gestisci}` → **58** (56→58), riservati a Socio/Admin (dati sensibili); la derivazione è server-side e non li richiede.
- **FE**: pagina `/tariffario` (CRUD, picker scope ruolo/utente, scope immutabile in modifica), voce sidebar gated per-permesso, hint importo prestazione.
- **GATE**: typecheck/lint/build (api+web), unit 26, **e2e 175** (+25), CI verde, verifica runtime manuale come non-superuser ✅. ADR-0055.
- **Deploy**: container prod rebuildati a inizio sessione da `main` (a `b1abe71`, Onda 3); il codice tariffario (#127) richiede un ulteriore rebuild (migration già applicata).

Prossimo: Onda 4 — superadmin monitoring / impersonation / invito operatore via email; insight AI margine ora sbloccati.

---

## [2026-06-29] i18n superfici operatore — catalogo/mandati/report + timesheet (#129)

Chiude il **TD-i18n-cumulativo**. Esternalizza in **next-intl** le ultime stringhe hardcoded IT delle superfici operatore-studio. **Solo FE**: nessuno schema/migration/permesso/endpoint.

- **4 nuovi namespace** in parità IT↔EN — `catalogo` (riusa `preventivi.um`), `mandati` (lista+dettaglio), `report` (margine), `prestazioni` (timesheet) — **577 chiavi** bilanciate.
- **5 superfici** cablate: `catalogo/page.tsx`, `mandati/page.tsx`, `mandati/[id]/page.tsx`, `report/margine/page.tsx`, `components/mandati/PrestazioniSection.tsx`. Enum (stato/ricorrenza/UM/Sì-No) via chiave dinamica; rimosse le `Record` di label hardcoded. Valori da DB restano in lingua d'origine.
- **GATE**: CHECK-FE-2 parità bidirezionale (577), CHECK-FE-3 zero hardcoded, risoluzione di tutte le chiavi referenziate (incl. dinamiche), typecheck/eslint/prettier; CI #129 verde.
- **Verifica runtime** su dev server come non-superuser (`admin@studio.local` full + `collaboratore@studio.local` ristretto) in IT ed EN, **0 errori console**: catalogo lista+form, mandati lista, dettaglio+timesheet, report table, stringa forbidden tradotta. Per la verifica creato mandato di test `RDL-2026-0002` + 2 prestazioni nel DB dev (lasciati).

Resta aperto il **TD-i18n-zod** (messaggi validazione zod fuori dal contesto React). Prossimo invariato: Onda 4 (superadmin monitoring / impersonation / invito operatore).

---

## [2026-06-29] Picker voce di preventivo nel timesheet + colonna Voce (#132)

Chiude il **TD-voceId-FE** (ADR-0053 sub-DP). `voceId` era già supportato a BE (DTO + `assertVoceDelMandato`) e nei tipi/api-client FE: mancava solo il campo nel form. **Solo FE**: nessuno schema/migration/permesso/endpoint.

- **`mandati/[id]/page.tsx`**: carica le voci del preventivo d'origine (`getPreventivo(aziendaId, preventivoId)` — il `Mandato` espone entrambi) e le passa a `PrestazioniSection`; fetch in `try/catch` (degradazione graceful). Nessun endpoint nuovo: tutti i ruoli con `prestazioni.*` hanno anche `preventivi.visualizza`.
- **`PrestazioniSection.tsx`**: select "Voce di preventivo (opzionale)" nel form + colonna "Voce" in tabella (lookup `voceId→nome`).
- **i18n**: `prestazioni.fields.voce`/`voceNone` + `col.voce` (it/en) → **580 chiavi** in parità.
- **GATE**: parità + risoluzione chiavi, typecheck/eslint/prettier, CI #132 verde. **Verifica runtime** non-superuser su `RDL-2026-0002` (2 voci), IT+EN, **0 errori**: picker popolato, salvataggio con `voceId`, colonna "Voce" valorizzata. Lasciata prestazione di test "Test voce picker" nel DB dev.
- **Deploy**: container prod rebuildati da `main` a fine sessione → allineati a `75476fc`.

Prossimo: Onda 4 (superadmin monitoring / impersonation / invito operatore via email).

## [2026-06-29] i18n messaggi di validazione zod — form operatore + login (#134)

Chiude il **TD-i18n-zod**. I form FE con schema **zod a module-scope** avevano i messaggi di validazione hardcoded IT (fuori dal contesto React → non passavano per `t()`). **Solo FE**: nessuno schema/migration/permesso/endpoint (il BE emette già `errorCode E_*`).

- **Pattern**: schema spostato dentro il componente in `useMemo(() => z.object({...}), [t])` → `t` in scope, messaggi via `t('validation.*')`, identità resolver stabile per locale, tipo da `z.infer<typeof schema>`.
- **6 superfici**: `AziendaForm`, `ReferenteForm`, `ScadenzaForm` (con `superRefine`), `CategoriaForm`, `PreventivoForm` (testata), `login`. Le altre superfici zod (`InvitiSection`, `forgot/reset-password`, `accept-invite`, `platform/tenants`) usavano già `t()` → non toccate.
- **i18n**: nuovi sotto-namespace `validation` per area con chiavi ICU `{max}` per le lunghezze → **605 chiavi** in parità it/en.
- **GATE**: typecheck/eslint/prettier + parità chiavi, CI #134 verde (Lint·Typecheck·Format·Test + E2E Playwright). **Verifica runtime** con login `admin@studio.local`: messaggi tradotti IT (default+cookie) ed EN su login + form interni (Azienda incl. chiave parametrica `emailInvalid` con `{label}`, Scadenza), **0 errori**.
- **Deploy**: container prod rebuildati da `main` → allineati a `735743f`.

Prossimo: Onda 4 (superadmin monitoring / impersonation / invito operatore via email).

## [2026-06-29] Bozza AI risposta operatore — Slice A (#136, ADR-0056)

Prima integrazione **LLM** del prodotto. Nel composer di un thread comunicazioni l'operatore genera una **bozza di risposta** (provider **Groq**, `groq-sdk`); la bozza popola la textarea ed è editabile prima dell'invio. Nessuno schema/migration: feature-flag a runtime.

- **Modulo `ai/` trasversale** (`apps/accountant-api/src/ai/`): `GroqService` (prompt sistema+utente, ultimi 5 messaggi, `temperature 0.4`, `max_tokens 400`) + `AiController` `GET /ai/status` (pubblico → `{ aiEnabled }`, mai la key). Riusabile da future feature AI.
- **Feature-flag su `GROQ_API_KEY`**: assente → `aiEnabled:false`, endpoint **503** (`E_AI_DISABLED`), bottone FE nascosto. Rollout/rollback = presenza della variabile, zero deploy di codice. Errori upstream/vuoti → 503 con `errorCode` stabile (`E_AI_UPSTREAM`/`E_AI_EMPTY`).
- **BE**: `POST /comunicazioni/:id/suggerisci` sotto `comunicazioni.gestisci` (nessun permesso nuovo → catalogo resta **58**); riusa `getById`, **esclude le note interne** (`lato='interno'`). Nessuna persistenza.
- **FE**: bottone "Suggerisci risposta" nel `MessaggioComposer` (gated su `aiEnabled`), errore inline; `getAiStatus()` in parallelo al thread (fail-soft). i18n `comunicazioni.ai.*` it/en in parità.
- **Test**: 10 unit con `groq-sdk` mockato (nessuna chiamata reale in CI). **GATE** statico verde + **CI #136 verde** (Lint·Typecheck·Format·Test + E2E Playwright 14 passed).
- **Verifica runtime** con `GROQ_API_KEY` reale, ruolo non-superuser `collaboratore`: `/ai/status` true, bozza Groq reale (~1.4s), bottone + click → textarea popolata, degradazione `aiEnabled:false` → niente bottone. Lasciata `COM-0002` (apertaDa=cliente) nel DB dev.
- **Deploy**: container prod rebuildati da `main` → allineati a `b18cfae`.

Prossimo: Onda 4 (superadmin monitoring / impersonation / invito operatore via email).

---

## 📌 Contesto rapido

Progetto: piattaforma SaaS gestionale modulare per ristorazione. Vedi `PROJECT_BRIEF.md` per visione completa, architettura, stack, moduli, [BACKLOG].

Owner umano: Nicolò (italiano, lavora da Mac, lavora in mobilità con IP dinamico).

Workflow operativo: 
- **Claude strategico** in chat web Anthropic → consulenza architetturale, validazione decisioni, preparazione prompt.
- **Claude Code** in VS Code Remote-SSH → esecuzione tecnica sul server: file ops, comandi, scaffold.
- **Nicolò** → orchestratore, esegue operazioni manuali (UI Hetzner, GitHub web, password sudo fuori NOPASSWD).

Lingua di lavoro: italiano.

---

## ✅ Completato

### Infrastruttura server

**Hardware:**
- Hetzner Cloud CPX32 (Regular Performance AMD, 4 vCPU, 8 GB RAM, 160 GB SSD NVMe)
- Location: Nürnberg/Falkenstein
- Ubuntu 22.04 LTS, kernel 5.15.0-174-generic
- Backup automatici Hetzner attivi (+20%)
- Hostname: `gestionale-test`

> **Nota storica:** primo tentativo CPX31 risultò deprecato (fine 2025). Hetzner ora usa nomenclatura CX Gen3 / CPX Gen2 / CCX. Scelto CPX32 (Regular Performance AMD Genoa).

**Sistema base:**
- [x] `apt update && upgrade -y` eseguito
- [x] Timezone `Europe/Rome` (CEST/CET in `date`)
- [x] Tooling base installato: `htop`, `ncdu`, `jq`, `git`, `curl`, `wget`, `unzip`
- [x] **Node.js toolchain** (installato il 2026-05-11 notte come prerequisito CI/CD):
  - nvm `v0.40.4` user-space in `~/.nvm` (script `install.sh` ispezionato pre-esecuzione, SHA256 `4b7412c4…`, URL esterni solo `nvm-sh/nvm`)
  - Node `20.18.1` (allineato a `.nvmrc`)
  - corepack upgraded `0.29.4` → `0.34.7` (fix bug noto verifica firme registry npm in corepack `< 0.31`)
  - pnpm `9.15.0` risolto da `packageManager` field via corepack
  - Aggiunte 3 righe standard a `~/.bashrc` (NVM_DIR + sourcing + bash_completion)

**Utenti & SSH:**
- [x] Utente `deploy` creato, password forte salvata da Nicolò
- [x] `deploy` aggiunto al gruppo `sudo`
- [x] `deploy` aggiunto al gruppo `docker` (richiede nuova sessione SSH per attivazione)
- [x] SSH key `~/.ssh/id_ed25519_gestionale` su Mac di Nicolò
- [x] Chiave pubblica caricata su Hetzner durante creazione server
- [x] `/home/deploy/.ssh/authorized_keys` con chiave (permessi 700/600 verificati)

**Hardening SSH (`/etc/ssh/sshd_config.d/99-hardening.conf`):**
- [x] `PermitRootLogin no` (root login completamente disabilitato)
- [x] `PasswordAuthentication no` (solo SSH key)
- [x] `PubkeyAuthentication yes`
- [x] `ChallengeResponseAuthentication no`
- [x] `MaxAuthTries 3`
- [x] `LoginGraceTime 30`
- [x] Test verificati: deploy entra senza password, root rifiutato, password rifiutate

**Firewall UFW:**
- [x] Stato attivo
- [x] Regole: 22/tcp (SSH), 80/tcp (HTTP), 443/tcp (HTTPS) — sia IPv4 sia IPv6
- [x] Default: `deny incoming`, `allow outgoing`

**Fail2ban (`/etc/fail2ban/jail.local`):**
- [x] Jail `sshd` enabled, mode aggressive
- [x] Soglie tolleranti per IP dinamico utente: `bantime=600`, `findtime=300`, `maxretry=10`
- [x] Backend systemd
- [x] Funzionante: IP attaccanti bot vengono bannati automaticamente

**Memoria:**
- [x] Swap file `/swapfile` da 4 GB persistente in `/etc/fstab`
- [x] `/etc/sysctl.d/99-swappiness.conf`: `vm.swappiness=10`, `vm.vfs_cache_pressure=50`

### Docker

- [x] Docker Engine 29.4.3 installato da repo ufficiale Docker (chiave GPG in `/etc/apt/keyrings/docker.asc`, repo in `/etc/apt/sources.list.d/docker.list`)
- [x] Docker Compose v2 plugin v5.1.3
- [x] `/etc/docker/daemon.json` configurato:
  - `log-driver: json-file`
  - `log-opts: max-size 10m, max-file 3`
  - `live-restore: true`
- [x] Test `docker run hello-world` ok (eseguito come `deploy` senza sudo via gruppo `docker`)

### Sudo configuration

- [x] `/etc/sudoers.d/deploy-setup` creato con NOPASSWD limitato a 4 binari:
  ```
  deploy ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/sbin/sysctl, /usr/bin/systemctl
  ```
- [ ] **TODO**: rimuovere `/etc/sudoers.d/deploy-setup` al completamento dello Step 4 (primo `docker compose up` funzionante)

### Mac di Nicolò

- [x] SSH key `~/.ssh/id_ed25519_gestionale` generata
- [x] `~/.ssh/config` con alias `gestionale-test` (User `deploy`, IdentityFile chiave dedicata, ServerAliveInterval 60)
- [x] Test `ssh gestionale-test` funziona da Terminale Mac e da VS Code Remote

### VS Code Remote-SSH

- [x] Estensione Remote-SSH installata
- [x] Connesso a `gestionale-test` come `deploy`
- [x] Workspace: `/home/deploy/projects/gestionale/`
- [x] Claude Code estensione attiva nella finestra remote

**Nota dolente risolta:** dopo aver fatto `usermod -aG docker deploy`, VS Code Remote-SSH non vedeva il nuovo gruppo perché il VS Code Server rimaneva con sessione cached. Risolto con:
```bash
# Da Terminale Mac (NON da dentro VS Code)
ssh gestionale-test
pkill -u deploy -f vscode-server
# Poi Quit + riaprire VS Code, reconnect
```

### File già sul server

- [x] `~/projects/gestionale/PROJECT_BRIEF.md` (66KB, brief completo)
- [x] `~/projects/gestionale/STARTER_PROMPT.md` (11KB, protocollo operativo)
- [x] `~/projects/gestionale/PROGRESS.md` (questo file)

### Monorepo Git + struttura cartelle + stack dev (2026-05-11 sera)

**Repository:**
- [x] `git init` in `~/projects/gestionale/`, branch `main`, identità locale (`MontaNic` / `y2fvvhfc25@privaterelay.appleid.com` come email per i commit)
- [x] Repository GitHub privato `MontaNic/gestionale-piattaforma` creato
- [x] **Deploy Key** dedicata caricata su GitHub (write access) — chiave server-side `~/.ssh/id_ed25519_github`, blocco `Host github.com` in `~/.ssh/config`, **scope ristretto al solo repo** (no chiave account-wide)
- [x] GitHub host key (`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU` ed25519) verificata contro fingerprint pubblico ufficiale e pinnata in `~/.ssh/known_hosts`
- [x] `git push -u origin main` riuscito — primo commit `d6cda3a` su [github.com/MontaNic/gestionale-piattaforma](https://github.com/MontaNic/gestionale-piattaforma)

**Struttura monorepo (sez. A4 brief):**
- [x] Cartelle create: `apps/`, `packages/`, `plugins/`, `infra/{docker,compose,caddy}/`, `docs/{architecture,decisions}/`, `scripts/` (placeholder `.gitkeep` dove vuote)
- [x] `package.json` root: `private: true`, `type: "module"`, `packageManager: pnpm@9.15.0`, `engines.node: ">=20.18.0 <21"`, devDeps minime (typescript, turbo, prettier, eslint, typescript-eslint, @eslint/js, @types/node), scripts placeholder `dev/build/lint/typecheck/test/format` via `turbo run …`
- [x] `pnpm-workspace.yaml` con `apps/*`, `packages/*`, `plugins/*`
- [x] `turbo.json` v2 minimale (tasks: build/dev/lint/typecheck/test)
- [x] `tsconfig.base.json` TS strict completo (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`) + path aliases `@gestionale/* → packages/*/src` e `@apps/* → apps/*/src`
- [x] `eslint.config.js` (ESLint 9 **flat config**, no legacy `.eslintrc.cjs`) con `typescript-eslint` recommended
- [x] `.prettierrc.json` (single quote, trailing comma all, printWidth 100, LF) + `.prettierignore`
- [x] `.editorconfig` (UTF-8, LF, 2 spaces, final newline)
- [x] `.nvmrc` → `20.18.1`
- [x] `.gitignore` (Node, Next, Turbo, env, IDE, OS, log, coverage) e `.gitattributes` (LF normalizzato)
- [x] `README.md` con stack table, struttura cartelle, comandi sviluppo, link ai documenti di progetto

**Architecture Decision Records:**
- [x] `docs/architecture/ADR-0001-caddy-as-container.md` (formalizza la scelta presa il 2026-05-11 mattina: Caddy come container in compose, non come servizio host)

**Stack dev funzionante:**
- [x] `docker-compose.dev.yml` (in root per ora — migrazione futura a `infra/compose/` quando arriveranno staging/prod):
  - `postgres:16-alpine` (verificato 16.13) — volume `postgres_data`, healthcheck `pg_isready`, no porte esposte all'host (accesso via network interna)
  - `redis:7-alpine` — volume `redis_data`, AOF `appendfsync everysec`, healthcheck `redis-cli ping`, no password in dev (TODO documentato per staging/prod)
  - `caddy:2-alpine` — bind mount `./Caddyfile`, volumi `caddy_data`/`caddy_config`, porta `8080:80` (no 443/Let's Encrypt finché non avremo dominio)
  - Network `gestionale_network` (bridge)
- [x] `Caddyfile` placeholder: `:80 { respond "Gestionale - it works!" 200 }`
- [x] `.env.example` committato (template documentato), `.env` reale con `POSTGRES_PASSWORD` 256-bit (`openssl rand -base64 32`), permessi 600, escluso da Git
- [x] Smoke test 3/3 verdi: `psql SELECT version();` → PostgreSQL 16.13, `redis-cli ping` → PONG, `curl localhost:8080/` → 200 + "Gestionale - it works!"
- [x] Container lasciati **up** per task successivi (volumi persistenti)

### Decisioni prese in questa sessione (da aggiungere al log decisionale)

- **2026-05-11**: **ESLint 9 flat config** (`eslint.config.js`), non legacy `.eslintrc.cjs` → evita migrazione obbligatoria entro 6-12 mesi
- **2026-05-11**: `pnpm@9.15.0` come `packageManager` (corepack-driven) + Node `20.18.1` in `.nvmrc` — versioni pinned esatte
- **2026-05-11**: TS strict baseline + `noUncheckedIndexedAccess: true` (più severo del minimo "strict")
- **2026-05-11**: Path aliases TS scelti — `@gestionale/*` per packages condivisi, `@apps/*` per workspace applicativi
- **2026-05-11**: `docker-compose.dev.yml` + `.env` + `Caddyfile` in **root**, non in `infra/compose/` — semplicità per dev iniziale. Quando arriveranno staging/prod, migrazione documentata
- **2026-05-11**: SSH **Deploy Key** del solo repo (no account-wide key) per principio least-privilege; chiave dedicata `~/.ssh/id_ed25519_github` senza passphrase (giustificata da uso server-only)
- **2026-05-11**: GitHub host key pinnata manualmente in `known_hosts` dopo verifica fingerprint contro pubblicazione ufficiale (no `StrictHostKeyChecking=accept-new` opaco)
- **2026-05-11**: ADR-0001 formalizza "Caddy come container"; ADR successivo per strategia ACME quando avremo dominio (vedi "📋 Da fare prossimamente")

### Decisioni prese durante setup (ADR informali, da formalizzare)

- **2026-05-11**: Hetzner CPX32 (non CPX31 deprecato)
- **2026-05-11**: Workflow Scenario B (VS Code Remote-SSH + Claude Code)
- **2026-05-11**: Niente dominio per ora, solo IP del server. SSL/dominio aggiunti in futuro quando serviranno (OAuth, PWA, ecc.)
- **2026-05-11**: Caddy come container in docker-compose, NON installato sull'host (coerente con A3 "tutto in docker")
- **2026-05-11**: Fail2ban con soglie tolleranti (vs. defaults aggressivi) per IP dinamico utente
- **2026-05-11**: Sudo NOPASSWD limitato a 4 binari (apt/apt-get/sysctl/systemctl), non whitelist ampia che Claude Code aveva proposto. Esclusi specificamente: docker, tee, install, chmod, usermod (richiedono password)
- **2026-05-11**: PROGRESS.md inizializzato dopo prima sessione di setup, sarà aggiornato dopo ogni macro-task

### Setup CI/CD GitHub Actions (2026-05-11 notte)

**Workflow CI attivo:**
- [x] `.github/workflows/ci.yml` — trigger su `pull_request → main` e `push → main`, job singolo `Lint · Typecheck · Format` su `ubuntu-latest`, timeout 10min, blocco `concurrency` con `cancel-in-progress` per evitare run sovrapposte
- [x] Setup pnpm via `pnpm/action-setup@v4` (versione letta da `packageManager` del `package.json`) + `actions/setup-node@v4` con `node-version-file: .nvmrc` e `cache: pnpm`
- [x] Step: `pnpm install --frozen-lockfile` → `pnpm format:check` → `pnpm lint` → `pnpm typecheck`
- [x] Primo run CI su `push` su `main` (commit `92c0724`) verde in **33s**
- [x] Primo ciclo PR completato (`feature/ci-test` → PR `#1` → CI verde su `pull_request` in **18s** grazie alla cache pnpm popolata → squash merge → branch eliminato → main resta lineare, commit risultante `b139a7f`)

**Script root sincronizzati al regime CI:**
- [x] `package.json` aggiornato: `lint → eslint .`, `typecheck → tsc --noEmit`, `test → placeholder echo+exit 0`, `format:check → prettier --check .`, nuovo `format:write → prettier --write .`. `dev`/`build` mantengono `turbo run` per quando esisteranno workspace
- [x] `tsconfig.json` root (nuovo): forma canonica solution-style `{files:[], references:[]}` che estende `tsconfig.base.json` — pronta ad accogliere project references quando arriveranno workspace
- [x] `tsconfig.base.json` corretto: rimossi path aliases illegali `@gestionale/*/*` e `@apps/*/*` (violavano TS5061 "max 1 `*` per pattern"). Forme rimaste: `@gestionale/* → packages/*/src/index.ts` e `@apps/* → apps/*/src/index.ts` (barrel pattern standard pnpm)
- [x] `pnpm-lock.yaml` generato + committato (necessario per `--frozen-lockfile` in CI)

**Convenzioni di processo:**
- [x] `.github/PULL_REQUEST_TEMPLATE.md` versione minima (descrizione, tipo Conventional Commit, 3 check base). Versione completa C12 (test, docs, migrazione DB, breaking, API pubbliche, AI tokens, feature flag) rimandata a quando arriverà codice F1
- [x] Badge CI nel README della homepage repo (`actions/workflows/ci.yml/badge.svg`)
- [x] README "Comandi di sviluppo" allineato agli script attuali

**ADR scritti:**
- [x] **ADR-0002** branching strategy: GitHub Flow semplificato (solo `main` + `feature/*` + `fix/*`) + **Squash and merge** obbligatorio da UI GitHub. Divergenza consapevole dal §C12 del brief, motivata da single-dev e nessuna release pubblica. Reintroduzione di `develop` rivalutata quando il progetto diventerà multi-dev o avrà ambiente staging persistente.
- [x] **ADR-0003** Prettier exclusions: i 3 documenti narrativi `PROJECT_BRIEF.md`, `PROGRESS.md`, `STARTER_PROMPT.md` esclusi via `.prettierignore` con commento di rimando all'ADR. Razionale: documenti scritti a mano con tabelle wide e struttura intenzionale, fuori dal regime di formatting automatico.

**Standing rule introdotta:**
- [x] Da oggi: niente più push diretti su `main`. Ogni macro-task → `feature/<topic>` → PR → CI verde → Squash and merge dalla UI da Nicolò. Eccezione one-shot: questo stesso aggiornamento di PROGRESS è andato direttamente su `main` (post-task docs update) per chiudere pulitamente il macro-task; da domani regola applicata senza eccezioni.

### Decisioni prese durante setup CI/CD (2026-05-11 notte)

- **2026-05-11**: Branching strategy = GitHub Flow semplificato + Squash and merge (ADR-0002)
- **2026-05-11**: 3 .md narrativi esclusi da Prettier (ADR-0003)
- **2026-05-11**: Cache pnpm via `actions/setup-node@v4` con `cache: pnpm` (più conciso e ufficiale rispetto a `actions/cache` manuale)
- **2026-05-11**: Script root `lint`/`typecheck`/`test` come comandi diretti finché i workspace sono vuoti — torneranno a `turbo run` quando esisteranno `apps/`/`packages/` reali con i propri task
- **2026-05-11**: nvm v0.40.4 user-space scelto rispetto a NodeSource apt-repo (futuro multi-versione, no impatto sistema, `.nvmrc`-aware)
- **2026-05-11**: Husky / lint-staged / commitlint **rimandati** a macro-task dedicato successivo (priorità più alta: validare CI prima di pre-commit hooks)
- **2026-05-11**: PR template completo C12 **rimandato** a quando arriverà codice F1 — la checklist (test, docs, migrazione DB, breaking, API pubbliche, AI tokens, feature flag) non avrebbe oggetti su cui mordere

### Setup Husky + lint-staged + commitlint (2026-05-12)

**3 git hook locali attivi (`.husky/`):**
- [x] `pre-commit` → `pnpm exec lint-staged` (auto-fix Prettier + ESLint sui soli file in stage)
- [x] `commit-msg` → `pnpm exec commitlint --edit "$1"` (valida Conventional Commits, 11 tipi whitelisted, `subject-case` disabled per IT, `header-max-length` 100)
- [x] `pre-push` → shell script anti-main (blocca `git push origin main` con messaggio guida + link ADR-0004; bypass intenzionale via `--no-verify`)
- [x] Hardening PATH: `pre-commit` e `commit-msg` caricano `nvm` autonomamente (`export NVM_DIR=...; [ -s $NVM_DIR/nvm.sh ] && . $NVM_DIR/nvm.sh`) per funzionare anche in ambienti non-interactive (GUI git client, IDE source control, runner CI minimali). Approccio defensivo: se nvm assente, fall-through al PATH già caricato.

**Versioni installate (devDeps root):**
- `husky@9.1.7`
- `lint-staged@17.0.4`
- `@commitlint/cli@21.0.0`
- `@commitlint/config-conventional@21.0.0`

**Config files:**
- [x] `.lintstagedrc.json` — glob-based: ESLint + Prettier su `*.{ts,tsx,js,jsx}`; Prettier su `*.{json,md,yml,yaml,css}` (rispetta `.prettierignore`)
- [x] `commitlint.config.cjs` — estensione `.cjs` esplicita perché `package.json` ha `"type": "module"` (un `.js` verrebbe caricato come ESM, incompatibile con `module.exports`)
- [x] `package.json` `prepare: "husky"` — install automatico hook su clone fresco
- [x] `eslint.config.js` blocco override per `**/*.cjs` (`sourceType: 'commonjs'` + globals CommonJS) — fix CI red su PR #2 risolto da PR #3 `38861e2`

**Test 6/6 passati:**
1. pre-commit auto-fix Prettier su JSON malformato
2. pre-commit BLOCK su unused-vars TS non auto-fixable
3. commit-msg BLOCK su messaggio non-Conventional
4. commit-msg PASS su Conventional valido
5. pre-push BLOCK su `git push origin main`
6. pre-push PASS su `git push origin feature/*`

**Convenzioni di processo:**
- [x] README sezione "Sviluppo locale" + nuova sotto-sezione "Git hook attivi (Husky)" con descrizione dei 3 hook + bypass `--no-verify`
- [x] README sezione "Convenzioni" aggiornata con doppio rimando ad ADR-0002 (branching) e ADR-0004 (hook)
- [x] **ADR-0004** local git hooks: razionale completo (compensa mancata enforcement server-side GitHub Free privato), 5 alternative considerate, sezione "Hardening PATH per ambienti non-interactive", reversibilità documentata
- [x] PR #2 (`feat: husky + lint-staged + commitlint`) → squash merge → `1178d12` su `main`
- [x] PR #3 (`fix: ESLint flat config for .cjs`) → squash merge → `38861e2` su `main`
- [x] Branch protection / Rulesets su GitHub: **creati ma non enforced** (limite GitHub Free privato, documentato in ADR-0004). Mitigazione: pre-push hook locale + disciplina ferrea "main never force-pushed"

### Decisioni prese durante setup Husky (2026-05-12)

- **2026-05-12**: Husky 9 (non v8) — flat config style, `core.hooksPath = .husky/_/` proxy
- **2026-05-12**: `commitlint.config.cjs` (non `.js`) per compatibilità con `"type": "module"` del root `package.json`
- **2026-05-12**: Hook hardening con source nvm condizionale → self-contained, non invasivi
- **2026-05-12**: `.eslintrc-style ignore` rifiutato in favore di flat config block per `.cjs` (continua a lintare invece di escludere — "fix the root, not the symptom")
- **2026-05-12**: Branch protection lato server **non comprata** (GitHub Free privato non enforce, upgrade Team $4/mese non giustificato per single-dev) → mitigazione client-side via pre-push hook
- **2026-05-12**: Disciplina "main never force-pushed" mantenuta anche dopo l'incident del commit empty `2151e4f` (vedi Incidents log) — precedente di disciplina > pulizia estetica

### Setup Prisma data layer multi-tenancy base (2026-05-12)

**Schema F1 (11 entità in `packages/db/prisma/schema.prisma`):**

- [x] **Tenant root**: `tenants` (id, name, slug unique, is_active, timestamps, soft-delete)
- [x] **Sede operativa**: `sedi` (tenant_id, name, address, city, postal_code, country IT, timezone Europe/Rome, currency EUR, soft-delete, FK tenant CASCADE)
- [x] **Identity tenant-scoped**: `users` (tenantId+email UNIQUE, password_hash argon2, pin_hash F1 POS login, failed_login_attempts, soft-delete; `[PRE F2]` totp_secret/valid_until/badge_nfc_id)
- [x] **Permission catalog globale**: `permissions` (code unique, description, category; no tenant_id, no timestamps — immutabile, seedable)
- [x] **System role templates globali**: `system_role_templates` (name unique, isDefault flag) + `system_role_template_permissions` (M:N PK composta) — pattern bootstrap nuovi tenant via clone
- [x] **Tenant-scoped roles**: `roles` (tenantId+name UNIQUE, isSystem flag, soft-delete) + `role_permissions` (M:N PK composta)
- [x] **User↔Role per sede**: `user_roles` (sede_id NULLABLE per ruoli tenant-wide, assigned_at/by) + **2 UNIQUE INDEX PARZIALI** per gestire NULL semantics PostgreSQL (`*_per_sede_unique` WHERE sede_id IS NOT NULL + `*_tenant_wide_unique` WHERE sede_id IS NULL)
- [x] **Session per device**: `sessions` (user_id CASCADE, sede_id SET NULL, device_type enum nativo `device_type`, refresh_token_hash, expires_at NOT NULL, is_active)
- [x] **Audit log immutabile**: `audit_logs` (tenant_id CASCADE, sede_id/user_id SET NULL, action/entity_type/entity_id, before_value/after_value JSONB, timestamp default NOW(); no updated_at/deleted_at; indice DESC su (tenant_id, timestamp))

**Convenzioni rispettate (§C1 brief):**

- [x] UUID v7 generato app-side via libreria `uuidv7@1.2.1` (no `@default` Prisma → id obbligatorio in ogni create, errore esplicito)
- [x] snake_case in DB / camelCase in TS via `@map` / `@@map`
- [x] FK con `onDelete` esplicito (Cascade/Restrict/SetNull come da matrice — vedi ADR-0005)
- [x] Indici su `tenant_id` ovunque, `(tenant_id, sede_id)` su operative, `refresh_token_hash` su sessions, `(tenant_id, timestamp DESC)` su audit_logs, `(entity_type, entity_id)` su audit_logs
- [x] Timestamps `created_at` / `updated_at` (auto via Prisma `@default(now())` / `@updatedAt`) + `deleted_at?` su entità con soft-delete

**Migration applicate (2 file, ~360 righe SQL):**

- [x] `20260511201706_init_multitenancy_base` — 11 CREATE TABLE + 1 CREATE TYPE (enum device_type) + 16 indici + 15 FK + 2 UNIQUE INDEX PARZIALI per user_roles
- [x] `20260511201927_enable_rls` — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ... USING (true)` su 7 tabelle target. TODO inline F1 auth con 3 pattern di policy reale (tenant_id diretto, EXISTS join, tenants con bypass Super Admin)

**Setup ambiente:**

- [x] Postgres esposto `127.0.0.1:5432:5432` (localhost-only, binding verificato no 0.0.0.0)
- [x] `DATABASE_URL` in root `.env` + esempio in `.env.example`
- [x] Script Prisma in `packages/db` wrappati da `dotenv-cli` per leggere root `.env`
- [x] Prisma `6.19.3` + `@prisma/client` `6.19.3` + `uuidv7` `1.2.1` + devDeps `tsx`, `dotenv-cli`, `@types/node`
- [x] `packages/db/src/index.ts` stub (re-export `PrismaClient`, `Prisma`); soft-delete extension + uuidv7 helper rimandati a macro-task successivo

**Convenzioni di processo:**

- [x] **ADR-0005** data layer: 4 decisioni (location packages/db, UUID v7 app-side, RLS placeholder, soft-delete extension), 3 pattern policy RLS reale identificati, sezione "RBAC e NULL semantics" su user_roles, alternative considerate tabellate, reversibility documentata

### Decisioni prese durante setup Prisma (2026-05-12)

- **2026-05-12**: Prisma in `packages/db` (divergenza consapevole da §A4 brief, ADR-0005). Riusabile da api/web/worker/script.
- **2026-05-12**: Prisma 6.19.3 (non 7) perché Prisma 7 richiede Node 20.19+; abbiamo 20.18.1 in `.nvmrc`. Upgrade a 7 quando si bumperà Node, migrazione meccanica.
- **2026-05-12**: UUID v7 app-side via `uuidv7` npm. No `pg_uuidv7` extension (overhead operativo), no UUID v4 (no sortability).
- **2026-05-12**: ID `String @id` senza default → omettere id in create() è errore esplicito. Helper wrapper arriverà in macro-task successivo.
- **2026-05-12**: RLS attivato subito con policy `USING (true)` placeholder. Ragione: dimenticarla dopo è anti-pattern; abilitarla su DB con dati e' costoso, ora è gratis.
- **2026-05-12**: Schema separato in 2 migration (init + enable_rls) per facilitare rollback chirurgico dev.
- **2026-05-12**: System role templates come tabella separata (opzione c rispetto a tenant "system" sentinel o tenant_id nullable). Pulizia semantica, bootstrap pattern chiaro.
- **2026-05-12**: 2 UNIQUE INDEX parziali su `user_roles` via SQL raw in migration init (Prisma `@@unique` non esprime UNIQUE parziali). Commento esplicativo 18 righe in-file.
- **2026-05-12**: `role_permissions` skip RLS — isolamento indiretto via FK→roles, defense-in-depth da valutare quando si scriveranno policy reali.
- **2026-05-12**: Soft-delete via Prisma extension client-side (non middleware deprecato). Implementazione rimandata a macro-task successivo.
- **2026-05-12**: `DATABASE_URL` nel root `.env` + `dotenv-cli` wrapper. No secondo `.env` in packages/db.
- **2026-05-12**: Postgres dev esposto su `127.0.0.1:5432` (no 0.0.0.0) — UFW non serve modifica, binding localhost basta.

### Completamento Prisma data layer (Macro-task B, 2026-05-12)

Chiusura della fase Prisma con seed catalog, soft-delete extension e helper esportati. Macro-task A formalmente chiuso in questa stessa PR.

**Migration intermedia:**

- [x] `20260511204441_add_permission_is_pre_f2` — aggiunge `permissions.is_pre_f2 BOOLEAN NOT NULL DEFAULT false` per supportare il flag F2 nel catalog seedato

**Helper + factory + singleton (`packages/db/src/index.ts`):**

- [x] `id()` → `string`: wrapper su `uuidv7()` per generare UUID v7 fresh (obbligatorio in ogni `create()` per via di `@id` senza default Prisma)
- [x] `uuidv7` re-export raw
- [x] `createPrismaClient()` factory: nuova istanza extended con `softDeleteExtension`. Per NestJS DI / test isolati.
- [x] `prisma` singleton eager: istanza al primo import del modulo; connessione TCP al DB resta lazy (Prisma 6). Per script seed/smoke/utility.
- [x] Type `ExtendedPrismaClient` esportato

**Soft-delete extension (`packages/db/src/soft-delete.ts`):**

- [x] **Auto-detect**: `modelsWithDeletedAt` set built al boot da `Prisma.dmmf.datamodel.models[].fields[].name === 'deletedAt'`. Niente lista hardcoded.
- [x] **Query intercept** (`findUnique`, `findFirst`, `findMany`, `count`, `aggregate`, `groupBy`): inject `where.deletedAt = null` se model match E `where` non esplicita `deletedAt`. Helper `withSoftDeleteFilter()` con cast `as any` interno (runtime-safe via guard).
- [x] **Escape esplicito**: `'deletedAt' in where` → no injection. Permette query "cestino" (`where: { deletedAt: { not: null } }`) e admin history.
- [x] **Delete intercept** (`delete`, `deleteMany`): trasforma in `update`/`updateMany` con `data: { deletedAt: new Date() }`. Warning in-file: `deleteMany()` senza `where` = soft-delete dell'intero modello (intenzionale).
- [x] **`forceDelete(where: { id })`** model extension: bypass via `$executeRawUnsafe('DELETE FROM "<table>" WHERE id = $1', id)`. Lookup tableName via `Prisma.dmmf.datamodel.models[].dbName`. ON DELETE CASCADE/SET NULL rispettati. Use case: GDPR right-to-erasure, cleanup admin.

**Seed (`packages/db/prisma/seed.ts`, idempotente):**

- [x] **32 permessi atomici namespaced** in 8 categorie: `sistema.*` (8), `anagrafica.*` (4), `menu.*` (5), `comande.*` (5), `cassa.*` (4), `report.*` (3), `magazzino.*` (2 con `isPreF2: true`), `ai.*` (1 con `isPreF2: true`)
- [x] **6 system role templates** con `isDefault: true` (auto-clonati a ogni nuovo tenant): Super Admin (32 perm), Admin sede (31), Direzione (24), Cassiere (10), Cameriere (4), Cucina/Bar (3)
- [x] **104 mappings** template ↔ permission via `system_role_template_permissions` (PK composta)
- [x] Upsert pattern su unique key (code/name) e PK composta — re-esecuzione safe (verificato: re-run produce 0 created / N updated/re-affirmed, count DB invariati)
- [x] Config `package.json#prisma.seed = "tsx prisma/seed.ts"` + script wrapper `db:seed` con `dotenv-cli`

**Smoke test (`packages/db/scripts/smoke-soft-delete.ts`):**

- [x] 5 scenari, 9 assertion, tutti verdi:
  1. Create + findUnique trova
  2. Delete → findUnique null, riga still in DB con escape esplicito
  3. findMany cestino include soft-deleted
  4. count default = 0, count con escape = 1
  5. forceDelete → riga sparita anche con escape
- [x] Autopulizia (scenario 5 forceDelete del tenant smoke-test)
- [x] Script wrapper `smoke:soft-delete` con `dotenv-cli`

**Fix tsconfig packages/db:**

- [x] Rimosso `rootDir: ./src` (irrilevante con `noEmit: true`), aggiunto include `scripts/**/*.ts`. Tutti i sorgenti TS del workspace ora sotto `pnpm --filter @gestionale/db typecheck`.
- [ ] **Issue parallelo da risolvere prima del scaffold NestJS**: root `pnpm typecheck` (tsconfig solution-style) non propaga ai workspace; CI non rileva errori TS. Vedi "📋 Da fare prossimamente → Qualità codice / processo".

### Decisioni prese durante Macro-task B (2026-05-12)

- **2026-05-12**: `forceDelete` via `$executeRawUnsafe` (opzione A) per bypass extension senza ricorsione. Firma `where: { id: string }` restrittiva ma sicura.
- **2026-05-12**: `prisma` singleton eager (no Proxy lazy). Costo memoria trascurabile, connessione DB resta lazy.
- **2026-05-12**: `deleteMany()` senza `where` = soft-delete totale by design. Documentato in-file.
- **2026-05-12**: Campo `isPreF2` (vs `isPrerelease`) coerente con commenti `[PRE F2]` sparsi nel codice. Migration intermedia per aggiungerlo al schema.
- **2026-05-12**: `isDefault: true` per tutti i 6 system_role_templates seedati — sono i ruoli base che ogni nuovo tenant eredita.
- **2026-05-12**: Smoke test pragmatico (tsx + assertion manuali) invece di Vitest setup ora. Framework test rimandato a sessione NestJS auth quando ci sarà primo unit test reale.
- **2026-05-12**: Pattern dotenv-cli esteso a tutti gli script che usano Prisma (`db:seed`, `smoke:*`), non solo `prisma:*` di prima.

### Strategia typecheck monorepo (Macro-task C, 2026-05-13)

Quick win di tooling che chiude il gap CI scoperto durante Macro-task B prima di affrontare lo scaffold NestJS.

**Modifiche:**

- [x] `package.json` root: `scripts.typecheck` da `"tsc --noEmit"` a `"turbo run typecheck"` — propaga ai workspace via Turbo
- [x] `turbo.json`: rimosso `dependsOn: ["^build"]` da task `typecheck` (no build step oggi; reintrodurremo con NestJS se servirà)
- [x] `packages/db/package.json`: invariato (script `typecheck: "tsc --noEmit"` già presente)
- [x] `.github/workflows/ci.yml`: invariato (step `pnpm typecheck` propaga automaticamente ora)

**Failure injection test** (validazione empirica):

| Scenario | Atteso | Misurato |
|---|---|---|
| Cache miss vuoto | `tsc` esegue, OK | ✅ 1.136s, hash `23e2d6404c6783a9` |
| Cache hit vuoto | `>>> FULL TURBO` | ✅ **54ms**, stesso hash |
| Errore TS injection | exit 2, TS2322 catturato | ✅ exit 2, `'number' is not assignable to type 'string'` |
| Cleanup | exit 0, hash ripristinato | ✅ 48ms, stesso hash di partenza (file byte-identico) |

**Gap chiuso e dimostrato.** Speedup re-run locale: **21×** (1.1s → 54ms).

**Convenzioni di processo:**

- [x] **ADR-0006** strategia typecheck monorepo: razionale (gap CI scoperto Macro-task B), implementation details, 4 alternative considerate (turbo chosen, pnpm -r rejected, Project References rimandato, lasciare gap rejected), reversibility documentata, sezione "Test di validazione" con failure injection matrix
- [x] PR #7 (`ci: fix typecheck propagation to workspace packages via Turbo`) — in corso di apertura/merge

### Decisioni prese durante Macro-task C (2026-05-13)

- **2026-05-13**: Approccio (a) `turbo run typecheck` scelto come orchestratore. Coerente con `dev`/`build` già su Turbo. Pattern scalabile (nuovi workspace TS auto-inclusi).
- **2026-05-13**: TS Project References (opzione c) **rimandato** finché non avremo 5+ workspace o build incrementale necessario. Setup non banale, beneficio reale solo a scala.
- **2026-05-13**: Cache Turbo in CI **non configurata** (oggi CI ~30s adeguato). Follow-up tracciato per quando diventerà bottleneck.
- **2026-05-13**: Rimosso `dependsOn: ["^build"]` da `turbo.json` task `typecheck` — coerenza dichiarazione vs realtà (no build step oggi). Reintroduciamo con il primo workspace che ha build.

### D1 NestJS scaffold + healthcheck (Macro-task D1, 2026-05-13)

Backend NestJS in `apps/api/`, consumer di `@gestionale/db`. Scaffold base con DbModule + HealthModule. Niente auth, niente business logic (rimandati a D2/D3/D4).

**Scaffold manuale (no `nest new`):**

- [x] `apps/api/package.json` — `@gestionale/api`, CJS (no `type: module`), deps NestJS 11 + workspace `@gestionale/db@workspace:*`
- [x] `apps/api/tsconfig.json` — estende `tsconfig.base.json`, override `module: commonjs` + `moduleResolution: node`, `experimentalDecorators` + `emitDecoratorMetadata`, `noEmit: true` (dev via ts-node-dev)
- [x] `apps/api/nest-cli.json` — per `nest build` futuro
- [x] `apps/api/src/main.ts` — bootstrap + `app.enableShutdownHooks()` per graceful SIGTERM
- [x] `apps/api/src/app.module.ts` + `app.controller.ts` (GET `/` → "Gestionale API")
- [x] `apps/api/src/db/{db.module.ts, db.service.ts}` — `@Global` + composition wrapper su `prisma` singleton + `OnModuleInit`/`OnModuleDestroy` lifecycle (`$connect`/`$disconnect` con log)
- [x] `apps/api/src/health/{health.module.ts, health.controller.ts, health.service.ts, health.dto.ts}` — GET `/health` con `$queryRaw\`SELECT 1\``, HTTP 200/503 semantico via `ServiceUnavailableException`

**Modifiche correlate (4 course corrections):**

- [x] **CC1**: dev runner = `ts-node-dev --respawn --transpile-only` (NOT tsx — non emette `emitDecoratorMetadata` necessario a NestJS DI). Valutato empiricamente swc (13 min, fallback): swc/nest -b swc presuppongono build→dist→run, incompatibile con consumo TS-source-live di workspace deps via symlink
- [x] **CC2**: `packages/db/package.json` rimosso `"type": "module"` per CJS interop con apps/api. Asimmetria CJS/ESM evitata, tech debt esplicito tracciato (vedi sezione sotto)
- [x] **CC3**: rimosso `.js` suffix da import interni di `packages/db/src/index.ts`, `prisma/seed.ts`, `scripts/smoke-soft-delete.ts` (conseguenza diretta di CC2: `.js` suffix non risolve in CJS)
- [x] **CC4**: `app.enableShutdownHooks()` in main.ts → SIGTERM/SIGINT propaga `OnModuleDestroy` ai provider, `$disconnect` graceful

**Convenzioni di processo:**

- [x] ESLint override scoped `apps/api/**/*.ts` accentrate nel root `eslint.config.js` (flat config 9 no config-discovery): `experimentalDecorators` + disable `no-extraneous-class`, `no-useless-constructor`, `consistent-type-imports` (necessari per pattern NestJS DI/Module)
- [x] `.env.example` aggiornato con `PORT` (commentato, default 3000)
- [x] Pattern `dotenv-cli` esteso a `dev` e `start:prod` di apps/api (coerente con packages/db)
- [x] **ADR-0007** scaffold + 4 course corrections + sezione "Tech Debt Accepted" esplicita + sezione "Empirical Evidence" con swc detour 13 min
- [x] PR #8 (`feat: NestJS API scaffold with healthcheck endpoint and DbModule`) — in corso

**Verifica runtime end-to-end:**

```
$ curl http://localhost:3000/      → 200 "Gestionale API"
$ curl http://localhost:3000/health → 200 {"status":"ok","db":"connected","timestamp":"..."}

Lifecycle log:
[NestFactory] Starting Nest application...
[DbService] Prisma connected to PostgreSQL  ← OnModuleInit OK
[NestApplication] Nest application successfully started
[Bootstrap] Gestionale API listening on http://localhost:3000

Quality gates: format + lint + typecheck (Turbo 2/2 workspace) ALL GREEN
Smoke regression packages/db: 9/9 verdi (no regression post-CC2/CC3)
```

### Decisioni prese durante D1 NestJS (2026-05-13)

- **2026-05-13**: NestJS 11 + manual scaffold (aderenza monorepo)
- **2026-05-13**: CJS apps/api + packages/db (CC2). Asimmetria CJS/ESM rifiutata
- **2026-05-13**: ts-node-dev per dev (swc detour empirico documentato in ADR-0007 "Empirical Evidence")
- **2026-05-13**: DbModule `@Global` + DbService **composition** (non inheritance). `OnModuleInit`/`OnModuleDestroy` per lifecycle Prisma
- **2026-05-13**: HTTP 200/503 semantico via `ServiceUnavailableException` su `/health`
- **2026-05-13**: `app.enableShutdownHooks()` attivo dal D1 (CC4)
- **2026-05-13**: ESLint override scoped per apps/api accentrate nel root config (no config-discovery in flat config 9)
- **2026-05-13**: `tsconfig.json` apps/api con `noEmit: true` — build futura via `tsconfig.build.json` dedicato

### D2a Auth module — email/password + JWT + refresh rotation (Macro-task D2a, 2026-05-13 notte)

Backend auth funzionante end-to-end. Scope ridotto rispetto al D2 monolitico per disciplina tempi (calibrazione 5h vs 3h sottostimato): D2-vitest e D2b in macro-task separati.

**Endpoint attivi (6, sotto `/api/v1/`):**

- [x] GET `/` (Public) — root, "Gestionale API"
- [x] GET `/health` (Public) — DB ping, 200/503 semantico
- [x] POST `/auth/login` (Public, header `X-Tenant-Slug` required) — email + password + tenant → JWT pair + session record
- [x] POST `/auth/refresh` (Public, tenantId dal JWT payload) — rotation: vecchia session `is_active: false`, nuova creata
- [x] POST `/auth/logout` (Protected) — session corrente disattivata, 204
- [x] GET `/me` (Protected) — user + roles + 32 permissions flat dal DB (no JWT inlining)

**Pattern auth (10 decisioni, ADR-0008):**

- [x] **Argon2id** per password hashing (vincitore PHC 2015, OWASP 2023+)
- [x] **JWT HS256** con `@nestjs/jwt` (secret 64-byte base64 da `openssl rand -base64 48`)
- [x] **Payload minimal**: `{sub, tenantId, sessionId, type, iat, exp}` — niente roles/permissions inline (revoca istantanea, no stale token)
- [x] **Refresh rotation BASE**: token rotato → vecchia session disattivata + nuova creata + new pair returned. Detection FULL (revoke all on reuse) → D2-vitest
- [x] **JwtAuthGuard globale** security-by-default + `@Public()` opt-out (root, /health, /auth/login, /auth/refresh)
- [x] **Tenant resolution via header `X-Tenant-Slug`** scoped a `/auth/login` only (TenantMiddleware). Post-auth tenantId dal JWT payload — anti-spoofing
- [x] **Audit log best-effort** in `audit_logs` su login.success / login.failure / logout (wrapped try/catch, audit fail non blocca auth)
- [x] **failed_login_attempts counter** incrementato su wrong password, reset su login success (anti-brute baseline F1)
- [x] **No info leak** su credenziali: stesso `E_AUTH_INVALID_CREDENTIALS` per email-non-esiste / password-errata / utente-disabilitato
- [x] **Sessioni stateful** in tabella `sessions`: device_id=user_agent slice, device_type='web' (D2b distinguera POS), refresh_token_hash argon2, expires_at NOT NULL, is_active per soft-revoke

**Smoke E2E 10/10 verdi** (eseguito 2026-05-13 00:20 UTC):

| # | Scenario | Esito |
|---|---|---|
| 1 | GET /health | ✅ 200 |
| 2 | POST /auth/login con tenant + admin | ✅ 200 + JWT pair |
| 3 | GET /me con access token | ✅ 200 + user + role + 32 permissions flat |
| 4 | POST /auth/refresh | ✅ 200 + new pair, session rotated |
| 4b | Vecchio refresh re-use | ✅ 401 |
| 4c | GET /me con NEW_ACCESS | ✅ 200 |
| 5 | POST /auth/logout | ✅ 204 |
| 5b | GET /me post-logout | ✅ 401 (session is_active=false) |
| 6 | POST /auth/login senza X-Tenant-Slug | ✅ 401 E_AUTH_TENANT_REQUIRED |
| 7 | POST /auth/login wrong password | ✅ 401 E_AUTH_INVALID_CREDENTIALS |

**Seed dev data (opt-out via NODE_ENV=production):**

- [x] `packages/db/prisma/seed.ts` esteso: tenant "demo" + sede "Sede Principale" + admin@demo.local (password Admin123! argon2 hashed, pin NULL) + role "Super Admin" tenant-scoped + 32 mappings cloni da template + user_role assignment tenant-wide
- [x] Verifica DB count post-seed: tenants=1, sedi=1, users=1, roles=1, role_permissions=32, user_roles=1 (idempotente con upsert)

**File creati (24 nuovi in apps/api/src/):**

- `auth/`: auth.module.ts, auth.controller.ts, auth.service.ts, strategies/jwt.strategy.ts, guards/jwt-auth.guard.ts, decorators/public.decorator.ts, decorators/current-user.decorator.ts, interfaces/jwt-payload.interface.ts, interfaces/authenticated-request.interface.ts, dto/{login,refresh,auth-response}.dto.ts
- `tenant/`: tenant.module.ts, tenant.middleware.ts, decorators/current-tenant.decorator.ts
- `users/`: users.module.ts, users.service.ts
- `me/`: me.module.ts, me.controller.ts

**File modificati (5):**

- `apps/api/src/main.ts` — `setGlobalPrefix('api/v1')` + `useGlobalPipes(ValidationPipe)`
- `apps/api/src/app.module.ts` — imports nuovi moduli + TenantMiddleware scoped a `/auth/login` only
- `apps/api/src/app.controller.ts` — `@Public()` su GET `/`
- `apps/api/src/health/health.controller.ts` — `@Public()` su GET `/health`
- `.env.example` — placeholder `JWT_SECRET` + comando openssl

**Dipendenze installate (apps/api):**

- `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`
- `argon2`, `class-validator`, `class-transformer`
- devDeps: `@types/passport-jwt`

### Decisioni prese durante D2a (2026-05-13 notte)

- **2026-05-13**: Scope split D2a / D2b / D2-vitest per disciplina tempi (calibrazione 5h vs 3h sottostimata). PR coordinate: D2a auth base + ADR-0008, D2-vitest test framework, D2b PIN POS
- **2026-05-13**: **Scoperta importante** — migration `unique_pin_per_tenant` rimossa (era nel prompt originale). Argon2 salt random vanifica la unique constraint: hash di "1234" per user A != hash per user B → constraint non scatta mai per duplicati clear-text. Falsa sicurezza. Soluzione D2b: verifica applicativa via `argon2.verify()` loop su `usersWithPin` del tenant
- **2026-05-13**: TenantMiddleware scoped SOLO a `/auth/login` (e in D2b a `/auth/login-pin`). `/auth/refresh` deriva tenantId dal payload JWT del refresh token. Pattern anti-spoofing
- **2026-05-13**: JWT payload minimal `{sub, tenantId, sessionId, type, iat, exp}` — roles/permissions lookup runtime dal DB per revoca istantanea
- **2026-05-13**: JwtAuthGuard globale via APP_GUARD + `@Public()` opt-out (security-by-default). Endpoint pubblici: root, /health, /auth/login, /auth/refresh
- **2026-05-13**: Audit log best-effort (try/catch + Logger warn su fail). Fail audit non blocca auth — accettato per F1
- **2026-05-13**: `failed_login_attempts` counter base solo (no rate limiting in D2a). Auth hardening macro-task per Redis throttler + IP lockout
- **2026-05-13**: Seed dev data opt-out (`NODE_ENV !== 'production'`) — convenience by default, safety via env explicit in prod
- **2026-05-13**: Theft detection BASE in D2a (vecchio refresh → 401). Detection FULL (revoke all su token rotato re-used) rimandata a D2-vitest

### D2-vitest — Vitest baseline + theft detection FULL (2026-05-13 notte tardi)

Setup framework test del monorepo + chiusura decisione 10 di ADR-0008 (Vitest rimandato).

**Vitest setup:**

- [x] **Vitest 3.2.4** (downgrade da 4.1.6 — bug native binding rolldown irrisolto da pnpm)
- [x] **`projects` array** in `vitest.config.mts` root (API Vitest 4-ready, no `workspace` field deprecato)
- [x] **`.mts` extension** per config (Vite 7 ESM-only, apps/api CJS preserved)
- [x] **`apps/api/test/setup.ts`** placeholder per future global mocks
- [x] **`--passWithNoTests`** su script `test`/`test:coverage` (workspace senza spec non rompono)
- [x] **`turbo.json` task test**: rimosso `dependsOn: ["^build"]` (test indipendenti)
- [x] **Root script** `test`: da placeholder a `turbo run test`

**Theft detection FULL (`AuthService.refresh`):**

- [x] Decision tree 5 scenari: JWT invalid / session absent / hash mismatch / session active + hash match (rotation) / session NOT active + hash match (**THEFT**)
- [x] Theft action: `updateMany` revoke all user sessions con `isActive: true` + audit `auth.theft_detected` con payload forense `{revokedSessionCount, suspectedSessionId, attackerIp, attackerUserAgent}` + throw `E_AUTH_THEFT_DETECTED`
- [x] Audit actions enum espanso: `auth.{login.success, login.failure, logout, refresh.success, theft_detected}`
- [x] Logger warn esplicito su theft detection (alert-friendly)

**4 test essential (`apps/api/src/auth/auth.service.spec.ts`):**

| # | Test | Esito |
|---|---|---|
| 1 | login success → JWT pair + session + audit `auth.login.success` | ✅ |
| 2 | login wrong password → throws + `failed_login_attempts++` + audit `auth.login.failure` reason `wrong_password` | ✅ |
| 3 | login user not found → throws E_AUTH_INVALID_CREDENTIALS (no info leak) + audit reason `user_not_found_or_inactive` | ✅ |
| 4 | refresh con rotated token → `updateMany({userId, isActive: true})` revoke all + audit `auth.theft_detected` con payload forense completo + throws E_AUTH_THEFT_DETECTED | ✅ |

Run: `pnpm test` → 4 passed (8ms), 380ms total setup.

**E2E smoke verifica empirica** (2026-05-13 00:41 UTC):

1. Login → refresh_A
2. refresh(refresh_A) → refresh_B (rotation, vecchia session `is_active=false`)
3. refresh(refresh_A) re-use → **HTTP 401 E_AUTH_THEFT_DETECTED**
4. `SELECT COUNT(*) FROM sessions WHERE user_id=admin AND is_active=true` → **0** (entrambe revocate)
5. `SELECT * FROM audit_logs WHERE action='auth.theft_detected'` → 1 row con `afterValue = {attackerIp, attackerUserAgent, suspectedSessionId, revokedSessionCount: 1}` ✅

### Decisioni prese durante D2-vitest (2026-05-13 notte tardi)

- **2026-05-13**: Vitest 3.2.4 (no 4.x) — bug rolldown native binding pnpm. Stabile, Vite 7-compatible
- **2026-05-13**: `.mts` extension per config Vitest — necessario per Vite 7 ESM-only senza toccare CJS apps/api
- **2026-05-13**: **Bypass DI container** nei test — instanziazione manuale `new AuthService(mockDb, mockUsers, mockJwt)`. Motivo: esbuild Vitest non emette `emitDecoratorMetadata` (stesso problema D1 con tsx). Trade-off accettato: test business logic isolata vs DI tree validation. E2E test (full bootstrap) in macro-task futuro
- **2026-05-13**: Mock argon2 + @gestionale/db module-level via `vi.mock()`. Determinismo + zero CPU cost del KDF reale
- **2026-05-13**: Theft action = revoke ALL + audit forense (no email notify F1). Defense in depth: anche legittimo costretto re-login. Email notification in macro-task "Auth E2E hardening" insieme rate limiting
- **2026-05-13**: Turbo task `test`: rimosso `dependsOn: ["^build"]` (test indipendenti, parallelismo dev locale, cache cleanliness)
- **2026-05-13**: Audit log `auth.refresh.success` aggiunto come action distinta da `auth.login.success` (analytics tracking, joint via `previousSessionId` in afterValue)

### D2b — PIN POS login (Macro-task D2b, 2026-05-13 notte tardi)

Auth completata con flusso PIN dedicato ai terminali POS. Scope: 2 endpoint + uniqueness applicativa + 4 audit actions + 2 test essential + smoke E2E 8 scenari.

- [x] **POST `/api/v1/auth/pin-setup` (Protected)** — re-auth `currentPassword` (OWASP) + validazione formato PIN (`^\d{4,6}$`) + check forbidden patterns (~60 entries hardcoded: all-same + sequenziali asc/desc 4/5/6 cifre) + uniqueness applicativa via `argon2.verify` loop su `findAllWithPinByTenant(tenantId, excludeId=userId)` + `argon2.hash` + `users.pin_hash` update. Idempotente (overwrite permesso, audit discriminato).
- [x] **POST `/api/v1/auth/login-pin` (Public)** — header `X-Tenant-Slug` obbligatorio (TenantMiddleware scoped al path) + DTO `{pin, deviceId, deviceType}` con `deviceType ∈ {pos_tablet, pos_desktop, mobile}` (escluso `web`) + scan argon2.verify sui candidati `pin_hash != null AND isActive` + emette JWT pair + session con `deviceId`/`deviceType` overrides.
- [x] **`apps/api/src/auth/utils/pin-validator.ts`**: `FORBIDDEN_PINS: ReadonlySet<string>` (~60 entries) + `validatePin()` con errore `E_AUTH_PIN_FORBIDDEN_PATTERN`.
- [x] **DTO**: `PinSetupDto` (currentPassword min 8 + pin regex) e `LoginPinDto` (pin regex + deviceId 1-64 + deviceType `@IsIn`).
- [x] **`UsersService` esteso**: `findAllWithPinByTenant(tenantId, excludeId?)` + `setPinHash(userId, hash)`.
- [x] **4 nuove audit actions** (totale 9): `auth.pin.setup` (wasReset:false), `auth.pin.reset` (wasReset:true), `auth.login_pin.success`, `auth.login_pin.failure`. Re-auth fallito su pin-setup riusa `auth.login.failure` con `reason: 'pin_setup_password_check_failed'`.
- [x] **2 nuovi test essential** (totale 6): test 5 verifica setupPin success path (argon2.hash + setPinHash + audit setup); test 6 verifica loginPin scan multi-candidate (verify false → true) + session POS + audit login_pin.success.
- [x] **TenantMiddleware esteso**: `auth/login-pin` aggiunto a `forRoutes` (pre-auth, no JWT da cui derivare tenantId).
- [x] **Smoke E2E 8 scenari verdi** (PIN `4827` random non-pattern): login admin → pin-setup OK → pin-setup forbidden 1234 → wrong password 401 → login-pin success → login-pin wrong 0000 → /me con PIN token → DB session deviceType=pos_tablet.

#### Decisioni prese durante D2b (2026-05-13 notte tardi)

- **2026-05-13**: PIN regex `^\d{4,6}$` (no separator). Tastiere POS numeriche; lunghezza variabile per UX/security trade-off.
- **2026-05-13**: `FORBIDDEN_PINS` set hardcoded (~60 entries: all-same + sequenziali asc/desc per 4-6 cifre). Niente file/rete; revocabile/estendibile in-source.
- **2026-05-13**: **Uniqueness via argon2.verify loop** (decisione critica). Migration `unique_pin_per_tenant` rifiutata: argon2 salt random → hash dello stesso PIN sono diversi → l'index non scatta mai per duplicati clear-text (falsa sicurezza). F1 OK con N piccolo (poche user/tenant). Tech debt F2: HMAC-SHA256(pin, tenantSalt) come `pin_lookup` indicizzato.
- **2026-05-13**: PIN overwrite consentito + audit discriminato `auth.pin.setup` (pin_hash era NULL) vs `auth.pin.reset` (overwrite). UX: utente puo' resettare il proprio PIN senza percorso admin.
- **2026-05-13**: Re-auth `currentPassword` su pin-setup (OWASP "Authentication-sensitive operation"). Mitigazione XSS/session hijack.
- **2026-05-13**: `login-pin` failure NON incrementa `failed_login_attempts` (counter e' per coppia email+password). Tech debt F1+: rate limit dedicato per `(tenantId, deviceId, ip)` in Redis bucket.
- **2026-05-13**: `deviceType` login-pin esclude `web` (DTO `@IsIn` ammette solo pos_tablet/pos_desktop/mobile). `web` non e' POS.
- **2026-05-13**: Single error code `E_AUTH_INVALID_CREDENTIALS` per PIN wrong / no match. No info leak (stesso pattern login email/password).
- **2026-05-13**: Smoke test PIN `4827` (random non-pattern) invece di `5678` originalmente proposto (sequenziale, sarebbe stato rifiutato dal validator).

### D3a — RLS framework (Macro-task D3a, 2026-05-13 notte fonda)

Framework Row Level Security operativo a livello applicativo. **NON attiva il enforcement reale** (policy DB ancora placeholder, postgres user bypassa RLS). Necessario D3b per security activation.

- [x] **AsyncLocalStorage context** (`packages/db/src/rls.ts`): `TenantContext` type + ALS singleton + helpers `getTenantContext`, `runInTenantContext(ctx, fn)`, `withSystemContext(fn)`, `withSuperAdminContext(tenantId, fn)`.
- [x] **rlsExtension factory** (`packages/db/src/rls.ts`): Prisma extension `$allOperations` wrappa ogni query in `$transaction` interactive con `SET LOCAL app.tenant_id` + `SET LOCAL app.is_super_admin`. Fail-fast `RlsNoContextError` se context mancante.
- [x] **R3 fix F1 + re-entrancy guard**: scoperto empiricamente a STOP 1 che `query(args)` non eredita il tx context di Prisma. Workaround: `(tx as any)[modelLower][operation](args)` + `inflightStorage` ALS guard per recursion. Documentato in rls.ts + ADR-0009.
- [x] **Wire extension** in `packages/db/src/index.ts`: chain `softDeleteExtension` → `rlsExtension`. Re-export RLS API.
- [x] **TenantContextInterceptor** (`apps/api/src/context/tenant-context.interceptor.ts`): NestJS Interceptor globale registrato via `APP_INTERCEPTOR`, wrappa handler in `runInTenantContext({tenantId: req.tenantId, isSuperAdmin: false})` via Observable/Promise bridge (firstValueFrom). Skip per Public senza tenant.
- [x] **TenantMiddleware refactor**: slug lookup in `withSystemContext`, resolve → `runInTenantContext` wrappa il `next()` per propagare ALS al resto della chain.
- [x] **AuthService.refresh wrap**: `/auth/refresh` non passa per middleware tenant → wrap interno con `runInTenantContext({tenantId: payload.tenantId, false})` dopo JWT decode. Refactor `refresh` + `refreshInContext`.
- [x] **Health service wrap** in `withSystemContext` (anche se `$queryRaw` bypassa extension: leggibilita' intent + safety futura).
- [x] **Seed + smoke-soft-delete wrap** in `withSystemContext` (script ops = system context per design).
- [x] **6 test essential** continuano a passare: mock `@gestionale/db` esteso con `runInTenantContext`, `withSystemContext`, `withSuperAdminContext` (passthrough fn).
- [x] **Smoke "limited" 4/4 scenari verdi** (script `/tmp/d3a-smoke-limited.ts` non committato): role temp non-superuser + policy reale temp su `users` only; BASELINE/SCEN1/SCEN2 (tenant random=0)/SCEN3 (super_admin=tutti)/SCEN4 (no context throws) tutti PASS.
- [x] **ADR-0009 v1**: 15 decisioni + R3 fix + R9 deferred + considered alternatives + reversibility + tech debt + security considerations.

#### Decisioni prese durante D3a (2026-05-13 notte fonda)

- **2026-05-13**: Pattern S2 (per-operation tx + Prisma extension) vs S3 (HTTP-scoped tx) — S3 scartato per R5 (argon2 verify blocca pool connection ~150ms). S2 overhead 2-3ms/query localhost accettabile F1.
- **2026-05-13**: ALS instance singleton di modulo in `packages/db/src/rls.ts` (non in apps/api). Seed.ts e altri script in packages/db possono importare senza dipendenza inversa cross-package. Decisione architetturale chiarita a STOP 0.
- **2026-05-13**: **R3 manifesto a STOP 1**: `query(args)` dentro `$transaction(async tx => ...)` non eredita il tx context (verificato empiricamente). Fix F1: `tx[modelLower][operation](args)` + re-entrancy guard. Pattern testato 4/4 scenari verdi.
- **2026-05-13**: **R9 scoperto a STOP 1**: postgres user (DATABASE_URL) è superuser + BYPASSRLS, bypassa RLS by design. Senza app role non-superuser, RLS è no-op. Split D3a/D3b deciso: D3a chiude con framework, D3b attiva con role + GRANT + DIRECT_URL + migration policy reali.
- **2026-05-13**: **S5 clarification**: `isSuperAdmin = false` SEMPRE da JWT in F1. Tenant-scoped "Super Admin" role del seed e' solo bundle di permessi, NON RLS bypass. Concetto "platform super admin user" rimandato a macro-task futuro.
- **2026-05-13**: Naming policy reali D3b: `<table>_tenant_isolation` (vs placeholder `<table>_policy`). Permette future policy multiple per tabella.
- **2026-05-13**: `tenant_id` policy = text comparison (no cast `::uuid`): scoperto a STOP 1 che `tenant_id` è TEXT in DB (Prisma String mapping). Le policy D3b useranno text comparison senza cast.

### D3b — RLS activation (Macro-task D3b, 2026-05-13 notte fonda)

RLS attivo e enforced runtime. App role non-superuser + policy reali + FORCE ROW LEVEL SECURITY + pattern dual-URL Prisma + docker init bootstrap + smoke E2E full.

- [x] **Migration `create_app_role_and_grants`**: `CREATE ROLE gestionale_app` IF NOT EXISTS con placeholder password (`'PLACEHOLDER_MUST_BE_ROTATED'`, ruotata via separato `ALTER ROLE` post-apply) + attributi `LOGIN NOSUPERUSER NOBYPASSRLS` + `GRANT USAGE/SELECT/INSERT/UPDATE/DELETE` su schema+tables+sequences + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` per future tabelle.
- [x] **Schema Prisma dual-URL**: `directUrl = env("DIRECT_URL")` mappato in `packages/db/prisma/schema.prisma`. Prisma 5+ usa DIRECT_URL automaticamente per DDL (migrate/generate), DATABASE_URL per runtime queries. Nessun swap manuale `.env` necessario.
- [x] **`.env` + `.env.example`**: aggiunti `APP_DB_PASSWORD` (raw base64), `DATABASE_URL` (app role con password URL-encoded — pattern `=`→`%3D`, `+`→`%2B`, `/`→`%2F`), `DIRECT_URL` (postgres). `.env.example` con placeholder, `.env` reale gitignored.
- [x] **Migration `replace_rls_placeholder_with_real`**: DROP `<table>_policy` × 7 + CREATE `<table>_tenant_isolation` × 7 con pattern `is_super_admin OR tenant_id = current_setting('app.tenant_id', true)`. user_roles/sessions usano EXISTS join. `tenants` usa colonna `id`. NO cast `::uuid` (tenant_id è TEXT). + ALTER TABLE FORCE ROW LEVEL SECURITY × 7.
- [x] **Migration `tighten_app_role_attributes`** (defense in depth aggiunto a STOP 7 per simmetria con docker init script): `ALTER ROLE gestionale_app NOCREATEDB NOCREATEROLE NOINHERIT`. Idempotente.
- [x] **Seed esteso con `seedDevTenant(params)` helper**: refactor del bootstrap tenant dev in funzione riusabile. Aggiunto 2° tenant `acme` (slug 'acme', name 'Pizzeria Acme') + sede `Sede Centro` Roma + user `manager@acme.local` / `Manager123!` + role Super Admin tenant-scoped + 32 role_permissions. Idempotente (0 created al re-run).
- [x] **Smoke E2E full** `packages/db/scripts/smoke-rls-e2e.ts` (script committato, read-only, idempotente): 7 scenari (5 mandatory + 2 extra coverage): tenant demo isolation (count=1), tenant acme isolation (count=1), cross-tenant block via UUID-known lookup (null), system context bypass (count=2), super admin context (bypass via is_super_admin), roles table isolation (count=1), audit_logs equivalence (`demo_ctx_count == system_filter_demo_count`). Wrapper `pnpm smoke:rls-e2e`. **7/7 PASS** prima e seconda esecuzione.
- [x] **Docker compose ensure role bootstrap**: `infra/postgres/init/01-create-app-role.sh` idempotente con `format(%L)` injection-safe, `set -euo pipefail`, guard env var. `docker-compose.dev.yml` con `APP_DB_PASSWORD` env propagata al service postgres + mount `./infra/postgres/init:/docker-entrypoint-initdb.d:ro`. Gira SOLO al primo bootstrap del volume.
- [x] **Post-D3a finding**: `JwtStrategy.validate()` faceva query Prisma al guard stage (prima dell'Interceptor) → `RlsNoContextError`. Latente in D3a perchè policy era `USING(true)` + test mock-based. Fix con wrap in `runInTenantContext(payload.tenantId, false)` (defense in depth) + refactor `validate/validateInContext`. Pattern analogo a `AuthService.refresh`.
- [x] **ADR-0009 v2**: aggiunte sezioni "Status finale", "D3b — Activation completed", "Post-D3a findings", "Considered Alternatives D3b", "Reversibility estesa", "Tech debt aggiornato" (10 voci), "Security considerations finale". Status: Accepted (D3a + D3b complete).
- [x] **README**: callout SUCCESS RLS Active sostituisce il vecchio warning, sezione "Database setup (D3b RLS Active)" con runbook 5-step (genera password / configura URL / migrate / ALTER ROLE / seed), sezione "Multi-tenant isolation (D3a + D3b)" con componenti DB + comando smoke + caveat.

#### Decisioni prese durante D3b (2026-05-13 notte fonda)

- **2026-05-13**: **R9 scoperto a STOP 1 D3a → risolto in D3b**. Postgres user superuser+BYPASSRLS bypassa RLS. Senza app role non-superuser, framework è no-op. Split D3a/D3b deciso a STOP 1 D3a, completato a D3b.
- **2026-05-13**: **Pattern dual-URL Prisma** (DATABASE_URL=app role / DIRECT_URL=postgres) scelto rispetto a swap manuale del singolo URL. Prisma 5+ usa DIRECT_URL automaticamente per migrate/generate quando definito in schema.
- **2026-05-13**: **FORCE ROW LEVEL SECURITY obbligatorio**: senza, il table owner (postgres come migration runner) bypassa policy. Senza ALTER TABLE FORCE, gestionale_app vede filtrato ma postgres no → asimmetria pericolosa.
- **2026-05-13**: **EXISTS join policy per user_roles + sessions**: tabelle senza colonna `tenant_id` diretta. user_roles → `roles.tenant_id`, sessions → `users.tenant_id`. Index PK rende sub-select O(log n). Denormalizzazione tenant_id rimandata (tech debt F1+ se profiling lo giustifica).
- **2026-05-13**: **Password placeholder + ALTER ROLE post-migrate** (pattern non ideale): migration committata in git non puo' contenere password reale. Soluzione: `'PLACEHOLDER_MUST_BE_ROTATED'` + step manuale post-apply documentato in README + warning ASCII box prominente in migration SQL. Tech debt #8 ADR-0009: secret manager (Vault) per F2.
- **2026-05-13**: **Refactor `seedDevTenant(params)` helper** durante STEP 4: il bootstrap tenant inline avrebbe creato duplicazione demo+acme. Helper riusabile single source of truth. Non decisione architetturale macro (refactor pulito), menzione solo in commit message.
- **2026-05-13**: **JwtStrategy.validate wrap** (post-D3a finding emerso a STEP 2): query Prisma dentro `validate()` (guard stage) prima dell'Interceptor. Fix con `runInTenantContext(payload.tenantId)` (defense in depth, RLS filtra session.findUnique sul tenantId del JWT).
- **2026-05-13**: **Migration immutability** (regola interna nata da STEP 3 checksum drift): MAI modificare SQL/comment di migration applicate. Per fix/refinement post-apply → nuova migration `<ts>_fix_<topic>.sql`. Esempio: `tighten_app_role_attributes` aggiunge attributi role senza toccare `create_app_role_and_grants`.
- **2026-05-13**: **Docker init script + migration coesistenti**: docker init per fresh volume (password reale at-bootstrap), migration per existing volumes (placeholder + ALTER ROLE post). Coerente con docker-entrypoint-initdb.d semantics (one-shot).

### D4 — Bootstrap tenant logic (Macro-task D4, 2026-05-13 notte fonda)

Endpoint `POST /api/v1/tenants` per creare nuovo tenant + bootstrap RBAC completo in 1 chiamata atomic. Apre il pattern "ops multi-statement atomic" per macro-task futuri.

- [x] **Endpoint `POST /api/v1/tenants`** (`apps/api/src/tenants/tenants.controller.ts`): protetto by `JwtAuthGuard` globale, body `CreateTenantDto`, defense-in-depth check `user` undefined.
- [x] **`TenantsService.createTenant(dto, createdBy)`** (~190 LOC): permission check FUORI tx → `withSystemContextAtomicTx` atomic → 8 operations (slug check, tenant.create, sede.create, argon2.hash, user.create, 6× role+rolePermissions clone da template, userRole.create con assignedById, auditLog 'tenant.created').
- [x] **`UsersService.hasPermission(userId, code)`** (`apps/api/src/users/users.service.ts`): query Prisma `findFirst` con chain `roles.some → role.permissions.some → permission.code` + `select: {id: true}`. Lazy lookup coerente con ADR-0008 decisione 7. 2 test essential mock-based (8/8 Vitest totali).
- [x] **DTO `CreateTenantDto`** (`apps/api/src/tenants/dto/create-tenant.dto.ts`): @IsString/@MinLength/@MaxLength/@Matches/@IsEmail/@IsNotIn(FORBIDDEN_SLUGS). Default sede service-side via `??`. Test DTO via Vitest temporaneo 9/9 PASS (S1 valid, S2-S6 slug rejections, S7 password, S8 email, S9 postal code).
- [x] **`FORBIDDEN_SLUGS`** (`apps/api/src/tenants/dto/forbidden-slugs.ts`): 11 voci hardcoded (`api/www/admin/system/app/public/static/health/auth/me/tenants`). Pattern simmetrico a `FORBIDDEN_PINS` D2b.
- [x] **TenantsModule** + import in `AppModule.imports`: DI `UsersModule` per `usersService.hasPermission`.
- [x] **Audit action enum** esteso (totale 10): `+'tenant.created'` con `afterValue: {slug, name, adminEmail}` — NO password.
- [x] **2 Atomic helpers in `packages/db/src/rls.ts`**: `withSystemContextAtomicTx(client, fn)` + `withTenantContextAtomicTx(client, tenantId, fn)`. ~110 LOC. Bypass auto-wrap dell'extension RLS via `inflightStorage` re-entry guard (esposto come export internal). SET LOCAL una volta sull'inizio del tx via helper privato `setLocalRlsContext`.
- [x] **Atomicity test 4/4 PASS** (script `/tmp/d4-atomicity-test.ts`, one-shot non committato): S1 system+throw rollback, S2 system happy create, S3 tenant ctx RLS attivo, S4 tenant+throw rollback.
- [x] **Smoke E2E 5/5 PASS** (script `/tmp/d4-smoke.sh`, one-shot non committato): S1 no auth=401, S2 valid slug=201+delta DB esatto (+1 tenant/+1 user/+6 roles/+104 rolePermissions/+1 userRole/+1 auditTenantCreated/+1 sede), S3 dup slug=409+E_TENANT_SLUG_EXISTS, S4 'admin' slug=400+E_TENANT_SLUG_RESERVED, S5 login nuovo admin + /me=32 perms.
- [x] **STEP 0 fix `$queryRaw` regression** in `rls.ts`: pass-through `$allOperations` con `model=undefined` (raw queries arrivano qui in Prisma 6.19.3). 5 LOC. Health check tornato 200 (era 503 dopo swap a NOSUPERUSER DATABASE_URL).
- [x] **ADR-0010** (nuovo): 7 decisioni + 3 discoveries (F1 $queryRaw, F2 $transaction atomicity, F3 forceDelete+RLS bypass), considered alternatives, reversibility, tech debt (4 voci), security considerations.
- [x] **README**: sezione "Tenant bootstrap (D4) — POST /tenants" con curl esempio; tabella "modalità accesso DB" estesa da 3 a 5 (aggiunti 2 Atomic helpers).
- [x] **ADR-0009 v3 Notes**: 2 caveat aggiunti (raw queries pass-through scoperto empiricamente F1; explicit `$transaction` non atomico → usa Atomic helpers F2).

#### Decisioni prese durante D4 (2026-05-13 notte fonda)

- **2026-05-13**: **F1 fix $queryRaw regression** scoperto al pre-flight D4. Bug latente in D3a/D3b mascherato da smoke read-only + test mock-based. Health check funzionava finche' DATABASE_URL=postgres (superuser bypass), rotto al swap a NOSUPERUSER. Fix 5 LOC: early-return pass-through nell'extension RLS quando `model === undefined`.
- **2026-05-13**: **F2 fix $transaction atomicity** scoperto pre-implementazione TenantsService. Verifica empirica: `prisma.$transaction(async tx => tx.tenant.create(...) + throw)` → tenant NON rollback (orphan). Root cause: RLS extension auto-wrappa ogni op in `client.$transaction(...)` separato (closure `client` e' BASE, non userTx). Fix architetturale: 2 Atomic helpers (`withSystemContextAtomicTx` + `withTenantContextAtomicTx`) che fanno SET LOCAL una volta + `inflightStorage` guard per bypass auto-wrap nelle ops dentro al tx.
- **2026-05-13**: **F3 forceDelete + RLS bypass in `withSystemContext`** scoperto durante regression check post-smoke D4. `forceDelete` usa `$executeRawUnsafe` → bypassa extension → SET LOCAL non applicato → policy filtra → DELETE 0 rows. Workaround D4: cleanup ops via `DIRECT_URL` (postgres superuser bypassa RLS by design). Fix proper futuro: `withSystemContextRaw` helper. Tech debt #1 ADR-0010.
- **2026-05-13**: **Permission check FUORI tx + inline (no Guard generico)**: D4 ha 1 endpoint. Inline `usersService.hasPermission` sufficient. Generic `@RequirePermissions(...)` rimandato a macro-task RBAC enforcement futuro.
- **2026-05-13**: **Slug forbidden list hardcoded** (pattern simmetrico FORBIDDEN_PINS D2b): no fetch DB/rete, revocabile/estendibile in-source.
- **2026-05-13**: **Default sede service-side** (vs `@Transform` DTO): default validi anche se `createTenant` chiamato da seed/CLI bypassando DTO. Single source of truth.
- **2026-05-13**: **Audit log `tenant.created` filtrato**: `afterValue = {slug, name, adminEmail}`. **NO password** (security leak — audit log readable da Super Admin + system queries).
- **2026-05-13**: **Cleanup pattern lesson learned**: test script che creano dati DB richiedono cleanup verificato via DIRECT_URL (superuser bypass) OR tx rollback intenzionale. Pattern futuro per smoke scripts. Tech debt #2 ADR-0010.

### E1 — Next.js scaffold + dual package strategy (Macro-task E1, 2026-05-13 mattina)

Primo macro-task frontend. Trigger di CC2 ADR-0007 (CJS/ESM strategy) ora risolto via dual package professional. Scaffold `apps/web` Next.js 15 + React 18.3 + Tailwind 3.4 + shadcn/ui consumer di `@gestionale/db` via `exports.import → dist/index.mjs`. apps/api invariato (zero regression).

- [x] **Fase 1 — `packages/db` dual package via `tsup`**: `package.json` con `type: module` + `exports` conditional (import/require + types nested ATTW-compliant) + `files: ["dist"]`. `tsup.config.ts` 12 LOC: CJS+ESM+DTS, `outExtension` esplicito (`.cjs`/`.mjs`), target node20, external `@prisma/client`. Build: 6 file dist/ (cjs/mjs + d.cts/d.ts + 2 sourcemap), ~10K cadauno. Smoke RLS 7/7 PASS post-build.
- [x] **Fase 1 fix in-fase — 10 type errors latenti packages/db** (Discovery F1): `tsup --dts` ha rivelato errori non catchati da `tsc --noEmit` né da test runtime. Fix minimal in-place (`(Prisma as any).dmmf`, `tx: any` per `$executeRawUnsafe`, type annotations su lambda `.map()`). ZERO refactor, ZERO regression runtime. Commento motivazione runtime su ogni cast.
- [x] **Fase 2 — apps/api consumer trasparente**: ZERO modifiche apps/api. `node -e "require.resolve('@gestionale/db')"` → `dist/index.cjs` (exports.require). 5 endpoint smoke OK: health 200, login 201+JWT pair, /me 200+32 perms, POST /tenants 201+payload completo, cleanup tenant via psql DIRECT_URL. Vitest 8/8 verde.
- [x] **Fase 3 — Turbo build chain**: `turbo.json` `dev: dependsOn ["^build"]` + `typecheck: dependsOn ["^build"]` (Opzione A globale). Cache miss 4.8s, cache hit `>>> FULL TURBO` 119ms (ratio 40x). Dev chain validato: `pnpm exec turbo run dev --filter=@gestionale/api` → db:build prima, api:dev dopo.
- [x] **Fase 4 — apps/web scaffold Next.js 15 manual**: 7 file (`package.json`, `tsconfig.json`, `next.config.mjs`, `.eslintrc.json`, `src/app/{layout,page}.tsx`, `src/app/globals.css`). Versioni `next@15.5.18`, `react@18.3.1`, `react-dom@18.3.1`. Smoke `:3001` HTTP 200, HTML con `<title>Gestionale</title>`, `<html lang="it">`, `<h1>Gestionale Platform</h1>`, `<p>F1 scaffold attivo</p>`.
- [x] **Fase 5 — Tailwind 3.4 + shadcn/ui scaffold manuale**: `tailwindcss@3.4.19` + `postcss@8.5.14` + `autoprefixer@10.5.0`. 5 file shadcn manuali (T3-style, NO CLI): `components.json`, `src/lib/utils.ts` (cn helper), `src/components/ui/button.tsx` (cva 6 variants 4 sizes + Slot), `src/app/globals.css` (HSL CSS vars), `tailwind.config.ts` (theme.extend + plugin tailwindcss-animate). Button renderizzato styled (bg-primary, h-10 px-4 py-2, hover/focus/disabled states).
- [x] **Fase 6 — Gate critico 6/6 PASS**: health 200 + web 200+Button + typecheck FULL TURBO 119ms 4/4 + lint clean (fix in-fase ignore `next-env.d.ts`) + Vitest 8/8 + smoke RLS 7/7. Entrambi i dev server in parallelo OK (api:3000 + web:3001).
- [x] **Fase 7 — Docs**: [ADR-0011](docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md) (status, context, 5 decisions, 5 discoveries E1, considered alternatives, reversibility, 5 tech debt, security). ADR-0007 status update CC2 = Resolved. README Stack table + sezione "Frontend (apps/web)" + nota entrypoint dev pattern. PROGRESS questa sezione.

#### Discoveries E1 (5 finding, tutti tracked in ADR-0011)

- **F1 — 10 type errors latenti packages/db rivelati da tsup DTS** (STOP 1): `Prisma.dmmf` rimosso da `.d.ts` Prisma 6, `$executeRawUnsafe` strippato dal tipo `Tx` post-`$extends`, implicit any su lambda Prisma 6 narrowing. Cause: `noEmit: true` + nessun DTS emit pre-E1 nascondevano la fragilità. Fix in-place minimal con commenti motivazione runtime.
- **F2 — `pnpm --filter <ws> <script>` bypassa Turbo `dependsOn`** (STOP 3): pnpm filter chiama lo script diretto, salta orchestration Turbo. Pattern corretto: `pnpm dev` (root) OR `pnpm exec turbo run dev --filter=<ws>`. Documentato in README + ADR-0011 F2.
- **F3 — Path resolution asymmetry apps/api vs apps/web** (STOP 4): apps/api eredita base `paths` (alias to src/), apps/web override (resolve via node_modules + exports.import to dist/). Intentional, ma sorgente di confusione futura — tracked TD-4 ADR-0011.
- **F4 — `shadcn@latest` (v4.7.0) pollution + Tailwind 4 default** (STOP 5): no opt-out flag T3 documentato, genera CSS oklch + `@import "tw-animate-css"` + crea file fuori workspace + auto-modifica layout.tsx. Manual scaffold 5 file è la SOLA via affidabile per T3.4 nel 2026.
- **F5 — `next-env.d.ts` triple-slash refs viola ESLint** (STOP 6, in-fase): file auto-generato Next con `/// <reference types="next" />` rifiutato da `@typescript-eslint/triple-slash-reference`. Fix: aggiunto `**/next-env.d.ts` a `eslint.config.js` ignores + `next-env.d.ts` a `.gitignore` (pattern Next.js docs).

#### Decisioni prese durante E1 (2026-05-13 mattina)

- **2026-05-13**: **Dual package via tsup** (vs ESM-everywhere vs tsx workaround) — Opzione A di ADR-0007 CC2 scelta. tsup zero-config, build CJS+ESM+DTS in <2s, exports field ATTW-compliant.
- **2026-05-13**: **tsup vs tsc puro**: tsup wraps esbuild + rollup-plugin-dts, 12 LOC config totali. tsc puro richiederebbe 2 build separati + scripting (~40+ LOC).
- **2026-05-13**: **Tailwind 3.4 (NO 4)**: shadcn ecosystem 100% compat T3 oggi, T4 breaking (oklch + `@theme` directive). Migration tracked TD-1.
- **2026-05-13**: **React 18.3 (NO 19)**: ecosystem (Radix, shadcn, libs third-party) full compat 18.3, parziale/sperimentale 19. Migration tracked TD-2.
- **2026-05-13**: **Manual scaffold apps/web (NO create-next-app)**: pattern coerente con apps/api D1 manual scaffold. Auto-install pollution evitata, config divergence (eslint/tsconfig) evitata.
- **2026-05-13**: **shadcn manual scaffold (NO CLI)**: F4 discovery — shadcn@4.7.0 defaulta T4 senza opt-out. 5 file standard T3 scritti a mano. Tracked TD-5.
- **2026-05-13**: **path resolution F3 → `@/*: ["apps/web/src/*"]`** (path completo da workspace root baseUrl), NON `["./src/*"]` (resolverebbe contro workspace root). TS paths sono relativi a baseUrl ereditato, NON al file tsconfig.
- **2026-05-13**: **next-env.d.ts → gitignore + eslint ignore** (F5): pattern Next.js docs raccomandato. File auto-generato non va committato.

---

### E2 — Login form UI + integrazione API (Macro-task E2, 2026-05-13 mattina-pomeriggio)

Primo flow end-to-end frontend↔API via browser. Form login `/login` (react-hook-form + zod + shadcn Form/Input/Card/Alert) → POST `/auth/login` con `X-Tenant-Slug: demo` → localStorage JWT → `/dashboard` GET `/me` → render Welcome `<firstName>` `<lastName>` + 32 permessi badge + logout. Auto-redirect `/` → `/login` o `/dashboard` basato su auth state. Bug fix collaterale **CORS missing backend (F3 critical)**: primo client browser-based ha esposto gap latente.

- [x] **Pre-flight**: branch `feature/login-flow-e2`, baseline 8/8 Vitest + 7/7 smoke RLS, admin@demo.local login + /me verificato via curl reale (shape MeResponse empirica)
- [x] **Fase 1 — shadcn install**: `printf "N\n" | pnpm dlx shadcn@latest add form input label card alert` (preserve button.tsx E1). Deps installate: `react-hook-form@7.75`, `@hookform/resolvers@5.2`, `zod@4.4`, `@radix-ui/react-label@2.1.8`. **Pollution check verde**: no T4 (no oklch/@base-ui/tw-animate-css), React resta 18.3.1. Pattern senior: `shadcn add` (E2) rispetta `components.json` ≠ `shadcn init` (E1) pollution
- [x] **Fase 2 — API client + auth lib + types**: 3 file `apps/web/src/lib/`: `api.ts` (`ApiError` class + `apiPost<T>` + `apiGet<T>` con DRY `parseError`), `auth.ts` (4 token functions con SSR guards), `types.ts` (`LoginResponse` + `MeUser` + `MeRole` + `MeResponse` shape verificata empiricamente via curl `/me` reale). `.env.local.example` committato + `.env.local` gitignored (riga 33 root)
- [x] **Fase 3 — Login page**: `apps/web/src/app/login/page.tsx` 128 LOC con `'use client'` + RHF + zodResolver + shadcn Form components. Zod schema email + min(8) password con messaggi IT. Submit try/catch ApiError → discriminate `E_AUTH_INVALID_CREDENTIALS` → "Email o password non corrette". autoComplete hints email/current-password
- [x] **Fase 4 — Dashboard + root redirect**: `apps/web/src/app/dashboard/page.tsx` 113 LOC (useEffect fetch /me + handle 401 → clearTokens + redirect, loading state, error state, Card Welcome + roles list + permessi flex-wrap badges + logout button). `apps/web/src/app/page.tsx` REPLACE (Server Component E1 → client-side redirect via `isAuthenticated()` + `router.replace`)
- [x] **Fase 5 — Gate critico**: 4/4 curl endpoint (health 200 + /login 200 + /dashboard 200 + / 200), typecheck FULL TURBO 4/4, lint clean (post fix F2 import type), Vitest 8/8 cached, smoke RLS 7/7. **9/9 smoke browser PASS** (Nicolò Mac manual, screenshot Welcome Admin Demo verificato)
- [x] **Fase 5 fix in-fase F3 ⭐ CRITICAL — CORS missing backend**: discovery dal browser console "Access to fetch blocked by CORS policy". Root cause: D2a-D4 testati SOLO via curl (no Origin enforcement), E2 primo browser-based caller espone gap. Fix: 5 LOC funzionali in `apps/api/src/main.ts` (`app.enableCors({origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001', credentials: true})`) + `.env.example` sezione CORS. ts-node-dev hot-reload PID 770893 → 781095. Curl OPTIONS preflight verificato: 4 header CORS attesi presenti
- [x] **Fase 6 — Docs**: [ADR-0012](docs/architecture/ADR-0012-frontend-auth-flow.md) (status, context, 6 decisions, 4 discoveries E2, 9 considered alternatives, 6 reversibility scenarios, 6 tech debt TD-1→TD-6, security pro/contro). README Stack table + sezione "Login flow (E2)" + paragrafo CORS. PROGRESS questa sezione

#### Discoveries E2 (4 finding, tutti tracked in ADR-0012)

- **F1 — Limitazione testing Claude Code remoto** (STOP 3): server SSH Hetzner no Chromium/Playwright. Validation client-side React richiede browser headless o manual test Nicolò. Server-side render verificabile via curl (HTTP 200 + token HTML), bundle compile verde, ma 4 test validation client-side delegati a Nicolò. Tracked TD-4: setup Playwright per E2E CI
- **F2 — shadcn CLI output non passa monorepo lint strict** (STOP 5): `apps/web/src/components/ui/form.tsx` generato con `import * as LabelPrimitive` ma usato solo type position. Violava `@typescript-eslint/consistent-type-imports` root config. Fix 1 carattere: `import type * as LabelPrimitive`. Lesson: file generated-by-tool validati dal gate lint. Tracked TD-5: verify lint immediato post-`shadcn add`
- **F3 ⭐ CRITICAL — CORS missing in NestJS backend** (Fase 5): browser fetch blocked by CORS policy, root cause backend NestJS never enabled CORS. Causa latency: D2a/D2b/D3a/D3b/D4 endpoint testati SOLO via curl (no Origin enforcement). E2 primo browser-based caller espone gap. Fix in `apps/api/src/main.ts` 5 LOC (`app.enableCors({origin: env.CORS_ORIGIN ?? 'http://localhost:3001', credentials: true})`) + env var CORS_ORIGIN + credentials:true preparato httpOnly cookie migration. Verifica empirica curl OPTIONS preflight: Allow-Origin + Allow-Credentials + Allow-Methods + Allow-Headers tutti presenti. **Lesson generalizzabile**: ogni nuovo "tipo di client" (browser, mobile, third-party SDK) può rivelare gap latenti del backend invisibili dal client precedente
- **F4 — Cross-platform browser shortcuts** (smoke test 8): Nicolò usa Mac → `Cmd+R` per refresh (NON `F5` come scritto inizialmente nei test). Memo documentation: futuri test browser includere shortcut Mac/Windows/Linux distinti

#### Decisioni prese durante E2 (2026-05-13 mattina-pomeriggio)

- **2026-05-13**: **JWT storage localStorage (NO httpOnly cookie)**: pragmatic over secure per progetto NOT-production. ~1.5h risparmiate vs setup cookie middleware + CSRF. Anti-pattern XSS surface accettato, tracked TD-1
- **2026-05-13**: **react-hook-form + zod (vs formik/yup vs manual useState)**: shadcn Form richiede RHF peer dep, zod type-safe + `z.infer<>` automatic. Versioni installate più recenti del prompt (zod 4 vs 3, resolvers 5 vs 3) ma API pattern invariata
- **2026-05-13**: **TENANT_SLUG = 'demo' hardcoded**: single-tenant flow E2 scope-contained. Subdomain/path routing tracked TD-2. Comment esplicito sul const top-level
- **2026-05-13**: **Pages structure 3-route + client-side redirect /**: `/` (page.tsx replace E1 con redirect), `/login`, `/dashboard`. Server Component inadatto per `/` (serve localStorage check). `router.replace` (NON `push`) → no history pollution su redirect e logout
- **2026-05-13**: **No auto-refresh token**: access token 15min, user re-login forzato post-scadenza. Trade-off UX accettato E2, pattern logout naturale. Tracked TD-3
- **2026-05-13**: **shadcn CLI `add` (vs E1 `init` manual scaffold)**: `add` rispetta `components.json` esistente (zero pollution). `printf "N\n"` per preservare `button.tsx` E1 quando `form` dipendenza chiede overwrite. Pattern senior consolidato

---

### B1 — Auth E2E hardening parte 1: rate limit + lockout (Sessione 8, 2026-05-13 sera-notte)

**Branch**: `feature/auth-e2e-hardening-b1` · **Status**: completato, PR merge pending · **ADR**: [ADR-0013](docs/architecture/ADR-0013-auth-e2e-hardening-b1.md)

Split di "B Auth E2E hardening" (carry-over [ADR-0008 §3](docs/architecture/ADR-0008-auth-module.md) + [ADR-0010 #4](docs/architecture/ADR-0010-tenant-bootstrap.md) + ADR-0012 Security gap): B1 = rate-limit + lockout, B2 = email theft + E2E full bootstrap programmato sessione 9.

**Deliverables**:

- `ThrottlerModule.forRootAsync` global + Redis storage (`@nestjs/throttler@6.5.0` + `@nest-lab/throttler-storage-redis@1.2.0` + `ioredis@5.10.1`)
- 3 named throttlers env-driven: `default` (60/min global), `auth-strict` (5/min `/auth/login` + `/auth/login-pin` opt-in via `@AuthStrict()`), `tenant-create` (3/h `POST /tenants` opt-in via `@TenantCreate()`)
- `AppThrottlerGuard` custom tracker **userId-or-IP** per `tenant-create` (JWT decode minimale dall'Authorization header pre-JwtAuthGuard ordering — anti IP rotation)
- `RedisModule` `@Global` shared (1 connection pool ioredis riusabile per Throttler + Lockout + futuro cache/session)
- `LockoutService` Redis sliding window (ZADD/ZREMRANGEBYSCORE/ZCARD/SET pipeline atomico): threshold=10, window=15min, duration=15min env-driven
- `AuthService.login` + `loginPin`: check lockout PRE-DB lookup (anti-timing-leak). Reset doppio (Redis + DB `failedLoginAttempts`) su success.
- `LockoutExceptionFilter` (extends `BaseExceptionFilter`, APP_FILTER): `Retry-After: 900` **fissi** anti user-enumeration (real retryAfterSec solo in log)
- Nuovo audit action `auth.account_locked` (totale 11, **no migration** necessaria — `audit_logs.action` è String text-based)
- `@nestjs/config@4.0.4` retrofit incrementale (solo nuovi moduli, legacy `process.env` invariato)
- Helper utility estratti per testability: `apps/api/src/throttler/utils/jwt-decode.util.ts` (`extractSubFromAuthHeader`) + `skip-if-metadata.util.ts` (higher-order builder)
- 17 nuovi test Vitest (8 LockoutService + 9 throttler helpers) → **25/25 totali PASS** (~681ms), zero regression
- `docker-compose.dev.yml`: port mapping `127.0.0.1:6379:6379` per ts-node-dev sull'host (simmetrico Postgres)

**Smoke E2E verificati (A-H, 8/8)**:

| # | Scenario | Verdetto |
|---|---|---|
| A | Rate-limit `/auth/login`: 5x 401 + 6° 429 | ✅ |
| B | Rate-limit `/auth/login-pin`: 5x 401 + 6° 429 (bucket distinto per route) | ✅ |
| C | Custom tracker `tenant-create`: 3x 400 + 4° 429, Redis key `user:019e1e40-...` via JWT decode (NON IP fallback) | ✅ |
| D | Cross-endpoint isolation: `/health` 200 dopo lockout `/auth/login` | ✅ |
| E | Lockout `/auth/login` (THRESHOLD=3 temp): 2x 401 + 3° 429 promosso in-flight + 4°+ `Retry-After: 900` + audit `auth.account_locked` | ✅ |
| F | Reset doppio: 2 fail → ZCARD=2 + DB counter=2 → login OK → ZCARD=0 + DB counter=0 | ✅ |
| G | Lockout `/auth/login-pin`: key `pin:tenant:<uuid>:device:smoke-pin-device` + NO DB counter increment (D2b §8 carry-over confermato) | ✅ |
| H | Key isolation: A blocked, B (email diversa) → 401 NOT 429 | ✅ |

**Empirical discoveries (#16-21, +6 cumulative → totale 21)**:

- **#16** Throttler v6 named throttlers globali by default (fix: skipIf metadata opt-in pattern)
- **#17** Container Redis docker-compose non host-exposed di default (fix: `ports: ['127.0.0.1:6379:6379']`)
- **#18** `req.user` undefined in APP_GUARD ThrottlerGuard (pre-JwtAuthGuard ordering) — fix: JWT decode minimale Authorization header (no verify)
- **#19** `@nestjs/throttler@6.5.0` `getTracker(req)` single-arg (no context) — fix: override `handleRequest(requestProps)` con `customGetTracker` wrappato
- **#20** `BaseExceptionFilter` APP_FILTER DI break con custom constructor → omettere constructor (NestJS risolve HttpAdapterHost automaticamente)
- **#21** `ValidationPipe` filtra PRE-controller → lockout counter non incrementato per input malformati (validation errors non consumano bucket; attacker con password ben formata sì)

**Tech debt nuovi (21 voci: 14 STOP TD-A → TD-N + 7 cleanup review TD-O → TD-U)** — vedi [ADR-0013](docs/architecture/ADR-0013-auth-e2e-hardening-b1.md):

Categorie STOP: Redis resilience (TD-A,B), Config consistency (TD-C), Docker port (TD-D), Security trade-off (TD-E,J), Throttler quirks (TD-F,G), Lockout key scope (TD-H,I,K), Filter pattern (TD-L), Test coverage (TD-M), Refactor minor (TD-N).

Categorie cleanup review (emerse da check pre-merge Claude strategico): DevOps (TD-O), Lockout DoS (TD-P), Config validation (TD-Q), Redis TLS (TD-R), Observability (TD-S,U), Edge case IPv6 (TD-T). Tutti low-priority, F1 NOT-production-blocking.

### B2a — Auth E2E hardening parte 2 (split A): email notification + login-pin per-tenant (Sessione 9, 2026-05-14 sera)

**Branch**: `feature/b2a-email-notification-login-pin-throttler` · **Status**: completato, PR merge pending · **ADR**: [ADR-0014](docs/architecture/ADR-0014-auth-e2e-hardening-b2a.md)

Split di B2 deciso architecture review sessione 9: B2a = email + login-pin throttler + TD-B verify; B2b = E2E full Nest bootstrap + Testcontainers programmato sessione 10.

**Deliverables**:

- `MailService` NestJS (`@Global`) con `nodemailer@8.0.7` + Mailpit `v1.30` dev MTA (NON MailHog abbandonato — Discovery #22)
- Pattern fail-open layered: `transporter.verify()` no-throw + `sendSafe()` wrapper try/catch con `Promise<boolean>` return
- 2 metodi email: `sendAccountLockedEmail` (account_locked) + `sendRefreshTokenTheftEmail` (theft_detected)
- Content zero-PII: `identifierHash` sha256[0:8] coerente audit log B1, IP, user-agent, count revoked. MAI password/JWT/token/session id plain
- Email HTML inline + `escapeHtml()` helper privato, lingua IT, Subject prefisso `[Gestionale]`
- Integrazione `AuthService.login` (wrong-password branch) + `AuthService.refreshInContext` (theft branch) + `AuthService.loginPin` (skip mail no-user audit)
- Audit immutability single-row con `emailSent: boolean` + `emailReason: enum | null` nel payload `afterValue` (D4 ADR-0014)
- **NO nuova audit action**: riuso `auth.theft_detected` esistente D2-vitest (Discovery #23 — semantic equivalent)
- 4° named throttler `auth-pin`: 10/60s per `(tenantId, ip)` triplet (env `THROTTLE_AUTH_PIN_LIMIT/TTL`)
- Decorator `@LoginPinThrottle()` opt-in via `SetMetadata` (pattern coerente B1)
- `AppThrottlerGuard.handleRequest` branch `auth-pin` con `resolveAuthPinTracker` (tenant-ip / ip-fallback defense-in-depth)
- Rimosso `@AuthStrict()` da `/auth/login-pin` (Discovery #25 subsumption: `@LoginPinThrottle()` più granulare e più permissivo subsume IP-only)
- TD-B verify empirico: LockoutService fail-open ✅, ThrottlerStorage fail-CLOSED 500 → nuovo **TD-AD** follow-up
- Container Mailpit aggiunto a `docker-compose.dev.yml` (`axllent/mailpit:v1.30` pinned, ports `127.0.0.1:1025/8025`, `MP_MAX_MESSAGES=500`, `TZ=Europe/Rome`, no volume)
- Test Vitest 25/25 PASS (~720ms), zero regression

**Smoke E2E verificati (8/8)**:

| # | Scenario | Verdetto |
|---|---|---|
| A | `/auth/login` lockout (THRESHOLD=3 temp): 2x 401 + 3° 429 + 4° 429 + `Retry-After: 900` | ✅ |
| A-email | Mailpit inbox: 1 msg "[Gestionale] Account temporaneamente bloccato" → admin@demo.local | ✅ |
| A-audit | `after_value: {emailSent: true, emailReason: null, lockoutKeyHash: "37c95a1a"}` | ✅ |
| B | `/auth/refresh` theft (refresh reuse): 401 `E_AUTH_THEFT_DETECTED` + 25 session revoked | ✅ |
| B-email | Mailpit inbox: 1 msg "[Gestionale] Attivita sospetta — sessioni revocate" → admin@demo.local | ✅ |
| B-audit | `after_value: {emailSent:true, attackerIp:::ffff:127.0.0.1, attackerUA:curl/7.81.0, revokedSessionCount:25}` | ✅ |
| C | Per-tenant isolation: demo saturated 10x → 429, acme stessa IP → 401 NOT 429 | ✅ |
| D | TenantMiddleware fail-fast: slug invalido → 401 `E_AUTH_TENANT_REQUIRED` PRE-throttler | ✅ |
| E | TD-B Redis DOWN: 500 `MaxRetriesPerRequestError` (~1018ms) + recovery auto 121ms post-restart | ✅ (#26) |

**Empirical discoveries (#22-26, +5 cumulative → totale 26)**:

- **#22** MailHog abbandonato (ultimo release 2020) → Mailpit v1.30 drop-in protocol-level (SMTP standard, breaking solo REST `/api/v1` vs `/api/v2`, irrilevante)
- **#23** `auth.theft_detected` audit action già esistente (D2-vitest) → NO nuova `auth.refresh_token_theft`, NO migration (lesson: grep semantic equivalents)
- **#24** Lockout `THRESHOLD=10` e throttler `auth-pin limit=10` coincidono → interleaving: 10° fail = lockout (`E_AUTH_ACCOUNT_LOCKED`), 11° = throttler (`ThrottlerException`). Body distingue strato.
- **#25** Doppio decorator `@AuthStrict() + @LoginPinThrottle()` → throttler più stretto vince. Rimosso `@AuthStrict()` da `loginPin` (subsumed)
- **#26** TD-B Redis DOWN: LockoutService fail-open ✅ (mio), ThrottlerStorage fail-CLOSED → 500 (`@nest-lab/throttler-storage-redis`). Recovery auto ~121ms. User legittimo NON può loggarsi durante Redis DOWN

**Tech debt nuovi (7)** — vedi [ADR-0014](docs/architecture/ADR-0014-auth-e2e-hardening-b2a.md):

- TD-V `LOCKOUT_DURATION_MIN` hardcoded in AuthService per UI email (~10min)
- TD-Y deviceId nel tracker `auth-pin` triplet completo per F1 PWA cameriere (~30min)
- TD-Z SMTP production provider integration (Postmark/SES/Resend) (~1h, trigger production deploy)
- TD-AA template engine email se >3 template inline (~1.5h)
- TD-AB matrix decorator throttler subsumption documentata (~20min)
- TD-AC default lockout + throttler limit discrasati (~10min discussion)
- **TD-AD** wrap `AppThrottlerGuard.handleRequest` try/catch fail-open totale (Discovery #26) (~30min) → **RESOLVED in B2b**

Totale tech debt repo dopo B2a: ~28 (B1 21 + B2a 7).

### B2b — Auth E2E hardening parte 2 (split B): E2E full bootstrap + TD-AD fix (Sessione 9, 2026-05-14/15 notte tardi)

**Branch**: `feature/b2b-e2e-full-bootstrap-td-ad-fix` · **Status**: completato, PR merge pending · **ADR**: [ADR-0015](docs/architecture/ADR-0015-auth-e2e-hardening-b2b.md)

Chiude B2 (Auth E2E hardening) deciso architecture review sessione 9: primo E2E test full Nest bootstrap del progetto + TD-AD verified end-to-end. **B2 macro-task 100% complete** (B1 PR #19+#20 + B2a PR #21+#22 + B2b questo PR).

**Deliverables**:

- E2E framework: Vitest `projects` array (unit + e2e split) + `@testcontainers/postgresql@11.14.0` + `@testcontainers/redis@11.14.0` + `supertest@7.2.2` + `pg@8.20.0` (raw SQL truncate/seed) + `unplugin-swc@1.5.9` + `@swc/core@1.15.33` + `uuidv7` (devDep apps/api)
- Helpers `test-containers.ts` (Promise.all start + Prisma migrate via execSync) + `test-app.ts` (env override + lazy AppModule import + ValidationPipe + truncate + seedMinimal) + `setup-env.ts` (JWT_SECRET pre-import + reflect-metadata)
- `.swcrc` standalone NestJS-friendly (legacyDecorator + decoratorMetadata + keepClassNames + dynamicImport + module.type commonjs + target es2022)
- 2 E2E spec: `auth-login.e2e-spec.ts` (3 scenari: login OK, wrong password, no tenant header) + `td-ad-throttler-redis-down.e2e-spec.ts` (1 scenario fail-open Redis container stop mid-test)
- **TD-AD fix RESOLVED**: `AppThrottlerGuard.handleRequest` outer try/catch + `isRedisError` regex `/MaxRetriesPerRequestError|ECONNREFUSED|Redis|ioredis/i` + `Logger.warn [FAIL-OPEN]` prefix + `return true` fail-open
- **Implementation detail correctness-critical**: `await super.handleRequest(...)` invece di `return super.handleRequest(...)` (senza `await` la Promise rejection scappa try/catch come unhandled rejection). Pattern JS semantic-critical, reviewer junior facilmente missato
- `@Inject(ClassName)` esplicito su 14 file production code (Discovery #29 permanente — TD-AE)
- Scripts split: `pnpm test` (unit fast ~700ms, no Docker) vs `pnpm test:e2e` (slow ~13s container start) vs `pnpm test:all` (entrambi)
- Container fresh per file test (TRUNCATE 11 tabelle CASCADE between describe + seedMinimal raw SQL)
- Pattern fail-open layered consolidato: LockoutService (B1) + MailService (B2a) + ThrottlerGuard (B2b) tutti coerenti

**Test summary**:

| Test | Tipo | Esito |
|---|---|---|
| Unit existing (B1+B2a) | Unit | ✅ 25/25 PASS (~700ms) |
| `auth-login.e2e-spec.ts` × 3 scenari | E2E | ✅ 3/3 PASS (~7s) |
| `td-ad-throttler-redis-down.e2e-spec.ts` × 1 | E2E | ✅ 1/1 PASS (~12.5s, fail-open verified) |
| **Total** | — | **29/29 PASS (~13.93s)** |

**Empirical discoveries (#27-30, +4 cumulative → totale 30)**:

- **#27** — `ssh2@1.17.0` (transitive `@testcontainers/*` via `dockerode`) optional crypto binding fail durante install. Pure-JS fallback OK (Docker Unix socket non triggera SSH path). Zero impact runtime.
- **#28** — `JWT_SECRET` letto al MODULE LOAD TIME in `auth.module.ts:14` (top-level statement). Vitest carica moduli PRE-beforeAll → env override troppo tardi. Fix: setupFile dedicato `setup-env.ts` con env pre-import. TD-AG refactor a ConfigService runtime read.
- **#29 (PERMANENTE)** — Vitest+`unplugin-swc`+`.swcrc` completo (`legacyDecorator` + `decoratorMetadata` + `keepClassNames` + `tsconfigFile:false`) NON sufficient per NestJS DI in `Test.createTestingModule` + AppModule. Verifica empirica rollback 1 file pilota (auth.service.ts 5 deps) → `Cannot read properties of undefined`. SWC metadata emit ≠ NestJS testing DI resolution complete chain. Pattern `@Inject(ClassName)` esplicito su **14 file** mantenuto defensive. **TD-AE permanente** (trigger re-evaluation Vitest 4+/NestJS 12+/SWC 2.x).
- **#30** — `@gestionale/db` singleton eager `prisma` legge `DATABASE_URL` al MODULE REQUIRE TIME. Import statico `AppModule` → PrismaClient con env placeholder → Authentication failed. Fix: lazy `await import('AppModule')` POST env override. TD-AH refactor a factory pattern DI.

**Tech debt update (1 RESOLVED + 4 nuovi)** — vedi [ADR-0015](docs/architecture/ADR-0015-auth-e2e-hardening-b2b.md):

- ✅ **TD-AD RESOLVED**: ThrottlerStorage Redis DOWN fix Fase 4 + integration test Fase 5 verified
- **TD-AE** (PERMANENTE) `@Inject(ClassName)` esplicito su 14 file — trigger re-evaluation upstream tooling change (~30min cleanup futuro)
- **TD-AF** Redis monitoring + alerting + multi-AZ production (~2-4h, trigger production deploy)
- **TD-AG** `JWT_SECRET` top-level env read refactor a `ConfigService` runtime (~30min, F1+ refactor wave)
- **TD-AH** `prisma` singleton eager refactor a factory pattern DI (~1h, F1+ refactor wave OR TD-2 multi-tenant)

Totale tech debt repo dopo B2b: ~29 (B1 21 + B2a 7 + B2b 4 nuovi - TD-AD chiuso).

### TD-2 — Multi-tenant slug routing frontend path-based (Sessione 9, 2026-05-15 post-B2 closure)

**Branch**: `feature/td-2-multi-tenant-slug-frontend` · **Status**: completato, PR merge pending · **ADR**: [ADR-0012 sezione TD-2 Resolution](docs/architecture/ADR-0012-frontend-auth-flow.md)

Resolution carry-over TD-2 ADR-0012 (`TENANT_SLUG = 'demo'` hardcoded in LoginPage E2). Backend INVARIATO — solo frontend refactor + Next.js 15 middleware.

**Deliverables**:

- `apps/web/src/middleware.ts` (NEW, 64 LOC): pattern `/t/<slug>/<page>` validation + redirect logic edge-side. Slug regex `^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$` + `RESERVED_SLUGS` Set coerente backend `FORBIDDEN_SLUGS` (ADR-0010 D4). Root `/` → `/t/demo/login`. Slug invalid/reserved → `/not-found`.
- `apps/web/src/app/not-found.tsx` (NEW): 404 page Next.js convention, link "Torna alla home".
- `apps/web/src/app/page.tsx` (full rewrite Server Component): `redirect('/t/demo/login')` next/navigation. Era client `useEffect + isAuthenticated()` (E2 E1 pattern). Coerente con middleware-based routing + SSR-friendly.
- `git mv apps/web/src/app/{login,dashboard}` → `apps/web/src/app/t/[slug]/{login,dashboard}` (history preservata).
- `apps/web/src/app/t/[slug]/login/page.tsx`: `useParams<{slug:string}>()` runtime + redirect `router.push(\`/t/${tenantSlug}/dashboard\`)` post-login. Rimosso `TENANT_SLUG = 'demo'` const.
- `apps/web/src/app/t/[slug]/dashboard/page.tsx`: `useParams` + `loginUrl` extracted const (DRY + stable useEffect dep). 3 redirect tenant-aware (auth missing, 401, logout success).
- `apps/web/src/lib/api.ts` (full refactor): `RequestOptions { tenantSlug?, accessToken? }` interface tipizzata + `buildHeaders()` helper. Pattern security senior: `accessToken` field-typed (vs raw `Authorization` header) elimina typo Bearer prefix possibility. 3 call sites migrati.
- Backend INVARIATO: header `X-Tenant-Slug` API contract preservato, zero breaking.

**Smoke server-side middleware (7/7 via curl)**:

| # | Scenario | Esito |
|---|---|---|
| 1 | `/` → 307 → `/t/demo/login` | ✅ |
| 2 | `/t/demo/login` → 200 | ✅ |
| 3 | `/t/acme/login` → 200 (slug valido seedato D3b) | ✅ |
| 4 | `/t/INVALID-SLUG-FOO/login` → 307 → `/not-found` (uppercase fail regex) | ✅ |
| 5 | `/t/api/login` → 307 → `/not-found` (RESERVED) | ✅ |
| 6 | `/t/admin/login` → 307 → `/not-found` (RESERVED) | ✅ |
| 7 | `/not-found` → 404 (Next.js standard render `app/not-found.tsx`) | ✅ |

**Smoke browser interactive delegati a Nicolò pre-merge (5 scenari)**:

1. Login `demo`: `admin@demo.local / Admin123!` → `/t/demo/dashboard` + Welcome "Admin Demo"
2. Login `acme`: `manager@acme.local / Manager123!` → `/t/acme/dashboard` + Welcome "Manager Acme"
3. Logout demo → `/t/demo/login`
4. Session persistence: login demo → Cmd+R → resta loggato in `/t/demo/dashboard`
5. Cross-tenant token edge case: login demo + navigate `/t/acme/dashboard` → behavior osservato (vedi TD-7 sotto)

**Empirical discoveries (#31, +1 cumulative → totale 31)**:

- **#31** — Next.js App Router dynamic segment `[slug]` richiede single-quote shell escape per `mkdir`/`mv`/`git mv`/`ls`. Brackets unquoted = glob pattern → `fatal: No such file or directory`. Pattern: `mkdir -p 'apps/web/src/app/t/[slug]'`. Trivial ma reviewer junior può perdere ~10 min su errore cryptic.

**Tech debt nuovo (1 minor)**:

- **TD-7** ADR-0012 — Cross-tenant token UX edge: user demo apre URL `/t/acme/dashboard` → dashboard renderizza dati demo (JWT contiene `tenantId=demo`). Inconsistenza URL/dati. Fix F1+ (~30min): page-level check JWT tenantId vs `useParams().slug` → mismatch → redirect appropriato. Low priority (richiede manual URL hack utente legittimo).

**Foundation per**: TD-H lockout key per-tenant (B1 carry-over backend, ora sbloccato lato frontend) + future macro-task tenant switching UI + tenant-aware command palette F2.

### TD-4 — Setup Playwright E2E frontend CI (Sessione 10, 2026-05-15)

**Branch**: `feature/td-4-playwright-setup` · **Status**: completato, PR merge pending · **ADR**: [ADR-0016](docs/architecture/ADR-0016-playwright-e2e-frontend-ci.md)

Resolution carry-over TD-4 ADR-0012 (da sessione 7 / E2). Foundation E2E frontend completa, simmetria raggiunta con backend B2b Testcontainers.

**Deliverables (~694 LOC totali)**:

- `apps/web/playwright.config.ts` (70 LOC NEW): config base + 4 projects (setup + chromium/firefox/webkit) + `dependencies: ['setup']` + dotenv `.env.e2e` loader
- `apps/web/e2e/auth.setup.ts` (91 LOC NEW): setup project login real UI demo + acme → storage state files `.auth/<slug>.json` (gitignored)
- `apps/web/e2e/specs/routing.spec.ts` (42 LOC NEW): test #1 root redirect + #6 slug malformato → `/not-found`
- `apps/web/e2e/specs/auth-login.spec.ts` (67 LOC NEW): test #2 login OK + #3 login fail (error message visibile, no redirect)
- `apps/web/e2e/specs/auth-logout.spec.ts` (60 LOC NEW): test #4 logout + token clear. Login UI inline (no storage state shared — Discovery #33 race condition fix)
- `apps/web/e2e/specs/auth-redirect.spec.ts` (30 LOC NEW): test #5 anonymous → redirect login
- `apps/web/e2e/specs/tenant-isolation.spec.ts` (56 LOC NEW): test #7 cross-tenant — documenta gap TD-7 ADR-0012 empiricamente
- `apps/web/e2e/specs/smoke.spec.ts` (21 LOC NEW): sanity check minimo
- `apps/web/.env.e2e.example` (9 LOC NEW, template committato; `.env.e2e` gitignored)
- `apps/web/package.json` (+5 scripts test:e2e:*, +1 devDep `dotenv`)
- `.github/workflows/ci.yml` (+248 LOC, da 57 → 304): nuovo job `e2e-playwright` con container `mcr.microsoft.com/playwright:v1.60.0-jammy` + services Postgres 16 / Redis 7 / Mailpit v1.30, 22 step incluso role rotation gestionale_app

**Test outcomes**:

| Browser | Result | Tempo |
|---------|--------|-------|
| Chromium full | 11/11 PASS (2 setup + 7 reali + 2 smoke) | 9.4s |
| Firefox smoke | 5/5 PASS (smoke + login OK) | 7.0s |
| WebKit smoke | 5/5 PASS (smoke + login OK) | 7.2s |

**Empirical discoveries (#32-35, +4 cumulative → totale 35)**:

- **#32** — Hetzner CPX32 Ubuntu 22.04 minimal manca host deps Playwright (libnspr4/libnss3/libxcb-*). Fix dev: `sudo pnpm exec playwright install-deps`. Fix CI: container image preinstallato.
- **#33** — Race condition logout su storage state condiviso: test #4 invalida JWT server-side, test paralleli con stesso storage state vedono 401. Fix: login UI inline per test che mutano sessione.
- **#34** — WebKit `fill()` non triggera onChange su RHF controlled `input[type="email"]`. Fix: `click() + pressSequentially()`. Solo email field, password.fill() OK.
- **#35** — Migration role rotation con PLACEHOLDER password richiede step CI dedicato (`ALTER ROLE` + DATABASE_URL rebuild URL-encoded).

**Tech debt tracking**:

- **TD-4 ADR-0012**: ✅ RESOLVED
- **TD-7 ADR-0012**: update empirical evidence via `tenant-isolation.spec.ts`. Fix candidato (1) Guard backend cross-check JWT.tenantId vs X-Tenant-Slug preferito.
- **TD-AJ ADR-0016** — Backend `errorCode` esplicito 401 response (frontend fallback E_UNKNOWN attualmente). Bassa, ~15min.
- **TD-AK ADR-0016** — Script `pnpm test:e2e:reset` wrapper Redis FLUSHDB. Bassa, ~10min.
- **TD-AL ADR-0016** — Cache Playwright browsers in CI (per switch matrix futuro). Bassa, ~15min.
- **TD-AM ADR-0016** — Matrix Firefox/WebKit opt-in via tag `@cross-browser`. Bassa, ~30min.
- **TD-AN ADR-0016** — `JWT_SECRET_CI` da `secrets.*` GitHub. Bassa, ~10min.
- **TD-AO ADR-0016** — Page Object Model refactor selettori inline (quando suite > 15 test). Bassa, 1-2h.
- **TD-AP ADR-0016** — Migration role rotation automation (Vault/Doppler). Media (production-blocker), 2-3h.

**Foundation per**: regression visiva auto-caught su PR, fixture pattern multi-tenant + storage state riusabile F1+ (POS cassa, tenant settings, ecc.). Cross-tenant gap (TD-7) regression guard quando fixato.

### RBAC enforcement Guard `@RequirePermissions(...)` (Sessione 11 PR 1, 2026-05-15)

**Branch**: `feature/rbac-permissions-guard` · **Status**: completato, PR merge pending · **ADR**: [ADR-0017](docs/architecture/ADR-0017-rbac-permissions-guard.md)

Resolution carry-over **TD #3 ADR-0010** (sessione 4): macro-task RBAC enforcement Guard generico. Anticipato il trigger "10+ endpoint con permission diverse" — pattern senior chiusura foundation pre-F1.

**Deliverables (~973 LOC nuovi)**:

- `apps/api/src/rbac/interfaces/permissions-metadata.interface.ts` (20 LOC NEW)
- `apps/api/src/rbac/decorators/require-permissions.decorator.ts` (66 LOC NEW): signature overload AND/OR + edge case empty throw
- `apps/api/src/rbac/decorators/require-permissions.decorator.spec.ts` (70 LOC NEW): 6 unit test
- `apps/api/src/rbac/guards/permissions.guard.ts` (259 LOC NEW): Guard + cache Redis + audit + dedupe + `runInTenantContext` wrap
- `apps/api/src/rbac/guards/permissions.guard.spec.ts` (283 LOC NEW): 14 unit test (7 base + 7 cache+audit)
- `apps/api/src/rbac/rbac.module.ts` (29 LOC NEW): UsersModule + RedisModule + ConfigModule imports
- `apps/api/test/e2e/rbac-permissions.e2e-spec.ts` (246 LOC NEW): 3 scenari E2E + `seedRbacFixtures` inline
- `apps/api/src/auth/auth.service.ts` (modificato): +`'auth.permission_denied'` TS union + `export type AuditAction`
- `apps/api/src/tenants/tenants.controller.ts` (modificato): +`@RequirePermissions('sistema.tenant.gestisci')` decorator
- `apps/api/src/tenants/tenants.service.ts` (modificato): -15 LOC inline check + cleanup imports
- `apps/api/src/auth/auth.module.ts` (modificato): JwtAuthGuard provider regolare (no APP_GUARD)
- `apps/api/src/app.module.ts` (modificato): tutti APP_GUARD centralizzati (Throttler → JwtAuth → Permissions)
- `.env.example` (modificato): +`RBAC_CACHE_TTL_S=60`

**Test outcomes**:

| Test type | Result | Tempo |
|-----------|--------|-------|
| Unit rbac (guard + decorator) | 20/20 PASS | <22ms |
| Unit totale apps/api | 45/45 PASS | invariato |
| E2E Testcontainers totale | 7/7 PASS | 13.3s |
| E2E rbac-permissions (3 scenari) | 3/3 PASS | 1.9s |

**Empirical discoveries (#36-38, +3 cumulative → totale 38)**:

- **#36** — NestJS APP_GUARDs cross-module order non-deterministico: JwtAuthGuard in `auth.module.ts:35` + PermissionsGuard in `app.module.ts` → ordine instantiation imprevedibile. Fix: centralizzare TUTTI gli APP_GUARDs nello stesso module per ordine deterministico (Throttler → JwtAuth → Permissions).
- **#37** — Guard stage PRECEDE TenantContextInterceptor (RLS no-context): PermissionsGuard fa query Prisma ma ALS context vuoto a guard stage. Fix: wrap body in `runInTenantContext({tenantId, isSuperAdmin: false}, ...)` (pattern simmetrico a `jwt.strategy.ts:62-65`).
- **#38** — `seedMinimal` insufficient per `createTenant` E2E: missing `system_role_templates` (helper E2E seeda solo tenant+sede+admin, NO 6 templates + 104 mappings). Fix: fixture inline integrativo per-test (`seedRbacFixtures`).

**Tech debt tracking**:

- **TD #3 ADR-0010**: ✅ RESOLVED
- **TD-AS ADR-0017** — Refactor `AuditAction` TS union locale → file dedicato `audit-action.ts`. Bassa, ~15min.
- **TD-AT ADR-0017** — Refactor altri endpoint inline check D4 a `@RequirePermissions` decorator. Bassa, ~30min.
- **TD-AU ADR-0017** — Documentare in `test-app.ts:25-26` lista "API che NON funzionano con seedMinimal solo". Bassa, ~10min.

**TD candidate emersi cleanup PR #27 (sessione 11 post-merge review)**:

- **TD-AV ADR-0017** — `audit_log.entityType` semantica per access control event. Issue Media emersa review pre-merge: `PermissionsGuard.logPermissionDenied` insert audit `auth.permission_denied` con `entityType: 'User'` + `entityId: userId`. Semanticamente debatable (l'evento è AuthorizationCheck, non modifica User). Verifica empirica `schema.prisma` audit_log → decidere se refactor a `'AuthorizationCheck'` o accept pragmatico. Trigger: F1+ aggiunge altri access control events (es. tenant-level permission denied). Stima: ~30min refactor + verifica E2E. ✅ **RESOLVED sessione 13** — vedi [§TD-AV cleanup sessione 13](#td-av-cleanup-sessione-13--entitytype-semantica--convention-pascalcase-2026-05-16).

- **TD-AW ADR-0017** — Raw SQL fixture `seedRbacFixtures` (`rbac-permissions.e2e-spec.ts`) → valutare refactor a Prisma client direct dentro fixture per type-safety. Trade-off: complexity inject Prisma vs raw SQL diretto (schema drift risk vs Prisma TS error compile-time). Decisione corrente: raw SQL pragmatico (coerente con `seedMinimal` helper esistente). Trigger: schema drift rilevato (es. rename column audit_log). Stima: ~20min refactor. ✅ **RESOLVED sessione 13 (won't fix — intentional pattern)** — verifica empirica STOP 2B ha rivelato pattern consolidato in tutti gli helper E2E (`seedMinimal`, `seedSecondTenant`, `seedRbacFixtures`); refactor a Prisma richiederebbe wrap `withSuperAdminContext` artificiale (vedi [ADR-0017 §Resolution TD-AW](docs/architecture/ADR-0017-rbac-permissions-guard.md#resolution-td-aw--intentional-pattern-sessione-13) + Discovery #44).

**Foundation per**: F1 endpoint business (menu, tavoli, ordini, cassa, reports) con `@RequirePermissions(...)` standard. Pattern fail-open layered consolidato a 4 livelli (Lockout/Mail/Throttler/RBAC).

### PR 2 sessione 12 — TD-H lockout per-tenant + TD-AJ errorCode 401 (2026-05-16)

**Branch**: `feat/pr2-td-h-td-aj-lockout-pertenant-errorcode` · **Status**: completato, PR merge pending · **ADR**: [ADR-0013](docs/architecture/ADR-0013-auth-e2e-hardening-b1.md#td-h-resolution-pr-2) + [ADR-0016](docs/architecture/ADR-0016-playwright-e2e-frontend-ci.md#td-aj-resolution-pr-2)

Resolution carry-over **TD-H ADR-0013** (B1 sessione 8) + **TD-AJ ADR-0016** (Playwright sessione 10). PR atomic per ridurre churn auth surface (entrambi toccano `auth.service.ts:login()` flow).

**Decision points lockati**:

- **DP1** lockout key naming `tenant:<tenantId>:email:<email>` (Sub-DP A1: prefix `lockout:locked:` esistente mantenuto, no LockoutService rename — coerente con login-pin pattern `pin:tenant:<id>:device:<id>`)
- **DP2** migration Redis: nota release notes (cleanup `redis-cli --scan --pattern "lockout:locked:email:*" | xargs DEL`), no migration script LOC
- **DP3** errorCode enum centralizzato `apps/api/src/common/error-codes.ts`
- **DP3.1** scope coverage SOLO `/auth/login` (refresh/logout/login-pin/pin-setup → TD-AY)
- **DP4** frontend parseError chain via `messageForErrorCode()` mapping table i18n-ready
- **DP5** smoke E2E backend Testcontainers (extend `auth-login.e2e-spec.ts`, no script standalone — Discovery #40)

**Sub-DP raccomandate lockate**: A1 (prefix opaque preserved), B1 (LockoutService signature stabile), C1 (test cross-tenant in `auth.service.spec.ts` composition layer), D1 (`throwInvalidCredentials()` helper inline, no global filter), E1 (`apps/web/src/lib/error-codes.ts` separato, NO refactor `api.ts`).

**Deliverables (~261 LOC net)**:

- `apps/api/src/common/error-codes.ts` (22 LOC NEW): enum `AuthErrorCode.INVALID_CREDENTIALS` + `CommonErrorCode.UNKNOWN`
- `apps/api/src/auth/dto/auth-error-response.dto.ts` (22 LOC NEW): interface `AuthErrorResponse`
- `apps/api/src/auth/auth.service.ts` (modificato +23/-12): `LOCKOUT_KEY_LOGIN(tenantId, email)` + helper `throwInvalidCredentials()` + cleanup TODO obsoleto
- `apps/api/src/auth/auth.service.spec.ts` (modificato +95/-10): 3 nuovi test cross-tenant (Test 7/8/9 isolation `recordFailedAttempt`/`checkLockout`/`resetAttempts`) + Test 2/3 shape update TD-AJ
- `apps/api/test/e2e/helpers/test-app.ts` (modificato +47/0): nuovo helper `seedSecondTenant(url, {email?})` per shared-email scenarios
- `apps/api/test/e2e/auth-login.e2e-spec.ts` (modificato +51/-11): Test 2 shape TD-AJ + nuovo Test 4 TD-H cross-tenant lockout isolation
- `apps/web/src/lib/error-codes.ts` (21 LOC NEW): `ERROR_CODE_MESSAGES` table + `messageForErrorCode()` i18n-ready
- `apps/web/src/app/t/[slug]/login/page.tsx` (modificato +4/-6): refactor mapping inline → `messageForErrorCode()`
- `apps/web/e2e/specs/auth-login.spec.ts` (modificato +26/-14): intercept response 401 + assert shape TD-AJ + alert italian-localized

**Test outcomes**:

| Test type                                       | Result          | Tempo |
| ----------------------------------------------- | --------------- | ----- |
| Unit `auth.service.spec.ts` (cross-tenant +3)   | 9/9 PASS        | 17ms  |
| Unit totale apps/api                            | 48/48 PASS      | ~1s   |
| E2E `auth-login.e2e-spec.ts` (Test 4 nuovo)     | 4/4 PASS        | 8.4s  |
| E2E Testcontainers totale (3 file)              | 8/8 PASS        | 14s   |
| Typecheck API + Web                             | OK              | -     |

**Empirical discoveries (#39-41, +3 cumulative → totale 41)**:

- **#39** — `noUncheckedIndexedAccess` strict frontend: `Record<string, string>` lookup ritorna sempre `string | undefined`, anche dot-access. Fix in `error-codes.ts`: estratto `FALLBACK_MESSAGE` const literal evita doppio coalesce. Pattern da seguire per future mapping table.
- **#40** — Smoke server-side standalone NON necessario quando esiste infra E2E Testcontainers: pattern "extend, don't create" — `auth-login.e2e-spec.ts` con `seedMinimal` + helper preferibile a `apps/api/scripts/smoke-pr2-td-h.ts` standalone. 1 infra di test = no drift.
- **#41** — `seedMinimal` E2E helper monolitico richiede estensione via sibling helper `seedSecondTenant` (NON flag opzionale): backward-compat strict + single-responsibility + `email` configurabile per shared-email DoS-proof scenarios.

**Tech debt tracking**:

- **TD-H ADR-0013**: ✅ RESOLVED
- **TD-AJ ADR-0016**: ✅ RESOLVED
- **TD-AY ADR-0016** (nuovo) — Coverage `errorCode` altri 401 endpoint (`/auth/refresh`, `/auth/logout`, `/auth/login-pin`, `/auth/pin-setup`): oggi DP3.1 ha coperto solo `/auth/login`, gli altri usano `UnauthorizedException(code-as-message)` con shape NestJS default. Frontend `messageForErrorCode` fallback `E_UNKNOWN` per quei flow. Bassa, ~30min. ⚠️ **Scope espanso in PR cleanup sessione 12** — vedi [§PR cleanup post-merge PR 2 sessione 12](#pr-cleanup-post-merge-pr-2-sessione-12-2026-05-16).

**Foundation per**: lockout cross-tenant isolation production-safe (un attacker che conosce un'email blocca SOLO il tenant target, non cross-tenant) + i18n login error UX i18n-ready (estensione futura nestjs-i18n keep API stabile).

### PR cleanup post-merge PR 2 sessione 12 (2026-05-16)

**Branch**: `docs/cleanup-pr2-post-merge` · **Tipo**: docs-only (zero code change funzionale) · **Trigger**: smoke browser Nicolò post-merge `feat(auth): TD-H + TD-AJ` (commit `17c3526`) + cross-link correction Discovery #39

Pattern consolidato Sezione 0.6 Pattern 5 (cleanup follow-up post-merge come PR docs: separata). Captura 2 nuove discovery emerse da smoke + corregge attribution Discovery #39 (era erroneamente in ADR-0013, semanticamente è frontend TS = ADR-0016).

**Deliverables (~+47/-7 LOC docs-only)**:

- `docs/architecture/ADR-0013-auth-e2e-hardening-b1.md` (+15/-3): rimossa Discovery #39 (moved to ADR-0016) + aggiunta Discovery #42 "LockoutExceptionFilter naming inconsistency" + cross-link TD-AY
- `docs/architecture/ADR-0016-playwright-e2e-frontend-ci.md` (+31/-2): Discovery #39 moved da ADR-0013 + Discovery #43 nuovo "DTO class-validator shape" + §TD-AY scope espanso (3 punti: 401 endpoint + 429 lockout rename + 400 validation factory) + header §Empirical discoveries fix math drift (Sub-DP G)
- `PROGRESS.md` (+15/-8): bump Discovery counter 41→43 + sezione dedicata + TD-AY annotation scope espanso + candidate prossima sessione stima rivista
- `README.md` (condizionale): nota inline shape legacy 429 lockout `{code, message}` vs nuova 401 `{errorCode, ...}` taxonomy (se applicabile dopo audit empirico)

**Empirical discoveries (#42-43, +2 cumulative → totale 43)**:

- **#42** — `LockoutExceptionFilter` naming inconsistency: filter B1 sessione 8 emette body 429 con field `code: 'E_AUTH_ACCOUNT_LOCKED'`, naming legacy precedente alla taxonomy `errorCode` introdotta da TD-AJ PR 2. Smoke browser empirical: alert 429 mostra raw `body.message` italian-localized (UX non rotta), ma frontend `parseError()` ricade su fallback `E_UNKNOWN` (no i18n-ready per future locale switch). Fix scope TD-AY scope expansion (out of scope PR 2 DP3.1).
- **#43** — DTO `class-validator` shape non coerente con taxonomy TD-AJ: NestJS `ValidationPipe` default emette `{statusCode: 400, error: 'Bad Request', message: [array of strings]}` — manca `errorCode`, `message` è array non string (incompatibile con `ApiError.message: string` frontend), manca `timestamp`. Frontend `parseError()` fallback `E_UNKNOWN` → UX generica "Si è verificato un errore. Riprova" perde dettaglio validation field-specific. Fix scope TD-AY scope expansion (richiede custom `ValidationPipe.exceptionFactory`).

**Tech debt update**:

- **TD-AY ADR-0016** (scope espanso): da "Coverage errorCode altri 401 endpoint" a "Allineamento taxonomy `errorCode` unificata cross-endpoint COMPLETA — 3 punti: (1) 401 endpoint mancanti, (2) 429 `LockoutExceptionFilter` `code` → `errorCode` rename, (3) 400 custom `ValidationPipe` exception factory". Stima: ~30min → **~45-60min realistic**. Priorità: Bassa (UX legacy gap, no security). Trigger re-eval: F1+ aggiunge endpoint 400/429 con UX visible OR smoke browser segnala alert generico come blocker UX.

**Foundation per**: taxonomy `errorCode` unificata cross-endpoint pronta per TD-AY follow-up (priorità modulata da feedback UX F1+).

### TD-AV cleanup sessione 13 — entityType semantica + convention PascalCase (2026-05-16)

**Branch**: `feat/td-av-aw-cleanup-session-11` · **Tipo**: 1 PR atomic con 2 commit (refactor semantico audit + docs Resolution TD-AW intentional) · **ADR**: [ADR-0017 §Convention `audit_log.entityType` naming](docs/architecture/ADR-0017-rbac-permissions-guard.md#convention--audit_logentitytype-naming-resolution-td-av-sessione-13) + [§Resolution TD-AW intentional](docs/architecture/ADR-0017-rbac-permissions-guard.md#resolution-td-aw--intentional-pattern-sessione-13) + [§Discovery #44](docs/architecture/ADR-0017-rbac-permissions-guard.md#discovery-44--e2e-helper-raw-sql-pattern-è-intentional-sessione-13)

Resolution carry-over **TD-AV + TD-AW ADR-0017** (review sessione 11 post-merge PR #27). STOP 1 verifica empirica ha confermato `audit_log.entity_type` è `text` libero (no enum DB) aprendo a refactor semantico zero-migration. STOP 2B verifica empirica ha re-validato TD-AW e rivelato pattern raw SQL E2E helper consolidato → won't fix intentional.

**Decision points lockati**:

STOP 1 (Commit 1 TD-AV):

- **DP-AV-1** = B → schema `text`, no migration richiesta (verifica live container: `entity_type | text`)
- **DP-AV-2** = A → `'AuthorizationCheck'` literal in `permissions.guard.ts:243` (PascalCase compound, semantica precisa: l'evento è check di autorizzazione, non modifica User)
- **Sub-DP AV-3** = C (emersa STOP 1) → outlier latente `tenants.service.ts:167` con `entityType: 'tenant'` lowercase fixato a `'Tenant'` PascalCase + convention naming documentata in ADR-0017 per prevenire drift futuro
- **DP-PR** = A → 1 PR, 2 commit atomic

STOP 2B (Commit 2 TD-AW):

- **DP-AW-1** revised = won't fix → refactor a Prisma client richiederebbe wrap `withSuperAdminContext` artificiale (RLS extension chain ADR-0009 decisione 11 fail-fast). Pattern raw SQL consolidato in tutti gli helper E2E (`seedMinimal`, `seedSecondTenant`, `seedRbacFixtures`) — intentional per 3 motivi: superuser bypass RLS by design + skip softDelete extension side-effects + performance (skip per-op interactive tx).
- **Discovery #44** catturata: lesson generalizzabile "review TD su empirical evidence PRIMA di implementare fix non-trivial" (12+ catture cumulative).

**Deliverables commit 1 TD-AV (~+57/-3 LOC, code +2/-2 + docs +55/-1)**:

- `apps/api/src/rbac/guards/permissions.guard.ts:243` (+1/-1): `entityType: 'User'` → `'AuthorizationCheck'`
- `apps/api/src/tenants/tenants.service.ts:167` (+1/-1): `entityType: 'tenant'` → `'Tenant'` (fix outlier Sub-DP AV-3)
- `docs/architecture/ADR-0017-rbac-permissions-guard.md`: nuova sezione `## Convention — audit_log.entityType naming` con tabella esempi + anti-pattern + resolution Sub-DP AV-3
- `PROGRESS.md`: TD-AV inline annotation RESOLVED + nuova entry sessione 13

**Deliverables commit 2 TD-AW (docs-only, zero code change runtime)**:

- `docs/architecture/ADR-0017-rbac-permissions-guard.md`: nuova sezione `## Resolution TD-AW — Intentional pattern` (3 razionali + trade-off + pattern E2E helper convention) + `## Discovery #44 — E2E helper raw SQL pattern è intentional`
- `PROGRESS.md`: TD-AW inline annotation RESOLVED (won't fix) + bump Discovery counter 43 → 44 + extension this entry

**Convention enforcement TD-AV**: applicativa via review pre-merge + grep `entityType:` su `apps/api/src/**/*.ts` (3 occorrenze tutte PascalCase singolare post-fix: `'AuthorizationCheck'`, `'Tenant'`, `'User'`).

**Convention enforcement TD-AW**: documentata in ADR-0017 §Resolution TD-AW (raw SQL setup phase + Prisma wrappato assert phase). Verifica futura empirica grep `from '@gestionale/db'` su `apps/api/test/e2e/` deve restare 0 match.

**Foundation per**: futuri audit events (es. `device.linked`, `pin.changed`, F1+ business actions) seguono convention PascalCase + futuri helper E2E seguono pattern raw SQL setup convention senza ricerca semantica caso-per-caso.

**Test**: 48/48 unit + 8/8 E2E + 11/11 Playwright invariati post-PR.

### F1 shell sessione 14 — Next.js shell + i18n + auth refactor (2026-05-17)

**Branch**: `feat/f1-shell` · **Tipo**: 1 PR atomic foundation F1 (no split, file interdipendenti Context+Gate+Layout+Sidebar+Topbar) · **ADR**: [ADR-0018](docs/architecture/ADR-0018-f1-shell-ui-foundation.md) (DP-1→DP-5 + Sub-DP A-E + 5 TD + 3 Discovery refs)

**Macro-task F1-shell completato**: foundation UI shell Next.js (sidebar + topbar + theme + i18n + auth protection) come base per future feature F1 (Menu CRUD, Mappa tavoli, Comande, Cassa, KDS, Report, Settings, Dashboard widget, AI Assistant). 10-STOP workflow incrementale con verifica empirica preliminare + Sub-DP risolti pre-implementation.

**Decision points lockati** (vedi [ADR-0018](docs/architecture/ADR-0018-f1-shell-ui-foundation.md#decisions)):

- **DP-1** UI library: shadcn/ui (continuity E2, +3 componenti: sheet, dropdown-menu, avatar)
- **DP-2** Layout: Sidebar 240px fixed desktop + Topbar + Sheet drawer mobile
- **DP-3** i18n: `next-intl@4.12.0` con `localePrefix: 'never'` (cookie-based, no segment URL)
- **DP-4** Auth protection: AuthContext + AuthGate client-side (TD-BA migration path post-TD-1 httpOnly cookie)
- **DP-5** Smoke E2E: 3 test happy path `shell.spec.ts` (riusa fixture `auth.setup.ts` storageState)

**Sub-DP resolutions** (4 da STOP 1 verifica empirica + 1 emerso runtime STOP 4):

- **Sub-DP-A** locale routing: A3 `localePrefix: 'never'` cookie-based (alternative A1/A2 scartate, rompono middleware existing `/t/<slug>/<page>`)
- **Sub-DP-B** AuthContext refactor estrazione da dashboard inline (pattern TD-6 logout server-side preservato)
- **Sub-DP-C** Provider wrap: `AuthProvider` in `[slug]/layout.tsx` (tenant-scoped) + `ThemeProvider` in root `app/layout.tsx` (user-scoped cross-tenant)
- **Sub-DP-D** Route group `(authenticated)` introdotto (URL invariate, separa login pubblica da shell autenticato)
- **Sub-DP-E** Same-tab auth sync via `AUTH_CHANGE_EVENT` custom event (emerso STOP 4, Discovery #45)

**Deliverables (~1164 LOC code + ~460 LOC docs)**:

- 18 nuovi file source + 1 spec test (1114 LOC totale)
  - `apps/web/src/i18n/{config.ts, request.ts, messages/{it,en}.json}` (196 LOC) — next-intl cookie reader
  - `apps/web/src/contexts/AuthContext.tsx` (166 LOC) — tenant-scoped state + dual listener (storage + AUTH_CHANGE_EVENT)
  - `apps/web/src/components/auth/AuthGate.tsx` (48 LOC) — client guard redirect login
  - `apps/web/src/components/shell/{Sidebar,Topbar,MainLayout,PlaceholderPage}.tsx` (355 LOC) — shell components
  - `apps/web/src/lib/auth-logout.ts` (39 LOC) — helper TD-6 pattern
  - `apps/web/src/app/api/set-locale/route.ts` (46 LOC) — POST cookie NEXT_LOCALE setter
  - `apps/web/src/app/t/[slug]/{layout.tsx, (authenticated)/{layout.tsx, dashboard/page.tsx, 7×placeholder/page.tsx}}` (217 LOC totale) — providers wrap + route group + 7 placeholder + dashboard moved
  - `apps/web/e2e/specs/shell.spec.ts` (82 LOC) — 3 smoke test
- 5 file modificati (delta +57 LOC additive)
  - `apps/web/src/app/layout.tsx` (+14) — ThemeProvider next-themes wrap
  - `apps/web/src/middleware.ts` (+18) — cookie NEXT_LOCALE guard (slug logic intatta)
  - `apps/web/src/lib/auth.ts` (+14) — AUTH_CHANGE_EVENT dispatch (Sub-DP-E)
  - `apps/web/next.config.mjs` (+6) — createNextIntlPlugin wrap
  - `apps/web/package.json` (+5 deps) — next-intl, next-themes, 3 shadcn peer
- ADR-0018 (~370 LOC) — DP-1→DP-5 + Sub-DP A-E + Conventions + 5 TD + 3 Discovery refs
- PROGRESS.md (questa entry) + README.md status bump F1 shell ✅

**Conventions documentate** ([ADR-0018 §Conventions](docs/architecture/ADR-0018-f1-shell-ui-foundation.md#conventions)):

- Cookie naming `NEXT_LOCALE` (Pages Router heritage preserved)
- Middleware locale guard skip on RedirectResponse (apply only su pass-through)
- AuthContext fetch `/me` on mount (migration path additivo TD-1)
- Logout helper shared `auth-logout.ts` (TD-6 POST + `finally clearTokens`)
- Shared `PlaceholderPage` component (anti-DRY 7 nav placeholder)

**Tech debt tracked (5 nuovi TD)**:

- **TD-BA** — Auth protection client-side → middleware migration post-TD-1 (~30min)
- **TD-BB** — i18n SEO multi-locale F2 future (route group `(public)` con localePrefix switch) (~1h)
- **TD-BC** — `/api/set-locale` senza rate limit (low-priority F2+) (~20min)
- **TD-BD** — Webpack warnings next-intl extractor dynamic require (3 occorrenze, issue noto upstream, cattura preventiva)
- **TD-BE** — **Sub-1 RESOLVED in questa PR (STOP 8.5)**: `lib/api.ts:parseError` fallback chain `body.errorCode ?? body.code` (backend taxonomy `errorCode` vs `code` inconsistente — TD-AY in flux) + sintetico `E_RATE_LIMITED` su 429 senza errorCode (ThrottlerException default). `lib/error-codes.ts` +2 mapping IT (`E_AUTH_ACCOUNT_LOCKED`, `E_RATE_LIMITED`). Verifica empirica runtime: alert UI mostra ora messaggio specifico invece di fallback generico. **Sub-2 PENDING** cross-ref TD-AY: full suite Playwright flake (NOT regression F1-shell, Discovery #47) richiede test infra tuning (THROTTLE_AUTH_LIMIT bump CI flag / beforeAll backoff / retry-on-429) sessione 15.

**Discoveries cumulative bump 44 → 47** (+3 sessione 14):

- **#45** Same-tab auth sync via custom event. Storage event nativo cross-tab-only — refactor estrazione Context da inline auth richiede event bus same-tab esplicito. Pattern decoupled `AUTH_CHANGE_EVENT` in `lib/auth.ts` dispatcha post setTokens/clearTokens, login page ignora Context. Generalizzabile a future `usePermissionsChange`/`useTenantChange`.
- **#46** Dev server zombie post `pnpm build` parallelo. `.next/` artefatti misti prod+dev + child `next-server` zombie post parent kill (EADDRINUSE silente). Lesson preventiva: stop dev server prima di build (`pkill -9 -f "next-server"` + `rm -rf .next`). Conferma memoria utente `feedback_debug_porte_zombie_processi.md`.
- **#47** Full Playwright suite chromium flaky per TD-H lockout per-tenant backend. Multipli login successivi `demo` (auth.setup + 4 auth-* + tenant-isolation) saturano contatore lockout. Fallback `messageForErrorCode` su errorCode non-mapped → cascading failures (3 spec timeout). Pre-existing issue post-merge PR #29 (TD-H lockout per-tenant), **NOT regression F1-shell**. Mitigation futura: TD-BE resolution.

**Test**: 48/48 unit + 8/8 E2E backend invariati + target 9/9 Playwright chromium PASS (2 setup + 4 auth-* esistenti + 3 nuovi shell.spec.ts in 9.9s). Full suite 14/14 affetta da Discovery #47 flake pre-existing — risolta post TD-BE sessione 15.

**Foundation per**: 8 feature F1 successive (Menu CRUD, Mappa tavoli, Comande PWA, Cassa, KDS, Report, Settings, Dashboard widget) hanno shell pronta + i18n + auth refactor + theme. Sessione 15+ implementa una feature alla volta sotto shell esistente.

**Cleanup post-merge**: opzionale follow-up docs/cleanup-f1-shell-post-merge se emergono gap minori in review pre-merge (Pattern 5).

- **TD-BF ✅ RESOLVED** (cleanup PR post-merge sessione 14 `docs/cleanup-f1-shell-post-merge`) — i18n dead-code keys cleanup. Original scope `shell.welcome` only catturato in note STOP 10. **Expanded scope** (Sub-DP cleanup-expanded, verifica empirica STOP cleanup-verifica) a 7 chiavi `shell.*` unused (`brand`, `welcome`, `tenant`, `role`, `loading`, `loggingOut`, `topbar.profile`) via grep cross-codebase `useTranslations` calls. Rimosse 7 chiavi × 2 locale = 14 LOC delta. Convention "i18n keys solo quando usate" catturata in [ADR-0018 §TD-BF](docs/architecture/ADR-0018-f1-shell-ui-foundation.md#td-bf--i18n-dead-code-keys-cleanup-resolved-post-merge-sessione-14).

### TD-AY + TD-BE Sub-2 atomic closure sessione 15 (2026-05-19)

**Branch**: `chore/td-ay-td-be-sub2-cleanup` · **Tipo**: 1 PR atomic single commit · **ADR**: [ADR-0016 §TD-AY resolution](docs/architecture/ADR-0016-playwright-e2e-frontend-ci.md#td-ay-resolution-sessione-15) + [§TD-BE Sub-2 resolution](docs/architecture/ADR-0016-playwright-e2e-frontend-ci.md#td-be-sub-2-resolution-sessione-15)

**Macro-task**: Cleanup foundation carry-over sessioni 11-14 — chiusura definitiva TD-AY (taxonomy errorCode cross-endpoint) + TD-BE Sub-2 (Playwright full suite determinism).

**Decisioni:**

- **DP-1 C** atomic single PR (vs 2 PR separate): TD-AY + TD-BE Sub-2 logicamente accoppiati (entrambi affect auth error contract end-to-end).
- **DP-2 A2** `GlobalHttpExceptionFilter` single source of truth shape (vs A1 enum+DTO refactor 7+ call site, vs A3 endpoint-per-endpoint patch): scope contenuto + drop-in compatibility frontend `parseError` esistente.
- **DP-3 α1** env override CI surgical (`THROTTLE_AUTH_LIMIT 5→100` job `e2e-playwright`) vs γ Redis reset `beforeEach`: drop-in vs ~1h+ scaffolding `globalSetup` + endpoint admin (verifica empirica STOP 0: NO helper esistente).

**Implementazione (Pattern 4 layered review, STOP 0-3):**

- **STOP 0** verifica empirica codebase pre-strategia: confermato NO Redis cleanup helper, NO `beforeEach`/`globalSetup` Playwright, NO endpoint admin reset throttler, `LockoutExceptionFilter` usa `body.code` + `extends BaseExceptionFilter`, 7+ call site `UnauthorizedException('E_*')` legacy.
- **STOP 1** implementazione + smoke server-side: 48/48 unit + 8/8 E2E Testcontainers PASS dopo 2 fix iterativi (Discovery #48 + #49 emerse da E2E test failure 1° run).
- **STOP 2** review pre-merge file-by-file Pattern 4 layered: 4 batch (filter + wiring + lockout refactor + test/CI), 8 minor concerns / 0 blocker. 1 fix pre-commit (DI priority comment esplicito in `auth.module.ts`).
- **STOP 3** commit atomic + ADR update + PROGRESS entry + PR create.

**Files modificati (7 + 2 docs):**

- `apps/api/src/common/filters/global-http-exception.filter.ts` (new, 184 LOC) — `@Catch(HttpException)` 4 detection branches + extras preservation
- `apps/api/src/main.ts` (+8) — `useGlobalFilters(new GlobalHttpExceptionFilter())`
- `apps/api/src/auth/filters/lockout-exception.filter.ts` (refactor) — `extends GlobalHttpExceptionFilter` (era BaseExceptionFilter), `isLockoutResponse` usa `errorCode`
- `apps/api/src/auth/auth.service.ts` (+/-3) — `throwAccountLocked` body `code` → `errorCode`
- `apps/api/src/auth/auth.module.ts` (+/-6) — commento APP_FILTER DI priority + TD-AY rationale
- `apps/api/test/e2e/auth-login.e2e-spec.ts` (+/-12) — assertion `body.code` → `body.errorCode` × 2 + bonus statusCode assert
- `.github/workflows/ci.yml` (+7) — `THROTTLE_AUTH_LIMIT` 5→100 + commento TD-BE Sub-2 rationale
- `docs/architecture/ADR-0016-playwright-e2e-frontend-ci.md` (+93/-1) — §TD-AY resolution + §TD-BE Sub-2 resolution + TD table row update
- `PROGRESS.md` (+entries) — sessione 15 entry + header bump

**Discoveries cumulative bump 47 → 49** (+2 sessione 15):

- **#48** — `extras` field preservation contract DTO custom: filter v1 stripava `timestamp` field di `AuthErrorResponse` TD-AJ → E2E test failure 1° run. Fix `extractExtras()` + spread `...extras` PRIMA dei field normalizzati (precedenza esplicita normalizzati safe by-design).
- **#49** — NestJS `UnauthorizedException(code)` body semantica controintuitiva: il code finisce in `body.message` (NOT `body.errorCode`). Filter v1 fallback faceva risolvere `body.errorCode='E_UNAUTHORIZED'` invece di taxonomy reale `E_AUTH_TENANT_REQUIRED` → E2E test failure 1° run. Detection branch dedicata (taxonomy in body.message) necessaria per backward-compat 7+ legacy call site senza refactor.

**Tech debt:**

- ✅ **TD-AY RESOLVED** (ADR-0016 §TD-AY resolution sessione 15)
- ✅ **TD-BE Sub-2 RESOLVED** (ADR-0016 §TD-BE Sub-2 resolution sessione 15)
- 🆕 **TD-BG** (proposta) — convergenza stilistica 7+ call site `UnauthorizedException('E_*')` → DTO esplicito (`AuthErrorResponse` pattern) + restringi `isTaxonomyCode` regex post-migration. Non-urgente, capture in ADR-0016 trade-off.
- 🆕 **TD-BH** (proposta) — structured security logging 401/403 ripetuti (fraud detection observability). Oggi `Logger.error` solo 500+ per design (4xx atteso no noise). Non-urgente.

**Test:**

- ✅ Unit backend: 48/48 PASS
- ✅ E2E Testcontainers backend: 8/8 PASS (15.26s)
- ⏸ Curl smoke server-side: SKIP (API dev :3000 down localmente, coverage via Testcontainers)
- ⏳ Playwright full suite 9/9: verify post-merge CI run (env override TD-BE Sub-2)

**Foundation status post-merge:**

- Foundation security/scaling F1: 100% (invariato)
- Foundation cleanup carry-over sessioni 11-14: **100% ✅** (chiusura definitiva TD-AY + TD-BE Sub-2)
- F1 shell UI: 100% (invariato sessione 14)
- Next: sessione 16 jump a F1 Menu CRUD (prima feature business) con tabula rasa cleanup.

### Cleanup follow-up post-merge — PR #35 (TD-BI + Discovery #50) (2026-05-19)

**Branch**: `docs/cleanup-td-bi-discovery-50-post-merge` · **Tipo**: 1 PR cleanup follow-up · **ADR**: [ADR-0012 §TD-7 sessione 15 update](docs/architecture/ADR-0012-frontend-auth-flow.md#sessione-15-update--f1-shell-side-effect-discovery-50)

**Scope:** chiusura TD-BI stale test + capture Discovery #50 ADR-0012 §TD-7.

**Decisioni:**

- **TD-BI** — F1 riformulazione spec `tenant-isolation.spec.ts` per nuova semantica F1-shell (redirect implicito cross-tenant). Spec funge da regression guard contro futuri refactor F1-shell che potrebbero accidentalmente riaprire il gap UI.
- **Discovery #50** capture in ADR-0012 §TD-7 sessione 15 update — gap parzialmente mitigato UI (side-effect AuthGate + AuthContext F1-shell), backend invariato.
- **TD-7 priority bump**: non più cosmetico, **necessario** per defense-in-depth backend (client non-browser, mobile app future, integrazioni API, security audit). Candidate sessione 16+ post Menu CRUD.

**Discoveries cumulative bump 49 → 50** (+1 vs PR #34):

- **Discovery #50** — F1-shell AuthGate side-effect: cross-tenant access pattern `demo_storageState + /t/acme/dashboard` innesca redirect implicito a `/t/acme/login` durante navigation + render flow F1-shell. UI parzialmente chiusa (lato UX, side-effect non intenzionale), backend `/me` invariato (`tenant.middleware.ts:43` skippa cross-check se `req.user` post-JwtAuthGuard). Rivelato da PR #34 CI failure su stale spec sessione 14 (locator `getByText(/^welcome\s+/i)` non match login form `Accedi` renderizzato al timeout invece di dashboard).

**Tech debt:**

- ✅ **TD-BI RESOLVED** (riformulazione spec come regression guard nuovo comportamento UI)
- 🔼 **TD-7 priority bump** ([ADR-0012 §TD-7 sessione 15 update](docs/architecture/ADR-0012-frontend-auth-flow.md#sessione-15-update--f1-shell-side-effect-discovery-50)) — backend Guard cross-check defense-in-depth necessario, candidate sessione 16+

**Files modificati (3):**

- `apps/web/e2e/specs/tenant-isolation.spec.ts` — riformulazione integrale (+~30 LOC commenti evoluzione semantica + nuove assertion regression guard redirect implicito)
- `docs/architecture/ADR-0012-frontend-auth-flow.md` — sub-sezione `Sessione 15 update — F1-shell side-effect (Discovery #50)` dopo Update sessione 10 (+~40 righe)
- `PROGRESS.md` — header bump 49→50 + sub-sezione cleanup PR #35 + candidate list update

**Foundation status (invariato post-PR #34):**

- Foundation security/scaling F1: 100%
- Foundation cleanup carry-over sessioni 11-14: 100% ✅
- F1 shell UI: 100% (sessione 14)
- F1 cleanup carry-over sessione 15: **100% ✅** (TD-BI chiuso)
- Next: sessione 16 jump a F1 Menu CRUD con tabula rasa cleanup.

### TD-7 backend Guard cross-tenant defense-in-depth — sessione 16 (2026-05-20)

**Branch**: `feat/td-7-tenant-consistency-guard` · **Tipo**: 1 PR feature backend lean (4 file scope + 2 docs) · **ADR**: [ADR-0012 §TD-7 sessione 16 update](docs/architecture/ADR-0012-frontend-auth-flow.md#sessione-16-update--td-7-resolved-pr-36)

**Scope:** chiusura TD-7 ADR-0012 (priority bumped sessione 15 da Discovery #50). Defense-in-depth backend per client non-browser (curl, mobile app future, integrazioni API).

**Decisioni:**

- **1A SPLIT** — TD-7 standalone S16 + Menu CRUD progressivo S17+ (scope F1 Menu reale ~5-7 modelli Prisma da BRIEF B3 + gate accettazione D5, session carving multi-sessione raccomandato S17-S20: schema+CRUD base, listini, varianti, foto upload)
- **1A TenantConsistencyGuard APP_GUARD globale** post-`JwtAuthGuard` pre-`PermissionsGuard` (ADR-0017 ordering preservato)
- **5A KISS inline lookup** in Guard — NO `TenantLookupService` extraction prematuro (refactor solo quando 4° consumer compare; oggi 3 luoghi: `tenant.middleware.ts`, `tenants.service.ts`, `tenant-consistency.guard.ts`)
- **Cache Redis 60s TTL** (RedisService riuso) + fallback Postgres `withSystemContext` (resiliency: Redis down NON rompe auth)
- **E_AUTH_TENANT_REQUIRED + E_AUTH_TENANT_MISMATCH** aggiunti FE+BE taxonomy

**Discoveries cumulative bump 50 → 51** (+1 vs sessione 15):

- **Discovery #51 candidate** — Redis cache TTL persistence cross-test artifact. Cache positiva TTL > test duration richiede flush selettivo `beforeEach` su test suite che muta dati cached. In test E2E `truncateDatabase` rigenera tenant UUID ad ogni `beforeEach`, ma cache Redis (TTL 60s) restituisce UUID stale del run precedente → JWT.tenantId (nuovo run) ≠ cached slugTenantId → false positive mismatch 401. Test-only artefact (prod immutable UUID), convention test infra non TD. Fix applicato: `flushTenantSlugCache(host, port)` helper in `beforeEach` (DEL via SCAN keyspace `tenant:slug:*`).

**Tech debt:**

- ✅ **TD-7 RESOLVED** ([ADR-0012 §TD-7 sessione 16 update](docs/architecture/ADR-0012-frontend-auth-flow.md#sessione-16-update--td-7-resolved-pr-36)) — `TenantConsistencyGuard` defense-in-depth backend
- 🆕 **TD-BJ candidate** — Cache invalidation `DEL tenant:slug:${slug}` su endpoint manage tenant lifecycle futuro (eventual consistency 60s TTL-only oggi)
- 🆕 **TD-BK candidate** — Audit log persistente `tenant_mismatch_attempt` (coerente pattern `permission_denied` PermissionsGuard, oggi solo `Logger.warn`)

**Pattern senior consolidati:**

- **Pattern 29** (Empirical re-scoping STOP 0) confermato — scope endpoint 2 reali (`/me`, `/tenants`) vs assumed N. APP_GUARD globale cattura automaticamente futuri controller Menu senza opt-in
- **Pattern 24 / Errore #20 prevention** applicato 4x in STOP 1: DbService path (NON `DatabaseService`), `withSystemContext` signature (callback no-args NON prisma-arg), error-codes structure (Record IT-only NON dict it/en), seed helpers split (`seedMinimal` + `seedSecondTenant` NON `seedDemoAndAcme` unico). Tutti auto-corretti via empirical check pre-edit
- **Pattern 28** spot-check massivo bash unico per PR feature lean (4 file): 0 anomalie blocker

**Files modificati (6):**

| File                                                            | Type | LOC                  |
| --------------------------------------------------------------- | ---- | -------------------- |
| `apps/api/src/auth/guards/tenant-consistency.guard.ts`          | new  | 188                  |
| `apps/api/test/e2e/tenant-consistency.e2e-spec.ts`              | new  | 152                  |
| `apps/api/src/app.module.ts`                                    | mod  | +7/-1                |
| `apps/web/src/lib/error-codes.ts`                               | mod  | +3                   |
| `docs/architecture/ADR-0012-frontend-auth-flow.md`              | mod  | sessione 16 update   |
| `PROGRESS.md`                                                   | mod  | sessione 16 entry    |

**Test:**

- Unit backend: **48/48 PASS** ✅ (zero regressioni)
- E2E Testcontainers backend: **13/13 PASS** ✅ (5 nuovi `tenant-consistency` + 8 esistenti regression)
- Curl smoke locale: SKIP (API dev down, coverage via Testcontainers sufficiente)
- Spot-check Pattern 28 cluster: 0 anomalie blocker

**Foundation status post-merge:**

- Foundation security/scaling F1: **100%** (invariato + defense-in-depth ESTESO via TD-7)
- Foundation cleanup carry-over sessioni 11-15: **100% ✅** (invariato)
- F1 shell UI: 100% (invariato sessione 14)
- F1 cleanup carry-over sessione 15: 100% ✅ (invariato)
- **TD-7 cross-tenant defense-in-depth backend: 100% ✅** (sessione 16)
- Next: sessione 17 jump a F1 Menu CRUD schema completo F1 design + migration + CRUD backend (5-7 modelli Prisma — re-eval scope BRIEF sessione 16 STOP 0.5).

### F1 Menu CRUD schema + backend base — sessione 17 (2026-05-21)

**Branch**: `feature/f1-menu-crud-schema` · **Tipo**: 1 PR feature schema + backend (28 file) · **ADR**: [ADR-0019](docs/architecture/ADR-0019-f1-menu-crud-schema.md)

**Scope:** prima feature business F1. Schema dati Menu domain + migration RLS + backend CRUD base + seed dimostrativo + E2E. BRIEF §B3 + gate accettazione D5 (Menu 3 livelli + listini multipli) + D29 (schema PRE F2/F3 completo).

**Scope completato:**

- Schema Prisma: 5 modelli business (`Menu`, `MenuCategory`, `Article`, `PriceList`, `ArticlePrice`) + 2 placeholder PRE F2 (`Recipe`, `PricingRule`) + 5 enum (`Allergen` 14 UE, `DietaryTag` 4, `PrintDepartment` 3, `ArticleAvailability` 3, `Channel` 4)
- Migration `20260520000939_add_menu_models_f1_schema`: 7 CREATE TABLE + 5 CREATE TYPE + 16 indici + 11 FK + 7 RLS policy `<table>_tenant_isolation` (pattern reference `20260513003613`, USING-only)
- Backend NestJS: 4 module (`menus`, `menu-categories`, `articles`, `price-lists`) → 5 endpoint group REST. Permission via permessi seed esistenti (`menu.categoria.gestisci`, `menu.piatto.crea/modifica`, `menu.prezzo.modifica`, `menu.visualizza`)
- Seed dimostrativo: menu "Pranzo" + 3 categorie + 5 articoli + PriceList "Base" per tenant `demo` + `acme` (idempotente upsert, count verificati `docker exec psql`)
- E2E Testcontainers: 5 spec / 36 test (32 verdi + 4 `.skip` TD-BS) — CRUD + RBAC permission deny + tenant isolation cross-tenant

**Decisioni** (dettaglio [ADR-0019](docs/architecture/ADR-0019-f1-menu-crud-schema.md)):

- **6 Sub-DP design**: listini → tabella (non JSON); allergeni/tag → enum array (non M:N); reparto stampa → enum; Recipe+PricingRule → skeleton minimal PRE; varianti → deferred S18+
- **6 refinement** (R1 price-only ArticlePrice / R2 PriceList.priority / R4 enum Channel / R5 PricingRule placeholder / R6 photoUrl lean)
- **6 Sub-DP architetturali inline STOP 1.4**: soft-delete cascade KISS (solo target); POST prices upsert; VAT `@IsIn([4,10,22])`; array enum default `[]` vs channels required; cambio categoria via PATCH con conflict check destinazione; re-export tipi Prisma da `@gestionale/db`

**Discovery candidate #52** — tsconfig `declaration:true` + return type Prisma (`Decimal`, enum array) → `TS2742` "inferred type non nameable" da leaf consumer. Fix: `declaration:false` su `apps/*` leaf (NON `packages/*` che emettono types). Generalizzabile a ogni leaf consumer `apps/*` che ritorna tipi Prisma opachi.

**Tech debt:**

- 🆕 **TD-BP** — tsconfig `declaration` override leaf consumer `apps/*` (**RESOLVED in-PR** via override `apps/api/tsconfig.json`; convention per futuri leaf)
- 🆕 **TD-BQ** — soft-delete cascade UX behavior (Menu soft-deleted con figli) → definire UX S18 UI
- 🆕 **TD-BR** — backfill `TenantsModule` con `exports: [TenantsService]` per coerenza convention module (low priority)
- 🆕 **TD-BS** — harness E2E SWC non emette `design:paramtypes` runtime → `ValidationPipe` inattiva in E2E. Gap latente pre-esistente (mascherato da `@Inject(Token)` esplicito ovunque; nessun test E2E validation finora). Validation attiva in prod (toolchain `tsc`/`ts-node-dev`). **Priority ALTA, task #1 sessione 18** (pre-UI o hotfix standalone). Include: fix `vitest.config.mts` SWC + registrare `GlobalHttpExceptionFilter` in `test-app.ts`
- 🆕 **TD-BL** — `DietaryTag` customization tenant-side (kosher, halal) → enum→tabella (F2)
- 🆕 **TD-BM** — `PrintDepartment` customization tenant-side KDS → enum→tabella (F2 KDS)
- 🆕 **TD-BN** — Allergeni regionali extra-UE → enum→tabella (low priority)
- 🆕 **TD-BO** — foto upload pipeline + WebP multi-resolution (S18-S20)

**Note informative:**

- Harness E2E SWC `design:paramtypes` gap latente da sempre — emerso solo ora (primo test validation 400 su DTO body in E2E). Verifica empirica: `Reflect.getMetadata` → `undefined` su metodi controller (anche `TenantsController` esistente). App E2E parte comunque perché DI usa `@Inject(Token)` esplicito.
- Skip `migrate:reset` via AI agent (constraint operativo Claude Code, non codice gestionale). Seed eseguito via `db:seed` idempotente (path equivalente — DB pulito post-migration). Reset manuale da shell se necessario.
- `Decimal` + enum array PostgreSQL: prima introduzione nel progetto (Prisma 6.19.3, validate + migration + E2E OK).

**Discoveries cumulative bump 51 → 52** (+1 vs sessione 16): Discovery #52 candidate tsconfig Prisma type opacity leaf consumer.

**Test:**

- E2E Testcontainers backend: **45/49 PASS + 4 skip** ✅ (32 nuovi verdi + 13 esistenti regression; 4 skip validation TD-BS)
- typecheck + lint API/db/web: **PASS** ✅
- Seed idempotenza: count rows stabili su re-run (verifica empirica `docker exec psql`)

**Foundation status post-merge:**

- Foundation security/scaling F1: **100%** (invariato)
- F1 shell UI: 100% (invariato sessione 14)
- **F1 Menu CRUD schema + backend base: 100% ✅** (sessione 17)
- Next: sessione 18 — TD-BS harness fix (pre-requisito) → poi F1 Menu UI scaffold.

### TD-BS scomposto — Sub-1 RESOLVED (validation unit coverage) / Sub-2 deferred — sessione 18 (2026-05-22)

**Branch**: `fix/td-bs-e2e-harness-validation` · **Tipo**: 1 PR test + fix infra (unit test + setup + turbo) · **ADR**: [ADR-0019 §TD-BS sessione 18](docs/architecture/ADR-0019-f1-menu-crud-schema.md)

**Scope:** chiusura parziale TD-BS (aperto sessione 17). Diagnosi approfondita harness E2E + pivot a validation coverage via unit test.

**Tentativo harness fix abbandonato:** opzione A (plugin `unplugin-swc` per-project + `module:es6`) provata, 4 tentativi documentati STOP 1, tutti falliti — interop SWC × vite-node × Prisma dual-package non risolvibile senza scope creep. Pivot a opzione 1 (unit test class-validator).

**Decisioni:**

- **TD-BS scomposto Sub-1 / Sub-2** — Sub-1 (constraint DTO via unit test) chiudibile subito; Sub-2 (integrazione E2E `ValidationPipe→400`) deferred
- **Sub-1 RESOLVED**: 44 unit test class-validator co-located (`apps/api/src/<entity>/dto/*.spec.ts`, 5 file). `plainToInstance` + `validate()` — verificano `@MinLength`/`@MaxLength`, `@IsIn` VAT `[4,10,22]`, `@ArrayMinSize` channels, `@IsEnum`, `@IsUUID`, `@Min`. Non dipendono da `design:paramtypes`
- **Sub-2 DEFERRED priority MEDIA** (era TD-BS ALTA): integrazione E2E `ValidationPipe→controller→400` bloccata dal harness (`design:paramtypes` non emesso). 4 `.skip` E2E restano con ref Sub-2. Integrazione garantita in prod da toolchain `tsc`

**Root cause #1 (scoperto sessione 18) — `dist/` `@gestionale/db` stale:** gli unit test `@IsEnum(Channel)` fallivano anche nel project `unit` (esbuild, non SWC) → enum `undefined`. Causa: `dist/` di `@gestionale/db` mai ri-buildato dopo sessione 17. Causa a monte: `turbo.json` task `test` **senza `dependsOn: ["^build"]`** (a differenza di `test:e2e`/`typecheck`). Spiega anche perché gli E2E S17 passavano (`test:e2e` ha `^build`). **Fix**: `turbo.json` `test` → `^build` + `reflect-metadata` aggiunto a `apps/api/test/setup.ts` (project unit).

**Root cause #2 (TD-BS originale) — harness E2E `design:paramtypes`:** vitest 3.x non eredita i `plugins` root nei `test.projects` → project e2e su esbuild → no `emitDecoratorMetadata`. Resta aperto come Sub-2.

**Discoveries cumulative bump 52 → 53** (+1 vs sessione 17):

- **Discovery #53** — `turbo.json` task `test` senza `dependsOn: ["^build"]` → i workspace package non vengono ri-buildati prima dei test unit → `dist/` stale → import di simboli aggiunti al `src/` dopo l'ultimo build (es. enum re-exportati) falliscono **silenziosamente** (named export `undefined`). Generalizzabile: ogni task turbo che esegue codice dipendente dal `dist/` di un workspace package interno deve dichiarare `dependsOn: ["^build"]`.

**Tech debt:**

- ✅ **TD-BS Sub-1 RESOLVED** — validation constraint coperti da 44 unit test class-validator
- 🔶 **TD-BS Sub-2 DEFERRED** (priority MEDIA, era ALTA) — E2E integration `ValidationPipe→400`, bloccata da harness `design:paramtypes`

**Test:**

- Unit: **91/91 PASS** ✅ (47 pre-esistenti + 44 nuovi validation; `turbo run test` builda `@gestionale/db` prima)
- E2E: invariato **45 pass / 4 skip** (i 4 `.skip` aggiornati con ref TD-BS Sub-2)
- typecheck + lint API: PASS

**File:**

| File | Type |
|---|---|
| `apps/api/src/{menus,menu-categories,articles,price-lists}/dto/*.dto.spec.ts` (5) | new |
| `apps/api/test/setup.ts` | mod (+`reflect-metadata`) |
| `turbo.json` | mod (`test` → `dependsOn: ["^build"]`) |
| `apps/api/test/e2e/*-crud.e2e-spec.ts` (4) | mod (commento skip → Sub-2) |
| `docs/architecture/ADR-0019-f1-menu-crud-schema.md` | mod (§TD-BS sessione 18) |
| `PROGRESS.md` | mod (entry sessione 18) |

**Foundation status post-merge:**

- **F1 Menu CRUD: 100% ✅** (invariato sessione 17) + validation constraint coverage unit (Sub-1)
- TD-BS Sub-2 deferred MEDIA — non più bloccante pre-requisito per F1 Menu UI
- Next: sessione 19 — F1 Menu UI scaffold.

### F1 Menu UI — list + detail CRUD — sessione 19 (2026-05-22)

**Branch**: `feat/s19-f1-menu-ui` · **Tipo**: 1 PR feature UI (11 nuovi file + 5 modificati) · **ADR**: [ADR-0020](docs/architecture/ADR-0020-f1-menu-ui-crud.md)

**Scope:** prima UI feature business. Route `(authenticated)/menu/` estesa da placeholder a list + detail con CRUD Menu / Categorie / Articoli. Consuma gli endpoint backend S17 (ADR-0019). **Nessuna modifica backend / schema / migration.**

**Scope completato:**

- Routing 2-livelli: `menu/page.tsx` (list) + `menu/[menuId]/page.tsx` (detail) — **primo segment dinamico `[id]` del progetto**. Categorie/articoli inline nel detail (no deep-nesting `[catId]`).
- `lib/api.ts` esteso: `apiPatch` + `apiDelete`, refactor a `request()` privato (firme `apiGet`/`apiPost` invariate → caller esistenti non toccati).
- `lib/menu-api.ts` data access client (12 funzioni) + `lib/menu-types.ts` domain types. NO react-query / SWR / Server Actions — stato React locale + refetch on mutation.
- Form CRUD: RHF + zodResolver + `components/ui/form.tsx` (pattern `login/page.tsx`). 2 nuovi primitive UI: `ui/dialog.tsx`, `ui/textarea.tsx`.
- Soft-delete con dialog di conferma (`ConfirmDialog`); nessun cestino/ripristino UI (TD-BQ).
- Permission gating bottoni (branch A5): `menu.categoria.gestisci` / `menu.piatto.crea` / `menu.piatto.modifica` da `useAuth().permissions`.
- i18n: namespace `menu` aggiunto a `it.json` + `en.json`.

**FASE 0 — verifica empirica A1–A5 (READ-ONLY, bloccante):** A1 (Article 1:N MenuCategory) ✅, A2 (update via `PATCH`) ✅, A3 (`Article.photoUrl` esiste → input URL) ✅, A4 (soft-delete: GET list filtra per `deletedAt` del modello via `softDeleteExtension`, detail di menu cancellato 404 → non devia) ✅, A5 (`useAuth()` espone `permissions`) ✅. Nessuna deviazione bloccante.

**Decisioni** (dettaglio [ADR-0020](docs/architecture/ADR-0020-f1-menu-ui-crud.md)):

- **§prezzo — solo `Article.basePrice`**: la UI S19 NON gestisce `ArticlePrice` / `/articles/:id/prices` (deviazione consapevole dalla lettera spec, scelta delegata dall'owner). Razionale: `basePrice` è già il prezzo obbligatorio dell'articolo; usare `article-prices` richiederebbe 2 chiamate non-atomiche sul create + lookup magic-string del listino "Base"; `ArticlePrice` è il meccanismo dei listini → UI dedicata in S20.
- **No data-layer**: client fetch + refetch on mutation a grana grossa (no react-query — confine S19).
- **Form numerici come stringa + regex**: `z.coerce.number()` rompe l'inferenza `zodResolver`/`useForm<z.infer>` → campi numerici stringa, convertiti con `Number()` al submit.
- **Select enum `<select>` nativo**: confine "nessuna nuova dipendenza" (`@radix-ui/react-select` non installato).
- **Foto (branch A3)**: solo input URL nel form; display immagine differito (TD-BO).
- **Campi articolo S19** = sottoinsieme "CRUD base" del DTO; `allergens`/`dietaryTags`/`channelVisibility` differiti (TD-BT).

**Discovery #54** — root `eslint .` (`pnpm -w lint`) non carica il plugin `@next/next` → una direttiva `eslint-disable` per una regola `@next/next/*` è essa stessa un errore («Definition for rule not found»). Conseguenza: codice in `apps/web` non può sopprimere regole Next via comment se viene lintato anche dal root. Generalizzabile: le soppressioni rule-specific funzionano solo sotto il linter che definisce la regola.

**Tech debt:**

- 🆕 **TD-BT** — campi enum-array articolo (`allergens` / `dietaryTags` / `channelVisibility`) non gestiti dal form S19 (richiedono widget multi-select). Allergeni rilevanti Reg. UE 1169/2011 — da gestire prima dell'esposizione menu al cliente finale.
- 🆕 **TD-BU** — `Sidebar` active-state con match esatto `pathname === href` non evidenzia le sub-route detail (`menu/[menuId]`). Limitazione pre-esistente esposta dal primo segment dinamico. Fix: match per prefisso.
- 🆕 **TD-BX** — copertura E2E del CRUD/delete Menu UI assente: validato solo da verifica manuale runtime, nessuno spec Playwright committato lo esercita in CI. **Confine:** fino a TD-BX una regressione su delete/CRUD Menu UI non è intercettata in CI — solo la verifica manuale la rileva. Fix: spec Playwright su list + detail + CRUD + soft-delete.

**Discoveries cumulative bump 53 → 54** (+1 vs sessione 18): Discovery #54 ESLint rule-suppression scope per linter.

**Test (GATE vs baseline):**

- Unit: **91/91 PASS** ✅ (invariato — modifiche solo `apps/web`, suite backend non impattata)
- typecheck workspace: **PASS** ✅ · lint workspace (`eslint .`) + `next lint`: **PASS** ✅
- `next build` web: **OK** ✅ (13 route, incl. `/t/[slug]/menu` + `/t/[slug]/menu/[menuId]`)
- Playwright: **non rieseguito** — nessuno spec esercita `/menu` (verifica empirica FASE 0 in `apps/web/e2e/specs/`); i 4 `.skip` E2E backend (TD-BS Sub-2) invariati.

**File:**

| File | Type |
|---|---|
| `apps/web/src/lib/{menu-types,menu-api}.ts` (2) | new |
| `apps/web/src/components/ui/{dialog,textarea}.tsx` (2) | new |
| `apps/web/src/components/menu/{ConfirmDialog,MenuForm,CategoryForm,ArticleForm,CategorySection}.tsx` (5) | new |
| `apps/web/src/app/t/[slug]/(authenticated)/menu/[menuId]/page.tsx` | new |
| `docs/architecture/ADR-0020-f1-menu-ui-crud.md` | new |
| `apps/web/src/lib/api.ts` | mod (+`apiPatch`/`apiDelete`, refactor `request()`) |
| `apps/web/src/lib/error-codes.ts` | mod (+`messageForError`) |
| `apps/web/src/app/t/[slug]/(authenticated)/menu/page.tsx` | mod (placeholder → list) |
| `apps/web/src/i18n/messages/{it,en}.json` (2) | mod (+namespace `menu`) |
| `PROGRESS.md` | mod (entry sessione 19) |

**Foundation status post-merge:**

- **F1 Menu UI (list + detail CRUD base): 100% ✅** (sessione 19)
- F1 Menu CRUD schema + backend: 100% (invariato sessione 17/18)
- Carving residuo S20+: listini multipli UI + `ArticlePrice`, foto upload pipeline (TD-BO), varianti/modificatori, campi enum-array articolo (TD-BT)
- Next: sessione 20 — candidate F1 Menu (listini multipli UI / varianti) o TD-BS Sub-2.

### Fix soft-delete RLS tx-escape — sessione 19 (2026-05-22)

**Branch**: `fix/soft-delete-rls-tx-escape` · **Tipo**: 1 PR bugfix backend data-layer · **ADR**: [ADR-0021](docs/architecture/ADR-0021-soft-delete-rls-tx-escape-fix.md)

**Scope:** bug del data-layer emerso dalla verifica runtime di S19 (ADR-0020). Il soft-delete via `tx.<model>.delete()` dentro `withTenantContextAtomicTx` falliva con **HTTP 500 (Prisma P2025)** in dev/prod — colpiva ogni modello con `deletedAt` (i 4 DELETE F1 Menu: Menu, MenuCategory, Article, PriceList). Task separato dal frontend S19 (S19 parcheggiato come checkpoint sul suo branch).

**Root cause:** l'interceptor `delete` di `softDeleteExtension` riscrive `delete`→`update` usando il `client` catturato (non-transazionale). Dentro un atomic tx, l'`update` escapa la transazione → gira senza `SET LOCAL app.tenant_id` → la RLS policy lo blocca → P2025. Invisibile alla suite E2E perché i Testcontainers connettono come `postgres` superuser (bypassa RLS). S19 è stato il primo codice a esercitare gli endpoint DELETE a runtime contro il ruolo reale `gestionale_app` (non-superuser, RLS `FORCE`).

**Fix:** i 4 service `softDelete` usano `tx.<model>.update({ data: { deletedAt: new Date() } })` esplicito (gira sul `tx` → RLS context attivo). Pattern già usato e funzionante in `.update()`. L'interceptor `delete`/`deleteMany` di `soft-delete.ts` resta (valido per `delete()` non-transazionali) ma è annotato come trap.

**Test di regressione (obbligatorio):** nuovo spec `apps/api/test/e2e/soft-delete-rls.e2e-spec.ts` — primo del progetto che boota l'app come ruolo **`gestionale_app` non-superuser** (RLS enforced). Verificato: **rosso 3/3 (500) sul codice pre-fix**, verde 3/3 (200) post-fix. La suite E2E esistente NON è toccata (resta superuser → TD-BV).

**Convention (ADR-0021 §convention):** dentro un atomic tx tenant-scoped, soft-delete SEMPRE via `tx.<model>.update({ deletedAt })` esplicito — MAI `tx.<model>.delete()`. Documentata in ADR + inline negli interceptor di `soft-delete.ts` e nei commenti dei service.

**Discovery #55** — un Prisma query-extension che riscrive un'operazione chiamando un delegate sul `client` catturato alla definizione esce dalla transazione del chiamante (e dal suo context RLS/GUC). Generalizzabile: i rewrite di operazione dentro le extension devono usare un client transaction-aware, altrimenti rompono atomicità e RLS dentro `$transaction`. (#54 riservato da S19/ADR-0020.)

**Tech debt:**

- 🆕 **TD-BV** — la suite E2E gira come `postgres` superuser → blind spot strutturale: non intercetta alcun bug di interazione con la RLS (questo soft-delete ne è la prova). Valutare conversione suite/subset al ruolo `gestionale_app`.
- 🆕 **TD-BW** — refactor tx-safe dell'interceptor soft-delete (rewrite dentro `rlsExtension.$allOperations` o model-extension `softDelete()`), così `tx.<model>.delete()` torna sicuro e la §convention diventa superflua.

**Test (GATE):**

- E2E Testcontainers: **48 pass / 4 skip** ✅ (45 pre-esistenti invariati + 3 nuovi `soft-delete-rls`; 4 skip TD-BS Sub-2 invariati)
- Unit: **91/91 PASS** ✅ · typecheck + lint workspace: **PASS** ✅

**File:**

| File | Type |
|---|---|
| `apps/api/src/{menus,menu-categories,articles,price-lists}/*.service.ts` (4) | mod (`softDelete`: delete → update deletedAt) |
| `packages/db/src/soft-delete.ts` | mod (annotazione trap, no change funzionale) |
| `apps/api/test/e2e/soft-delete-rls.e2e-spec.ts` | new (regressione non-superuser) |
| `docs/architecture/ADR-0021-soft-delete-rls-tx-escape-fix.md` | new |
| `PROGRESS.md` | mod (entry sessione 19 fix) |

**Foundation status post-merge:**

- **Soft-delete RLS-aware: 100% ✅** — funzionante per tutti i modelli con `deletedAt` sotto ruolo non-superuser
- Sblocca il merge di S19 (F1 Menu UI): post-merge di questo fix, rebase S19 + ri-verifica delete end-to-end
- Next: rebase `feat/s19-f1-menu-ui` su main aggiornato → ri-verifica → PR S19.

### F1 Listini UI — PriceList CRUD + ArticlePrice override — sessione 20 (2026-05-22)

**Branch**: `feat/s20-listini-ui` · **Tipo**: 1 PR feature UI (4 nuovi file + 9 modificati) · **ADR**: [ADR-0022](docs/architecture/ADR-0022-f1-listini-ui.md)

**Scope:** completa il Menu domain UI con la gestione listini (carving F1 Menu UI iniziato con S19). Nuova route tenant-level `(authenticated)/menu/listini` (CRUD `PriceList`) + sezione "Prezzi per listino" on-demand nel detail menu (override `ArticlePrice` per articolo). Consuma gli endpoint backend S17 (ADR-0019). **Nessuna modifica backend / schema / migration.**

**STOP 0 — verifica empirica schema prezzi (READ-ONLY):** riconciliata la semantica `Article.basePrice` ↔ `ArticlePrice`/`PriceList`. `basePrice` `Decimal(10,2)` required; `ArticlePrice` join puro no-soft-delete `@@unique([articleId,priceListId])`; `PriceList` segmentata per `channels Channel[]` (no enum "tipo listino"); a runtime i due sono disaccoppiati (nessun lega backend).

**Scope completato:**

- **Modello prezzo Opzione 1** (confermato owner): `Article.basePrice` = default/fallback, `ArticlePrice.price` = override puntuale per (articolo × listino). **Resolution `override ?? basePrice` SOLO lato UI display (Opzione 1a)** — backend invariato (→ TD-BY).
- **Anti-drift**: assenza override = "usa basePrice"; la UI non crea mai override ridondanti. Rimuovere un override → la riga torna a `basePrice`.
- Route `menu/listini/page.tsx` tenant-level: segment statico `listini` vince sul dinamico fratello `[menuId]`. Entry-point = link "Listini" nell'header lista menu (no slot Sidebar — vedi TD-BU carry-over).
- `ArticlePricesSection` componente separato, toggled per-articolo da `CategorySection` (NON dentro `ArticleForm`: nested RHF `<form>` + impossibile su articolo non creato). Lazy fetch override del singolo articolo (no N+1 eager).
- `lib/menu-api.ts` +9 funzioni; `lib/menu-types.ts` +`PriceList`/`ArticlePrice`/`Channel` + input types.
- Multi-select `channels` = checkbox native (confine "no nuova dipendenza", come `<select>` S19).
- i18n: namespace `menu` esteso (`listini`/`prices`/`channels`) it + en.

**Task 1 — verifica empirica frontend (Pattern 36):** 3 assunti core confermati; 4 divergenze tutte Accept dall'owner — D1 (errorCode prezzo già presenti da S17 → Task 5 verify-only), D2 (path i18n `i18n/messages/`), D3 (entry-point link, no Sidebar), D4 (`ArticlePricesSection` separato).

**§parseError — scope-adjacent fix (Pattern 25):** il GATE runtime ha scoperto che `GlobalHttpExceptionFilter` avvolge gli errori di validazione DTO in `errorCode: 'E_VALIDATION'` con il codice specifico in `message: string[]`; `parseError` leggeva solo `errorCode` → ogni 400 di validazione cadeva sul messaggio generico **app-wide** (mascherato finora dalla zod client). Fix in `lib/api.ts`: srotola `E_VALIDATION` → `message[0]` (difensivo: solo se taxonomy code). 3 condizioni anti-regressione (Pattern 38) verificate **prima** del fix: shape reale empirica (5 path, sempre array di errorCode), nessun consumer `E_VALIDATION`, micro-gate non-regressione (`E_MENU_NAME_EXISTS` S19 resta specifico).

**Discovery #56** — un pre-check di unicità via `findFirst` (che la `softDeleteExtension` filtra escludendo i soft-deleted) combinato con un `@@unique` DB che **include** i soft-deleted → ricreare un'entità col nome di una soft-deleted dà `P2002` non gestito → HTTP 500. Generalizzabile: ogni modello con `@@unique([tenantId,name…])` + pre-check `findFirst` ha lo stesso buco latente (PriceList, Menu, MenuCategory, Article). → TD-BZ.

**Tech debt:**

- 🆕 **TD-BY** — *pricing resolution backend* (`override ?? basePrice` per canale, server-side). **Confine:** finché non implementato, nessun consumer backend (Cassa/Comande S23+) conosce il prezzo applicato — solo la UI display lo calcola. Severità MEDIA, additivo, ~2-3h. (Pre-allocato STOP 1.)
- 🆕 **TD-BZ** — *soft-delete vs `@@unique([tenantId,name])`*: ricreare un'entità col nome di una soft-deleted → `P2002` → HTTP 500 generico. Dominio: `PriceList` + `Menu`/`MenuCategory`/`Article` (stesso pattern). **Confine:** finché non risolto, ogni "ricrea con nome cancellato" → 500 generico in UI. Backend, pre-esistente S17, fuori scope S20. Severità MEDIA, ~1-2h. → **RESOLVED S21** (ADR-0023).

**Discoveries cumulative bump 55 → 56** (+1 vs sessione 19): Discovery #56 soft-delete pre-check vs unique constraint.

**Test (GATE runtime — Pattern 40, stack reale, API ruolo `gestionale_app` non-superuser):**

- Smoke contratto API (utente reale, JWT): **22/22 PASS** ✅ — CRUD `PriceList`, override set/update/delete, resolution, errorCode validazione, soft-delete.
- Driver UI Playwright headless chromium (ad-hoc, non committato): **23/23 PASS** ✅ — 7 item GATE (CRUD listino + `ConfirmDialog`, override, resolution display, rimozione override, errorCode i18n, deep-link, light/dark) + micro-gate non-regressione.
- typecheck workspace + lint (`eslint .` + `next lint`) + `next build`: **clean** ✅ (route `/t/[slug]/menu/listini` generata).
- Unit/E2E backend: **non impattati** — modifiche solo `apps/web`.

**File:**

| File | Type |
|---|---|
| `apps/web/src/components/menu/{PriceListForm,ArticlePricesSection}.tsx` (2) | new |
| `apps/web/src/app/t/[slug]/(authenticated)/menu/listini/page.tsx` | new |
| `docs/architecture/ADR-0022-f1-listini-ui.md` | new |
| `apps/web/src/lib/{menu-types,menu-api}.ts` (2) | mod (+`PriceList`/`ArticlePrice` types + 9 funzioni) |
| `apps/web/src/lib/api.ts` | mod (§parseError — unwrap `E_VALIDATION`) |
| `apps/web/src/lib/error-codes.ts` | mod (+mapping `E_VALIDATION`) |
| `apps/web/src/components/menu/CategorySection.tsx` | mod (+toggle `ArticlePricesSection`) |
| `apps/web/src/app/t/[slug]/(authenticated)/menu/{page,[menuId]/page}.tsx` (2) | mod (link Listini / fetch `PriceList`) |
| `apps/web/src/i18n/messages/{it,en}.json` (2) | mod (+`listini`/`prices`/`channels`) |
| `PROGRESS.md` | mod (entry sessione 20) |

**Foundation status post-merge:**

- **F1 Menu domain UI: 100% ✅** — list + detail CRUD (S19) + listini + override prezzi (S20)
- Carving residuo F1 Menu: foto upload pipeline (TD-BO), varianti/modificatori, campi enum-array articolo (TD-BT)
- Next: sessione 21 — candidate F1 (varianti/modificatori, foto upload TD-BO) o pulizia TD backend (TD-BY pricing resolution, TD-BZ soft-delete unique, TD-BS Sub-2).

### Fix TD-BZ — unicità nome soft-delete-aware — sessione 21 (2026-05-22)

**Branch**: `fix/td-bz-partial-unique-soft-delete` · **Tipo**: 1 PR bugfix backend (DB-layer) · **ADR**: [ADR-0023](docs/architecture/ADR-0023-td-bz-partial-unique-soft-delete.md)

**Scope:** chiude **TD-BZ** (scoperto dal GATE runtime S20, ADR-0022 §Finding). Gli unique index **full** `@@unique([tenantId, name…])` sui 5 modelli soft-delete-aware (Menu/MenuCategory/Article/PriceList + Role) includevano le righe soft-deleted, mentre il pre-check applicativo (`findFirst`, filtrato dalla `softDeleteExtension`) le esclude → ricreare un'entità col nome di una soft-deleted → `P2002` non gestito → HTTP 500. Solo backend (`packages/db` + `apps/api/test`), nessun cambio API.

**STOP 0 — verifica empirica (READ-ONLY):** i 4 modelli hanno tutti `deletedAt` + `@@unique` con `name`; pre-check `findFirst` **duplicato** in ogni service (8 punti, nessun helper, nessun catch `P2002`); Prisma 6.19.3 non supporta partial index nel DSL; **precedente `UserRole`** già usa partial unique index raw (`user_roles_*_unique`, `WHERE sede_id IS [NOT] NULL`) senza `@@unique` nello schema.

**Decisione (Opzione 1, owner):** sostituire gli unique full con **partial unique index `WHERE deleted_at IS NULL`** — la regola DB si allinea al pre-check soft-delete-aware. Effetto: riuso del nome di una soft-deleted **legale**; duplicato tra entità **attive** ancora bloccato. Replica il pattern `UserRole`.

**Scope completato:**

- Schema: rimossi i 5 `@@unique` (+ commento §convention sui modelli).
- 2 migration: `td_bz_partial_unique_soft_delete` (4 modelli Menu) + `td_bz_partial_unique_role` (Role) — `DROP INDEX` full + `CREATE UNIQUE INDEX … WHERE deleted_at IS NULL`.
- **§seed** — conseguenza necessaria: rimuovere `@@unique` rimuove le `WhereUniqueInput` compound generate da Prisma → i 5 `upsert` idempotenti di `prisma/seed.ts` non compilavano più. **Scoperto dal GATE Pattern 38** (typecheck → STOP intermedio con evidenza). Fix: `upsert` → find-then-create/update sulla chiave naturale (idempotenza verificata: 2 run → ID stabili). `ArticlePrice` non impattato.
- 8 nuovi test E2E non-superuser in `soft-delete-rls.e2e-spec.ts` (4 modelli Menu × {riuso soft-deleted → 201, duplicato attivo → 409 `E_*_NAME_EXISTS`}). Role: nessun test — no endpoint (vedi §Role).

**Convention (ADR-0023 §convention):** unicità di un campo naturale su un modello con `deletedAt` = partial unique index `WHERE deleted_at IS NULL` in migration raw, **non** `@@unique` nello schema (Prisma 6 non supporta i partial index dichiarativi).

**§Role + 3ª superficie (S21-bis — scoperto al check pre-merge):** `Role` (RBAC) ha anch'esso `deletedAt` + `@@unique([tenantId,name])` → stesso bug TD-BZ, esteso **nello stesso atomo** (migration incrementale `td_bz_partial_unique_role`). Role non ha endpoint → fix strutturale (schema+migration+seed), nessun test E2E nuovo. L'estensione ha scoperto la **3ª superficie** impattata da un `@@unique` rimosso: l'helper E2E `menu-test-fixtures.ts` inseriva un ruolo via raw SQL `ON CONFLICT (tenant_id, name)` → rotto dal partial index (**43 fallimenti E2E a cascata**, setup di 6 spec). Fix: `ON CONFLICT … WHERE deleted_at IS NULL`. ADR-0023 §convention documenta le **3 superfici** (WhereUniqueInput compound, upsert idempotenti, ON CONFLICT raw — le prime 2 a compile-time, la 3ª a runtime).

**TD-BY → defer a S23** (deciso in S21): la pricing resolution è un motore multi-match non triviale (channel-containment + finestra date + tie-break `priority`) e ha **zero consumer** → i requisiti li definirà il primo consumer (Cassa S23+). Razionale empirico in STOP 0.

**Tech debt:**

- 🆕 **TD-CA** — *catch `P2002` → `E_*_NAME_EXISTS` per race TOCTOU*: il pre-check `findFirst` + `create` non è atomico; due create concorrenti dello stesso nome attivo → uno restituisce 500 invece di 4xx pulito. **Confine:** finché non gestito, la race su nomi attivi concorrenti dà 500. Pre-esistente, ortogonale a TD-BZ, raro (dev single-user). Severità BASSA, ~30min. → **RESOLVED S21 (coda)** (ADR-0024, helper `catchUniqueViolation`).

**Discoveries cumulative: 56 invariato** — il fix non produce nuova Discovery (#56 ha già catturato il bug in S20). Solo una convention note in ADR-0023.

**Test (GATE Pattern 38 — baseline → fix → full-suite):**

- Baseline pre-fix: E2E **48 pass / 4 skip**.
- Post-fix: E2E **56 pass / 4 skip** ✅ (48 baseline invariati + 8 nuovi TD-BZ) · Unit **91/91** ✅ · typecheck workspace **clean** ✅.
- **5** partial index verificati **fisicamente in DB** (`pg_indexes`, `WHERE deleted_at IS NULL`) ✅ · `migrate status` clean (9 migration) · seed idempotente.
- Comportamento verificato sotto ruolo `gestionale_app` **non-superuser** (RLS reale).

**File:**

| File | Type |
|---|---|
| `packages/db/prisma/migrations/20260522111054_td_bz_partial_unique_soft_delete/` | new (4 DROP + 4 partial unique index, dominio Menu) |
| `packages/db/prisma/migrations/20260522114603_td_bz_partial_unique_role/` | new (DROP + partial unique index, Role) |
| `docs/architecture/ADR-0023-td-bz-partial-unique-soft-delete.md` | new |
| `packages/db/prisma/schema.prisma` | mod (rimossi 5 `@@unique` + commento §convention) |
| `packages/db/prisma/seed.ts` | mod (5 `upsert` → find-then-create/update) |
| `apps/api/test/e2e/soft-delete-rls.e2e-spec.ts` | mod (+8 test regressione TD-BZ) |
| `apps/api/test/e2e/helpers/menu-test-fixtures.ts` | mod (`ON CONFLICT` allineato al partial index) |
| `PROGRESS.md` | mod (entry sessione 21) |

**Foundation status post-merge:**

- **TD-BZ: RESOLVED ✅** — unicità nome soft-delete-aware su tutti e **5** i modelli soft-delete-aware (4 dominio Menu + Role).
- TD aperti: TD-BY (defer S23), TD-CA (nuovo, BASSA — risolto subito dopo, vedi sotto), TD-BV/TD-BW (S19), TD-BS Sub-2.
- Next: sessione 22 — candidate F1 (varianti/modificatori, foto upload TD-BO) o TD backend residui.

### Fix TD-CA — catch P2002 (race TOCTOU unicità nome) — sessione 21 coda (2026-05-22)

**Branch**: `fix/td-ca-catch-unique-violation` · **Tipo**: 1 PR bugfix backend (piccola) · **ADR**: [ADR-0024](docs/architecture/ADR-0024-td-ca-catch-unique-violation.md)

**Scope:** chiude **TD-CA** (catturato in ADR-0023). Il pre-check `findFirst` + `create`/`update` non è atomico → race TOCTOU → `P2002` non gestito (non è un `HttpException` → sfugge al `GlobalHttpExceptionFilter`) → HTTP 500 invece di 409. Solo `apps/api`, nessun cambio schema/migration/frontend, nessun nuovo errorCode.

**Fix:** helper `catchUniqueViolation(fn, errorCode)` (`apps/api/src/common/prisma-errors.ts`) che wrappa i `create`/`update` e converte `P2002` → `ConflictException({errorCode})`. Applicato **per-call-site** agli **8** punti name-CRUD (4 service × create/update) coi rispettivi `E_*_NAME_EXISTS` già esistenti — NON nel filter (mis-map sui 7 constraint NON-name + `@Catch(HttpException)` non cattura i Prisma error). Garanzia: ogni modello name-unique ha 1 solo unique index → `P2002` da quel call-site è inequivocabile. Il pre-check `findFirst` resta invariato (gestisce il 99% dei casi); l'helper è la rete per la sola race.

**Test:** 4 unit test dell'helper (P2002 → 409+errorCode · errore generico → ri-lanciato · P2025 → ri-lanciato non convertito · happy path). **No-over-claim:** la race TOCTOU non è riproducibile in E2E in modo deterministico → coperta dall'unit test dell'helper, non da un test runtime della race reale.

**GATE:** unit **95/95** (91 baseline + 4 helper) ✅ · E2E **56/4 invariato** ✅ (pre-check non cambia → nessun nuovo comportamento E2E) · typecheck clean ✅.

**TD-CA → RESOLVED.** Nessun nuovo TD. **Discoveries: 56 invariato** (è un fix, non una scoperta).

**File:** `apps/api/src/common/prisma-errors.ts` + `.spec.ts` (new) · 4 service `apps/api/src/{menus,menu-categories,articles,price-lists}` (8 call-site wrappati) · ADR-0024 (new) · PROGRESS.

**Foundation post-merge:** TD-CA RESOLVED. TD aperti residui: TD-BY (defer S23), TD-BV/TD-BW (S19), TD-BS Sub-2. Next: sessione 22.

### [2026-06-08] STOP-c2 — UI `aziende` in `accountant-web` + seed demo (ADR-0032)

**Branch**: `feat/aziende-ui` · **Tipo**: 1 PR feature FE (4 new + 5 mod, no schema/migration/backend) · **ADR**: [ADR-0032](docs/architecture/ADR-0032-aziende-ui.md)

Prima UI di dominio del 2° verticale (commercialisti): anagrafica clienti `aziende` in `accountant-web`, consuma il CRUD `/api/v1/aziende` (accountant-api :3002, ADR-0031). Parte da STOP 0 sull'anatomia FE reale di `restaurant-web` (pagina lista menu + `ArticleForm` + `ConfirmDialog` + `menu-api`/`menu-types` + superficie `@gestionale/api-client`/`auth-web`) e sul contratto backend reale (`aziende.controller`/`.service` + 2 DTO + `model Azienda`/`enum TipoCliente`).

**Decisioni** (dettaglio [ADR-0032](docs/architecture/ADR-0032-aziende-ui.md)):

- **DP-nav** — route/label/cartella `clienti` **invariate**; `clienti/page.tsx` placeholder → anagrafica reale. Label utente "Clienti" disaccoppiata dall'entità tecnica `Azienda`. Churn zero (no rename Sidebar union/cartella/i18n nav).
- **DP-form** — form 15 campi MVP **inline in Card** (pattern `MenuForm`/`ArticleForm`), no segmento `[id]` (evita active-state TD-BU). `ConfirmDialog` solo per soft-delete.
- **Lista** = `<table>` tailwind (no `Table` nel barrel `@gestionale/ui`). Colonna **Stato** = flag `attivo`; soft-delete rimuove dalla lista (backend filtra `deletedAt IS NULL`), nessun cestino UI.
- **Email opzionale** — zod `.refine(v => v === '' || EMAIL_RE.test(v))`, tipo string in/out (no preprocess). Opzionali stringa `'' → undefined` al submit.
- **`messageForError(err)`** aggiunto a `error-codes.ts` (le pagine dominio risolvono l'errore catturato, non il code); `accountant-web` aveva solo `messageForErrorCode`.
- **§confine error-codes** — mappati solo `E_AZIENDA_NOT_FOUND` + `E_AZIENDA_CODICE_EXISTS` (runtime); i backstop di validazione sono prevenuti dalla zod client-side → fallback generico accettato.
- **`placeholder.clienti`** rimosso (dead-code, it+en) — convention "i18n keys solo quando usate" (ADR-0018 §TD-BF).
- **Seed** — `seedDevAziende(studio-demo)`: 5 aziende demo (3 `azienda`, una `attivo=false`; 2 `persona_fisica`), idempotente find-then-create su `tenantId+codice`, PII-free.

**Doc note**: ADR-0030 indicava `dialog.tsx`/`textarea.tsx` come file locali di `restaurant-web` e citava la rimozione di `messageForError`; allo stato attuale Dialog/Textarea sono in `@gestionale/ui` e il consumer FE è `messageForErrorCode`. Annotato in ADR-0032, non corretto retroattivamente (anchor stability).

**Gate:**

- typecheck **16/16** ✅ · lint + `next lint` (accountant-web) + format:check clean ✅
- `next build` accountant-web OK (`/t/[slug]/clienti` pagina reale, ~3.66 kB) ✅
- `db:seed` ×2 idempotente (run2 0 created) ✅
- Conteggio DB `studio-demo`: 5 aziende attive + 1 `AZ001` soft-deleted residua dallo smoke STOP-c1 (non compare in lista, atteso) ✅
- Smoke browser (Nicolò): login `studio-demo` → lista 5 righe (`AZ003` "Non attivo") + CRUD + dup codice 409 — **da verificare pre-merge**

**Tech debt:** nessuno nuovo. `health`/`me` restano app-level (invariato).

**File:** `apps/accountant-web` (`lib/aziende-{types,api}.ts` + `components/aziende/{ConfirmDialog,AziendaForm}.tsx` new; `lib/error-codes.ts` + `app/.../clienti/page.tsx` + `i18n/messages/{it,en}.json` mod) · `packages/db/prisma/seed.ts` mod · `docs/architecture/ADR-0032-aziende-ui.md` new · `PROGRESS.md`.

**Foundation status post-merge:**

- 2° verticale: skeleton (ADR-0029/0030) + slice backend `aziende` (ADR-0031) + **UI `aziende` (lista + form + seed demo)** (ADR-0032) ✅
- Next: **STOP-c3** (eventuale) — entità satellite di `aziende` (referenti, log modifiche) o riaggancio RFM/arricchimento; in alternativa slot nav `fatture` o pulizia TD backend.

### [2026-06-09] STOP-c3a — backend `referenti` (satellite di `aziende`, ADR-0033)

**Branch**: `feat/referenti-backend` · **Tipo**: 1 PR feature (schema + migration + backend + e2e) · **ADR**: [ADR-0033](docs/architecture/ADR-0033-referenti-backend.md)

Primo satellite di dominio del 2° verticale: `referenti` 1:N sotto `aziende` (origine StudioDesk `aziende_referenti`, DDL `01_studio_template.sql:1309` ≡ `52_pannello_azienda.sql:76` byte-identici). Modulo nested `/api/v1/aziende/:aziendaId/referenti` in `accountant-api`. STOP 0 su DDL + pattern `menu-categories`/`aziende.service`. Split STOP-c3: **c3a backend** (questo) → **c3b UI** (detail `clienti/[id]` + sezione referenti).

**Decisioni** (dettaglio [ADR-0033](docs/architecture/ADR-0033-referenti-backend.md)):

- Modello `Referente`: 6 campi dominio (nome 150, `ruolo` enum, email/telefono/note opt, attivo) + std (id, tenantId, aziendaId, soft-delete, timestamps). FK azienda+tenant **Cascade**, 2 index. Relazioni inverse su `Tenant`+`Azienda`.
- **DP-ruolo** = enum `RuoloReferente` (`legale_rappresentante`/`amministrativo`/`tecnico`/`altro`, default `altro`), replica DDL.
- **Pattern LEAN** ereditato da `aziende.service` (NON `menu-categories`): single-op `this.db.prisma`, no atomic tx, no audit, no `catchUniqueViolation` (referenti non ha unicità naturale → no partial-unique). Parent-check `assertAziendaExists` (404 + isolamento). Divergenza consapevole: introdurre audit nel verticale accountant è uno STOP a sé.
- **Permessi riusati** `anagrafica.cliente.{visualizza,crea,modifica,elimina}` (referente = attributo del cliente) → catalogo invariato.
- **`user_id` deferito** (circolarità RFM→users, ADR-0031); **log modifiche scartato** (`aziende_modifiche_log` "decisione aperta"; c'è già audit_logs core).
- Migration `add_referenti`: forma `add_aziende` (RLS `referenti_tenant_isolation` USING-only + FORCE, FK cascade), **no partial-unique**.

**Gate:**

- typecheck **16/16** ✅ · lint · format clean ✅
- migration + verifica DB: policy `referenti_tenant_isolation`, RLS enabled+forced, 3 index (pkey+tenant+azienda), 2 FK cascade ✅
- e2e **22/22** ✅ (11 `referenti-crud` new — CRUD, parent-404, self-404, scoping nested, isolamento cross-tenant, RBAC-403 + 11 `aziende-crud` regression). Solo locale (TD-CB).

**Tech debt:** nessuno nuovo a sé. **TD-RLS-aziende esteso a referenti** — policy DB-level presente ma non esercitata da e2e (superuser, TD-BV) né da `smoke:rls-core` (solo core); isolamento verificato applicativamente (scenario 10). Stessa voce di `aziende` (accorpabile → `TD-RLS-anagrafica`).

**File:** `packages/db` (schema +enum/+model `Referente`/+2 relazioni inverse, barrel +re-export, migration `add_referenti`) · `apps/accountant-api` (modulo `src/referenti/` + registrazione `app.module` + e2e `referenti-crud` + fixtures) · `docs/architecture/ADR-0033-referenti-backend.md` + `PROGRESS.md`.

**Foundation status post-merge:**

- 2° verticale: skeleton (ADR-0029/0030) + `aziende` backend+UI (ADR-0031/0032) + **`referenti` backend** (ADR-0033) ✅
- Next: **STOP-c3b** — UI referenti: detail page `clienti/[id]` (header azienda read-only + sezione referenti CRUD inline con `ReferenteForm`) + entry-point dalla lista clienti + active-state Sidebar sub-route. Primo segmento dinamico del verticale accountant.

### [2026-06-09] STOP-c3b — UI `referenti`: detail `clienti/[id]` + sezione referenti (ADR-0034)

**Branch**: `feat/referenti-ui` · **Tipo**: 1 PR feature FE · **ADR**: [ADR-0034](docs/architecture/ADR-0034-referenti-ui.md)

UI del satellite referenti (consuma il CRUD nested di ADR-0033). Introduce il **primo segmento dinamico del verticale accountant** (`clienti/[id]`) — il salto rimandato a STOP-c2. STOP 0 su anatomia FE reale (`menu/[menuId]`, `ArticlePricesSection`/`CategorySection`, stato `clienti`/`Sidebar`).

**Decisioni** (dettaglio [ADR-0034](docs/architecture/ADR-0034-referenti-ui.md)):

- **Detail `clienti/[id]`**: header azienda read-only (scheda) + `ReferentiSection`. `getAzienda` riaggiunto ad `aziende-api` (era dead-code rimosso a STOP-c2).
- **`ReferentiSection`** self-loading (perms via `useAuth`, fetch on-mount, refetch on mutation), render referenti a **tabella**, CRUD via `ReferenteForm` (form-in-Card, 6 campi) + `ConfirmDialog`.
- **Sidebar** active-state a **match per prefisso** (`pathname === href || startsWith(href + '/')`) → "Clienti" attivo sul detail; chiude il TD-BU per accountant.
- **Entry-point** lista clienti: nome → `<Link>` al detail, Modifica/Elimina inline mantenuti (coesistenza).
- **Seed** `seedDevReferenti`: 3 referenti demo su `studio-demo` (2 AZ001, 1 AZ002 non-attivo), lookup per codice, idempotente.

**Scelte implementative (verbale STOP 2)** — tutte accettate (migliorie/semplificazioni): componenti in `components/referenti/` (no duplicati, `ConfirmDialog` riusato), perms in `ReferentiSection` via `useAuth`, render tabella, header detail read-only (edit azienda resta in lista — coesistenza), 404 unificato con loadError, i18n naming esplicito, slug da `useParams`.

**Gate:**

- typecheck **16/16** ✅ · lint · next lint no warnings · format clean ✅
- build accountant-web ✅ — route `/t/[slug]/clienti/[id]` presente
- db:seed ×2 idempotente ✅ · verifica DB: 3 referenti su `studio-demo` ✅
- Smoke browser (Nicolò, pre-merge) ✅ — vedi PR.

**Tech debt:** nessuno nuovo. **TD-RLS-aziende+referenti** invariato (backend).

**File:** `apps/accountant-web` (new: `referenti-types`/`referenti-api`/`components/referenti/{ReferenteForm,ReferentiSection}`/`clienti/[id]/page`; mod: `aziende-api +getAzienda`, `error-codes`, `Sidebar`, `clienti/page`, i18n it/en) · `packages/db/prisma/seed.ts` (`seedDevReferenti`) · `docs/architecture/ADR-0034-referenti-ui.md` + `PROGRESS.md`.

**Foundation status post-merge:**

- 2° verticale: skeleton (ADR-0029/0030) + `aziende` backend+UI (ADR-0031/0032) + `referenti` **backend + UI** (ADR-0033/0034) ✅ — prima entità + primo satellite completi end-to-end, primo segmento dinamico del verticale.
- Next: STOP-c3c (eventuali altre entità satellite) **oppure** slot nav `fatture` (entità grossa, multi-STOP) **oppure** pulizia TD backend (TD-RLS-anagrafica, TD-BV, TD-BS Sub-2).

### [2026-06-09] STOP-d1 — Test RLS-isolation come `gestionale_app` (anagrafica, ADR-0035)

**Branch**: `test/rls-isolation-anagrafica` · **Tipo**: 1 PR test-only (1 file, 0 prod) · **ADR**: [ADR-0035](docs/architecture/ADR-0035-rls-isolation-test-anagrafica.md)

Chiude il blind-spot RLS sul dominio anagrafica. Le policy `aziende_tenant_isolation` + `referenti_tenant_isolation` (FORCE) non erano mai esercitate: la suite e2e gira come `postgres` superuser (TD-BV) che bypassa la RLS; l'isolamento era verificato solo applicativamente. Nuovo spec `rls-isolation.e2e-spec.ts` boota l'app come `gestionale_app` (NOSUPERUSER NOBYPASSRLS), replica del pattern `soft-delete-rls.e2e-spec.ts` (ADR-0021).

**Decisione (dettaglio [ADR-0035](docs/architecture/ADR-0035-rls-isolation-test-anagrafica.md)):**

- **Sub-1 (questo STOP)**: spec mirato — 5 scenari (S0 guard + aziende list/getById + referenti list/create), isolamento tenant esercitato a livello DB. Riuso totale infra e2e (`toAppRoleUrl` + override `databaseUrl`; setup via URL superuser). Nessuna modifica a file prod o altri spec.
- **Sub-2 (deferita, TD-BV)**: conversione intera suite a non-superuser, fuori scope — da valutare dopo `fatture`.

**Gate:** lint · format clean ✅ · e2e **27/27** (rls-isolation 5/5 NEW come `gestionale_app` + aziende-crud 11 + referenti-crud 11 regression) ✅. Solo locale (TD-CB).

**Tech debt:** TD-RLS-aziende+referenti → risolto per "policy esercitata DB-level" (dominio anagrafica). TD-BV deferito (Sub-2). TD-BS Sub-2 (ValidationPipe e2e) invariato.

**File:** `apps/accountant-api/test/e2e/rls-isolation.e2e-spec.ts` (new) · `docs/architecture/ADR-0035-rls-isolation-test-anagrafica.md` + `PROGRESS.md`.

**Foundation status post-merge:**

- 2° verticale: skeleton + `aziende` (backend+UI) + `referenti` (backend+UI) + **RLS isolation anagrafica esercitata DB-level** ✅
- Next: `fatture` (slot grosso, multi-STOP) · STOP-c3c (altra entità satellite) · TD-BV pieno (post-fatture).

### [2026-06-09] STOP-e1 — backend `preventivi` MVP (testata + voci, tx atomica + totali, ADR-0036)

**Branch**: `feat/preventivi-backend` · **Tipo**: 1 PR feature (FULL) · **ADR**: [ADR-0036](docs/architecture/ADR-0036-preventivi-backend.md)

Prima entità con **business logic** del verticale: `preventivi` (testata) + `preventivi_voci` (righe), figli di `aziende`, con ricalcolo totali server-side in **transazione atomica**. Da StudioDesk `62_preventivi.sql` (catalogo `servizi_*` e versioning/workflow fuori MVP). STOP 0 ha accertato che `fatture` non esiste come tabella StudioDesk (c'è `preventivi` dominio + `fic_billing` integrazione) → scelta di prodotto: preventivi ora, FIC dopo.

**Decisioni** (dettaglio [ADR-0036](docs/architecture/ADR-0036-preventivi-backend.md)):

- Modello `Preventivo` (codice partial-unique, enum `StatoPreventivo`, 3 totali Decimal, soft-delete) + `PreventivoVoce` (snapshot custom, `tenantId` proprio + RLS dedicata, no soft-delete) + enum `UnitaMisura`. FK azienda+tenant Cascade.
- **DP-prev-1** catalogo fuori MVP (voci custom). **DP-prev-2** stato base 4 valori, no versioning/workflow. **DP-e1-1** voci nel payload + **tx atomica** (replace integrale voci + ricalcolo totali in `withTenantContextAtomicTx` — invariante totali ≡ Σ voci). **DP-e1-2** codice manuale partial-unique. **DP-e1-3** stato libero via PATCH. **DP-e1-4** +2 permessi `preventivi.{visualizza,gestisci}` (33→35).
- **Pattern NUOVO**: replace-collezione-in-tx (deleteMany+createMany figli + ricalcolo aggregati padre) — prima business logic + prima tx atomica del verticale accountant, riusabile per fatture.

**Gate:** typecheck 16/16 · lint · format clean ✅ · migration + verifica DB (2 policy + FORCE + partial-unique + FK cascade) ✅ · e2e **39/39** (preventivi-crud 12 NEW con totali verificati sui numeri + replace-in-tx + RBAC + isolamento + 404; aziende 11 + referenti 11 + rls-isolation 5 regression). Solo locale (TD-CB).

**Tech debt:** TD candidate — estendere `rls-isolation.e2e-spec.ts` ai preventivi (policy installata ma non esercitata DB-level, coerente con TD-RLS anagrafica). TD-BV + TD-BS Sub-2 invariati.

**File:** `packages/db` (schema +2 enum/+2 model/+relazioni, barrel, migration `add_preventivi`, seed +2 permessi) · `apps/accountant-api` (modulo `src/preventivi/` + registrazione + e2e `preventivi-crud` + fixtures) · `docs/architecture/ADR-0036-preventivi-backend.md` + `PROGRESS.md`.

**Foundation status post-merge:**

- 2° verticale: skeleton + `aziende` (BE+UI) + `referenti` (BE+UI) + RLS anagrafica testata + **`preventivi` backend** (prima business logic + tx atomica) ✅
- Next: **STOP-e2** — UI preventivi (lista/detail/editor voci con totali live, sotto `clienti/[id]` o nav dedicata) · poi catalogo servizi / FIC / PDF (slice future).

### [2026-06-10] STOP-e2 — UI preventivi (lista detail + editor voci, totali mirror, ADR-0037)

**Branch**: `feat/preventivi-ui` · **Tipo**: 1 PR feature FE (FULL) · **ADR**: [ADR-0037](docs/architecture/ADR-0037-preventivi-ui.md)

Prima UI con business logic visibile a schermo nel verticale commercialisti:
lista preventivi come sezione in `clienti/[id]` + editor voci con totali live
mirror della formula server.

**Decisioni**: DP-aggancio=C (lista in sezione detail, editor in route annidata
`clienti/[id]/preventivi/[id]`), DP-editor=ibrido (testata RHF+zod, voci
useState+useMemo). Vedi [ADR-0037](docs/architecture/ADR-0037-preventivi-ui.md).

**Mirror totali**: `lib/preventivi-totali.ts` formula byte-esatta del service.
7 test unit, 3 casi divergenti cross-checkati a mano contro server.

**Bug trovato da runtime**: Prisma serializza Decimal→stringa, validoFino→datetime
completo. Fix in `preventivi-api.ts` (normalizzazione wire→domain).

**Gate**: typecheck 16/16 ✓ · lint ✓ · build ✓ · test 7/7 (accountant-web) ·
seed idempotente · runtime Playwright headless PASS (lista/editor/totali/delete/409).

**Tech debt**: TD candidate seed utente non-superuser studio-demo (~20min) ·
TD-RLS-preventivi candidate (policy installata, non esercitata DB-level).

**Foundation status post-merge**: 2° verticale — skeleton + aziende (BE+UI) +
referenti (BE+UI) + RLS anagrafica + preventivi backend + **preventivi UI** ✅

### [2026-06-10] TD-RLS-preventivi — RLS isolation e2e (LEAN, segue ADR-0035)

**Branch**: `test/rls-isolation-preventivi` · **Tipo**: 1 PR test-only (1 file) ·
**Pattern**: ADR-0035 (nessuna decisione nuova, nessun ADR dedicato).

Chiude il TD candidate RLS-preventivi aperto da ADR-0036/STOP-e2. Estende
`rls-isolation.e2e-spec.ts` con 5 scenari per `preventivi`/`preventivi_voci`
bootando come `gestionale_app` (NOSUPERUSER NOBYPASSRLS), replica del pattern
anagrafica (ADR-0035). Le policy `preventivi_tenant_isolation` +
`preventivi_voci_tenant_isolation` (ADR-0036) ora esercitate DB-level —
S-prev-4: ogni tenant vede 2 voci (non 4) sotto RLS reale.

Helper locale `queryAsAppRole` (raw-pg + SET app.tenant_id) per esercitare
`preventivi_voci` a livello DB (figlio del preventivo, no endpoint API proprio).

**Gate**: e2e 44/44 (39 + 5 nuovi; rls-isolation 5→10) · typecheck ✓ · lint ✓.
Solo locale (TD-CB).

**TD residui verticale**: TD-BV (suite intera superuser, Sub-2 post-fatture) ·
seed utente non-superuser studio-demo (gating runtime) · TD-BS Sub-2.

### [2026-06-10] STOP-dash1 — Dashboard operatore-studio (KPI + ultimi preventivi, ADR-0038)

**Branch**: `feat/dashboard-stats` · **Tipo**: 1 PR feature (FULL) · **ADR**: [ADR-0038](docs/architecture/ADR-0038-dashboard-stats.md)

Prima dashboard del verticale commercialisti, livello operatore-studio. Endpoint
aggregazione `GET /api/v1/dashboard/stats` (prime query count/groupBy/aggregate del
progetto, RLS-filtered automaticamente via $allOperations) + card-grid FE
(KPI clienti+preventivi + lista 5 ultimi preventivi).

**Decisioni**: scope operatore-studio (NO portale-cliente, NO super-admin, NO FIC) ·
permessi riuso `anagrafica.cliente.visualizza` (no nuovo permesso) · card Clienti
Opzione 2 (totale + tagli ortogonali stato/tipo) · aggregate sotto RLS senza wrap
(verificato $allOperations + softDelete su aggregate). Vedi [ADR-0038](docs/architecture/ADR-0038-dashboard-stats.md) + §roadmap
(visione tre livelli StudioDesk).

**Verifica runtime non-superuser**: numeri a schermo == DB (soft-deleted esclusi
dagli aggregati — PREV-TEST-UI di STOP-e2 correttamente non contato).

**Gate**: typecheck ✓ · lint ✓ · build ✓ · e2e 48/48 (4 nuovi dashboard-stats con
invariante attivi+nonAttivi==totale). Solo locale (TD-CB).

**Tech debt**: TD-RLS-dashboard candidate (endpoint non in rls-isolation; isolamento
applicativo + runtime). TD residui invariati.

**Foundation status post-merge**: 2° verticale — skeleton + aziende (BE+UI) +
referenti (BE+UI) + RLS anagrafica + preventivi (BE+UI) + **dashboard operatore-studio** ✅

### [2026-06-10] Seed ruoli commercialisti + utente Collaboratore (LEAN)

Slice **LEAN** (nessun ADR, solo `packages/db/prisma/seed.ts`; zero schema/migration —
i `system_role_templates` sono cataloghi globali, no tenant_id). Chiude il **TD candidate
"seed utente non-superuser studio-demo"** (da ADR-0037 / HANDOFF): finora il gating
runtime di `preventivi.*` / `anagrafica.cliente.*` era verificabile solo a livello codice,
perché `admin@studio.local` è Super Admin (35 permessi, non esercita mai i deny).

**Cosa fatto:**
- **+4 `system_role_templates`** per il verticale commercialisti accanto ai 6 della
  ristorazione (catalogo ora 10, mappings 156): **Socio** (34 = tutti tranne
  `sistema.tenant.gestisci`), **Collaboratore** (5: `anagrafica.cliente.{visualizza,crea,
  modifica}` + `preventivi.{visualizza,gestisci}`), **Segreteria** (2: `cliente.visualizza`
  + `preventivi.visualizza`), **Praticante** (2, idem). Skip dei permessi
  `anagrafica.referente.*` (non esistono nel catalogo — i referenti riusano `cliente.*`
  come la UI). Stesso pattern upsert-su-`name` dei 6 esistenti.
- **`seedDevCollaboratore(tenantId)`** — analogo a `seedDevTenant` (vedi pattern §
  [STOP-c2 ADR-0032] e core seed sessione D2a/D3b): clona il template Collaboratore in un
  ruolo tenant-wide di studio-demo + crea `collaboratore@studio.local / Collaboratore123!`
  + assignment tenant-wide (sedeId NULL). Idempotente: find-then-create su email+tenantId,
  ruolo (tenantId+name), mapping, assignment.

**Gate**: typecheck ✓ · lint ✓ · `db:seed` ×2 idempotente (2ª run: templates 0 created,
mappings 0 re-affirmed su 156, collaboratore role_permissions 0 created/5 re-affirmed,
assignment already-exists) ✓. Verifica DB: 4 template presenti + `collaboratore@studio.local`
con ruolo Collaboratore (5 permessi). Zero file di produzione toccati, zero migration.

## 🚧 In corso / Prossimo task

**Macro-task: TBD — candidate prossima sessione (da validare con Nicolò).**

Candidate (in ordine di priorità suggerito):

1. **F1 Menu UI scaffold** 🔼 **priority #1 sessione 19** — backend schema + CRUD base completati sessione 17 (ADR-0019), validation constraint coperti da unit test (TD-BS Sub-1 sessione 18). Carving S19-S21: UI scaffold Menu, listini multipli UI, foto upload pipeline (decisione storage: locale `uploads/` vs S3-compat vs Cloudinary — vedi TD-BO), varianti/modificatori.
2. **TD-BS Sub-2 — E2E integration `ValidationPipe→400`** 🔶 priority MEDIA (deferred sessione 18) — copertura E2E dell'integrazione `ValidationPipe→controller→HTTP 400`, bloccata dal harness che non emette `design:paramtypes` (vitest 3.x non eredita i `plugins` root nei `test.projects`). 4 `.skip` E2E in attesa. Richiede STOP 0 prototipo dedicato (opzione: apps/api importa enum da `@prisma/client` diretto, o rebuild `@gestionale/db` enum bundled). Integrazione già garantita in prod da toolchain `tsc` → valore incrementale basso.
3. **`withSystemContextRaw` helper** — fix proper F3 D4 (forceDelete + RLS bypass). ~30 LOC in rls.ts + smoke verify. Bassa priorita' finche' raw ops in withSystemContext sono ops one-shot.
4. **F1 refactor wave** (TD-AG + TD-AH): JWT_SECRET top-level → ConfigService runtime + prisma singleton eager → factory pattern DI. Anti-pattern testability emersi B2b. Stima ~1.5h combinati.
5. **TD-BG ADR-0016** — convergenza stilistica 7+ call site `UnauthorizedException('E_*')` → DTO `AuthErrorResponse` pattern + restringi `isTaxonomyCode` regex. Non-urgente. Stima ~45min.
6. **TD-BH ADR-0016** — structured security logging 401/403 ripetuti (fraud detection observability). Non-urgente. Stima ~30min.
7. **TD-BJ ADR-0012** 🆕 sessione 16 — Cache invalidation `DEL tenant:slug:${slug}` su endpoint manage tenant lifecycle futuro (eventual consistency 60s TTL-only oggi). Trigger: arrivo primo endpoint "manage tenant lifecycle" (rename slug, soft-delete, reactivate). Stima ~15min (1 DEL call + smoke).
8. **TD-BK ADR-0012** 🆕 sessione 16 — Audit log persistente `tenant_mismatch_attempt` (coerente pattern `permission_denied` PermissionsGuard). Oggi solo `Logger.warn` 2 paths rifiuto. Stima ~30min (audit insert + fraud detection observability).
9. **Miglioramento pre-push hook** — parsing stdin formato git pre-push per distinguere push regolari da delete. Stima: 15-20 min.
10. **Dependabot / Renovate** — security updates automatici dipendenze. Stima: 20-30 min.

### Owner: Claude Code in VS Code Remote-SSH (con stop intermedi a Nicolò)

### Preparazioni manuali a carico di Nicolò prima di partire

(Nessuna preparazione bloccante. Branch protection lato server resta non-enforced finché non si valuta upgrade Team — non blocca lo sviluppo.)

---

## 📋 Da fare prossimamente (dopo questo macro-task)

### Cleanup e formalizzazione
- [ ] **Rimuovere `/etc/sudoers.d/deploy-setup`** (NOPASSWD setup temporaneo) — la condizione "primo `docker compose up` funzionante" è ora soddisfatta (smoke test verdi il 2026-05-11 sera), quindi è il momento giusto. Operazione manuale di Nicolò (richiede password sudo). Comando: `sudo rm /etc/sudoers.d/deploy-setup` poi verifica `sudo -l` per confermare che NOPASSWD su apt/sysctl/systemctl non sia più presente.
- [ ] ADR successivo (ADR-0005+) per strategia ACME quando arriverà un dominio reale (backup `caddy_data`, DNS vs HTTP challenge, wildcard policy)

### Tech debt esplicito (NestJS scaffold D1 + E1 + E2)

Tracking accentrato delle course corrections. Dettagli in [ADR-0007](docs/architecture/ADR-0007-nestjs-api-scaffold.md) + [ADR-0011](docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md) + [ADR-0012](docs/architecture/ADR-0012-frontend-auth-flow.md).

- [x] ~~**CC2 — CJS/ESM strategy re-evaluation**~~ — **RISOLTO 2026-05-13 (E1, ADR-0011)** via dual package strategy: `packages/db` torna ESM-native + `tsup` build step + `exports` conditional. apps/api consuma `dist/index.cjs` (zero modifiche), apps/web `dist/index.mjs`.
- [ ] **CC1 — ts-node-dev → swc-node migration**: `ts-node-dev` v2.0.0 (~2022) è "stale repo". CC2 risolto ha abilitato in linea di principio anche la migration dev runner (con build step packages/db ora c'è). Re-evaluation differita, low priority finché ts-node-dev resta operativo. Workaround disponibili: loader Node `@swc-node/register` con nodemon, TS Project References (ADR-0006 opzione c). Monitor maintenance status ogni 6 mesi.
- [ ] **TD-1 ADR-0011 — Tailwind 3.4 → 4 migration**: ecosystem (shadcn registry, plugin) in transizione. Trigger: shadcn registry T4 completa + T4 plugins ecosystem maturo. Stima 2-3h.
- [ ] **TD-2 ADR-0011 — React 18.3 → 19 migration**: ecosystem libs in assorbimento, peer dep warnings residui. Trigger: Radix+shadcn 100% R19 validato. Stima 1-2h.
- [ ] **TD-3 ADR-0011 — TypeScript 7.0 baseUrl deprecation**: carry-over da `tsconfig.base.json` (NON introdotto da E1). Trigger: bump TS a 7.0 (Q3 2026). Stima 30-45 min, migration meccanica a paths self-contained.
- [ ] **TD-4 ADR-0011 — packages/db source-vs-dist asymmetry**: apps/api typecheck via src/, apps/web via dist/. Funziona oggi (2 consumer). Trigger: arrivo 3° workspace consumer (apps/kds probabile). Stima 30-60 min, decisione strategica "always-dist" vs "always-src".
- [ ] **TD-5 ADR-0011 — shadcn manual scaffold update path**: 5 file shadcn scritti a mano in E1 (F4 discovery). Trigger: shadcn 5.x opt-out T3 flag OR breaking changes registry da prendere. Monitor CHANGELOG ogni 6 mesi.
- [ ] **TD-1 ADR-0012 — Migration localStorage → httpOnly cookie**: JWT in localStorage XSS surface. Trigger: ANY production deployment OR introduction sensitive features (financial transactions, multi-user concurrent). Stima ~1.5h (backend cookie middleware + CSRF endpoint + frontend `credentials: 'include'`). `credentials: true` già in CORS config (E2 ready).
- [x] ~~**TD-2 ADR-0012 — Multi-tenant tenant slug resolution**~~ — **RESOLVED 2026-05-15 sessione 9** (PR merge pending). Pattern path-based scelto: `/t/<slug>/<page>` con Next.js 15 middleware + `useParams` runtime + `RequestOptions { tenantSlug?, accessToken? }` interface tipizzata. Backend INVARIATO. Vedi [ADR-0012 TD-2 Resolution](docs/architecture/ADR-0012-frontend-auth-flow.md).
- [ ] **TD-3 ADR-0012 — Auto-refresh token prima scadenza**: access token 15min, user re-login forzato. Trigger: feedback UX "sessione scade durante uso". Stima ~1h. Pattern setInterval 14min + refresh in background + edge case tab inactive + multi-tab sync.
- [x] ~~**TD-4 ADR-0012 — Setup Playwright E2E frontend CI**~~ — **RESOLVED 2026-05-15 sessione 10** ([ADR-0016](docs/architecture/ADR-0016-playwright-e2e-frontend-ci.md), PR #25). Playwright 1.60.0 + 7 test E2E flow critici + CI job container `mcr.microsoft.com/playwright:v1.60.0-jammy` + services Postgres/Redis/Mailpit. Test: Chromium 11/11 PASS + cross-browser smoke 5/5+5/5. 4 nuove discoveries (#32-35) + 7 nuovi TD (TD-AJ → TD-AP).
- [ ] **TD-5 ADR-0012 — shadcn CLI output cleanup pattern**: `shadcn add` può generare file che violano lint rules monorepo (E2 F2: 1 char `import type`). Trigger: ogni nuovo component. Stima 5-10 min per component. Memo CHANGELOG monitor.
- [x] ~~**TD-6 ADR-0012 (backend) — Logout server-side via /auth/logout**~~: **RISOLTO 2026-05-13** in questa PR. Frontend handleLogout async chiama POST /auth/logout PRE clearTokens + always-executed clearTokens su error (silent log) + loading state UX. Discovery collaterale: apiPost lib 204 No Content handling fix (+3 LOC riusabile per DELETE F1). Vedi [ADR-0012 sezione TD-6 Resolution](./docs/architecture/ADR-0012-frontend-auth-flow.md).

### Qualità codice / processo (post Husky setup + typecheck monorepo)
- [x] ~~**Strategia typecheck monorepo**~~ — RISOLTO 2026-05-13 (Macro-task C, ADR-0006). `pnpm typecheck` ora propaga via Turbo a tutti i workspace, CI valida `packages/db` e futuri.
- [ ] **Cache Turbo in CI** via `actions/cache` su `.turbo/`: quando CI diventerà bottleneck (oggi ~30s adeguato, niente di urgente). Beneficio atteso: skip ricalcolo typecheck/lint per file invariati. Stima: 15 min.
- [ ] **TS Project References nel root `tsconfig.json`**: quando avremo 5+ workspace o quando il typecheck cross-package supererà 10-15s, valutare migrazione a `composite: true` per build incrementale. Vedi ADR-0006 sezione "Considered Alternatives" punto (c).
- [ ] **Miglioramento pre-push hook**: parsing stdin formato git pre-push per distinguere push regolari da delete (`local-sha == 0000...` indica delete). Elimina la necessità di `--no-verify` per cancellazioni remote legittime di branch diverso da `main` quando ci si trova su `main`. Vedi commit body PR #2 per dettagli edge case.
- [ ] **Branch protection lato server**: attualmente Rulesets su GitHub Free **non enforced**. Decisione di rivalutarli solo se: (a) si passa a Team account ($4/mese — non giustificato per single-dev), oppure (b) il progetto diventa multi-developer. Fino ad allora, protezione affidata a pre-push hook (ADR-0004).
- [ ] **PR template completo** secondo §C12 brief (test, docs, migrazione DB, breaking changes, impatto API pubbliche, token AI usage, impatto feature flag) — da espandere quando arriverà codice F1.
- [ ] **Dependabot / Renovate** per security updates automatici delle dipendenze (vedi §C5 brief "Dipendenze monitorate"). Configurazione `.github/dependabot.yml` quando ci sarà più superficie da monitorare.
- [ ] **Migration config Prisma 7**: spostare `"prisma"` config da `package.json` a `prisma.config.ts` quando upgraderemo Node a 20.19+ (oggi pin `.nvmrc` a 20.18.1) → Prisma 7. Deprecation warning attualmente visibile su `prisma db seed`. Non blocca, migration meccanica.

### Operazioni manuali ricorrenti
- Cancellare a mano eventuali branch `revert-*` orfani via `git push origin --delete <branch>` se accidentali in futuro (UI GitHub "Revert" crea sempre la branch anche se non si conferma la PR di revert).

### Verso F1 (Core Operativo MVP)
- [x] ~~Schema Prisma base (Tenant, Sede, User, Role, Permission, AuditLog) con RLS PostgreSQL~~ — completato 2026-05-12 (Macro-task A)
- [x] ~~Seed system_role_templates + permission catalog~~ — completato 2026-05-12 (Macro-task B: 32 permessi + 6 templates + 104 mappings)
- [x] ~~Soft-delete extension Prisma client + helper `uuidv7` wrapper esportato~~ — completato 2026-05-12 (Macro-task B: 5 scenari smoke verdi)
- [x] ~~**Scaffold NestJS** `apps/api` consumer di `@gestionale/db`~~ — completato 2026-05-13 (D1, ADR-0007)
- [x] ~~**Middleware tenant context** NestJS: `SET app.tenant_id` su transaction Prisma per attivare RLS reale~~ — completato 2026-05-13 (D3a, ADR-0009)
- [x] ~~**Sostituzione policy RLS** `USING (true)` con check reali (3 pattern in ADR-0005)~~ — completato 2026-05-13 (D3b, ADR-0009 v3)
- [x] ~~**Bootstrap tenant logic**: clone `system_role_templates` → `roles` con `tenant_id` reale + copia mapping~~ — completato 2026-05-13 (D4, ADR-0010)
- [x] ~~**Auth backend NestJS — email/password + JWT + refresh rotation + /me**~~ — completato 2026-05-13 notte (D2a, ADR-0008). 6 endpoint, smoke 10/10 verdi, admin@demo.local seedato
- [x] ~~**D2-vitest: Vitest 3 baseline + 4 test AuthService + theft detection FULL**~~ — completato 2026-05-13 notte tardi (E2E theft verificato: revoke all + audit forense)
- [ ] **D2b PIN POS**: `/auth/pin-setup` + `/auth/login-pin` + uniqueness applicativa + 2 test PIN
- [ ] Valutare RLS su `role_permissions` con `EXISTS` join (defense-in-depth, vedi ADR-0005 follow-up)
- [ ] UI shell Next.js (layout, theme, i18n setup IT primary + EN secondary)
- [ ] Mappa tavoli editor + viewer (drag&drop, 6 tipi, 7 stati)
- [ ] Menu CRUD + listini multipli
- [ ] Comande PWA cameriere (offline-first con IndexedDB)
- [ ] Cassa + driver Epson FP F1 (stub iniziale)
- [ ] KDS app (Kitchen Display System)
- [ ] Sito vetrina + prenotazioni online
- [ ] Dashboard widget + report base
- [ ] AI Assistant Claude API integration
- [ ] (...continua secondo sezione D del brief)

### Predisposizioni [PRE] da considerare nello scaffold
- Vedere sezione A5 del PROJECT_BRIEF.md per la lista completa
- In particolare durante setup monorepo: feature flag, audit log, RLS, i18n, plugin/webhook hooks

---

## 🎚️ Convenzione — Gate a due corsie (dal 2026-06-09)

**Principio guida del progetto:** test-bed ora, opzione di prodotto in futuro (far provare a studi amici → valutare vendita). Conseguenza: si investe in **fondamenta ready/scalabili di default** (multi-tenancy, RLS, auth, architettura, test), NON in profondità di dominio o feature di prodotto premature (auto-numbering, portali cliente, AI, integrazioni esterne) finché uno studio reale non le richiede. Barra di scope: "lo costruirei comunque per il test-bed?" non "servirà a un cliente ipotetico?".

Lo STOP-gate (STOP 0→1→2→3) si applica con **cerimonia calibrata al rischio**, deciso a STOP 0:

**Corsia FULL** — quando la slice tocca ≥1 di:
- schema / migration / RLS
- transazioni atomiche o business logic con invarianti (es. ricalcolo totali)
- shared config (vitest/turbo/tsconfig/build) o interop CJS/ESM
- auth / permessi / catalogo RBAC
- primo uso di un pattern non ancora in nessun ADR

→ trattamento pieno: STOP 0 empirico, STOP 1 spec con DP esplicite, STOP 2 spot-check sul diff (anche multi-blocco se serve), STOP 3 commit + PR + **ADR dedicato** + PROGRESS.

**Corsia LEAN** — CRUD puro che replica un pattern già in ADR, **zero decisioni nuove**:
- STOP 0 solo se serve un preflight (spesso skippabile)
- STOP 1 spec
- STOP 2 **un solo spot-check** (no multi-blocco) — basato sul self-check report di Claude Code
- STOP 3 commit + PR + **entry PROGRESS che linka l'ADR-pattern esistente** ("segue ADR-NNNN, nessuna decisione nuova"), **niente ADR dedicato**
- niente `ask_user_input` se non emergono DP reali

**Criterio di routing (regola pratica):** se a STOP 0 **non emerge alcuna DP sostanziale** una volta scelto il pattern → è LEAN. Se emerge anche una sola DP di prodotto/architettura → FULL. In dubbio: FULL.

Esempi retroattivi: `aziende` backend = FULL (schema+RLS+migration). `referenti` backend = sarebbe stato LEAN (CRUD che replica aziende, nessuna DP vera) — trattato FULL, overhead evitabile. `preventivi` = FULL (tx atomica + totali + nuovo enum + permessi).

## 🔁 Convenzione — Self-check report (dal 2026-06-09)

A STOP 2, Claude Code produce un **self-check report**: esegue lui le verifiche meccaniche e incolla l'esito già valutato. Claude strategico reviewa il *giudizio*, non rifà la verifica meccanica. Riduce i round-trip diff.

Checklist standard del report (Code la esegue e riporta PASS/FAIL per ciascuna):
1. `git status --short` → nessun `.lock` / file spurio in stage
2. header commit ≤ 100 char
3. (se schema) partial-unique presente dove atteso · RLS policy creata · FORCE attivo
4. `git add` selettivo (lista file attesa vs staged, combaciano)
5. typecheck / lint / format / build → esiti
6. e2e → conteggio scenari verdi (+ regression invariati)
7. divergenze dallo spec auto-segnalate da Code (con Accept/Reject proposto)

Claude strategico riceve **il report + il diff** (un blocco unico per slice LEAN; multi-blocco solo se FULL e il diff è grosso/rischioso). Verdetto a STOP 2 sul giudizio, non sulla rilettura meccanica.

---

## 🔄 Workflow operativo correnti

### Esecuzione comandi

| Categoria | Chi esegue |
|---|---|
| `sudo apt`, `apt-get`, `sysctl`, `systemctl` | Claude Code (NOPASSWD) |
| `sudo` su altri binari (chmod, install, tee, usermod, docker con sudo) | Nicolò (digita password) |
| `docker` senza sudo (grazie a gruppo docker) | Claude Code |
| File operations (create, edit, mkdir) | Claude Code |
| Operazioni manuali web (GitHub, Hetzner UI, DNS) | Nicolò |
| Decisioni architetturali ambigue | Claude strategico in chat web |

### Convenzioni file/cartelle
- Tutto sotto `/home/deploy/projects/gestionale/`
- Configurazioni globali macchina sotto `/etc/` (sysctl, fail2ban, ssh, docker)
- Documenti di processo (questo) in root del progetto
- Documenti architetturali in `docs/architecture/`

### Convenzioni Git
- Branch principale: `main`
- Commit message: convenzione [Conventional Commits](https://www.conventionalcommits.org/)
  - `chore:` setup, dipendenze, config
  - `feat:` nuova feature
  - `fix:` bug fix
  - `docs:` documentazione
  - `refactor:` ristrutturazione senza cambio comportamento
  - `test:` aggiunta/modifica test
  - `ci:` pipeline CI/CD

---

## 📓 Incidents log / Lezioni operative

Sezione viva. Registra incidenti, near-miss e lezioni che vale la pena ricordare per evitare di rifare gli stessi errori.

### 2026-05-12 — Commit empty `2151e4f` pushato accidentalmente su `main` durante test hardening Husky

**Cosa è successo.** Durante il setup di Husky (macro-task "Husky + lint-staged + commitlint"), nello specifico durante una variante di test del pre-push hook su `main`, ho fatto:

```
git stash --include-untracked   # libera il WT per checkout pulito a main
git checkout main
git commit --allow-empty -m "chore: hardening test pre-push block"
git push origin main            # atteso BLOCK del pre-push hook
```

Il push **non è stato bloccato** ed è atterrato come commit `2151e4f` su `origin/main`.

**Causa root.** `git stash --include-untracked` ha stashato anche i file `.husky/*` perché in quel momento erano **untracked** (non ancora committati nella feature branch in corso). Con `.husky/pre-commit`, `.husky/commit-msg`, `.husky/pre-push` rimossi dal working tree, Husky 9 (che routa via `core.hooksPath = .husky/_/` con proxy verso `.husky/<hook>`) non ha trovato gli script utente e ha eseguito un **no-op silenzioso**. Niente blocco del commit-msg, niente blocco del pre-push.

**Decisione.** **Nessun force-push di rollback** su `origin/main`. Il commit `2151e4f` rimane in storia come monito permanente. Razionale:

1. **Disciplina ferrea "`main` never force-pushed"** — fare un'eccezione anche per buona ragione apre un precedente
2. **Lezione formativa al diritto**: il commit resta visibile per ricordare la lezione
3. Funzionalmente innocuo (empty commit, non rompe nulla in CI o nello stato del codice)
4. Costo del force-push (`--no-verify` del nostro pre-push hook, precedente di disciplina) > beneficio (pulizia estetica di 1 commit)

**Lezioni.**

1. **Mai stashare untracked quando dipendi dagli hook**. Prima di test che richiedono hook attivi: o committa gli hook prima (anche temporaneamente), o usa `git stash` (default, solo tracked) senza `--include-untracked`. In generale: stash `--include-untracked` è una forma di "disabilitazione silenziosa" di tutto ciò che non è ancora committato — pericoloso quando include codice di sicurezza.
2. **Setup `Husky 9 = .husky/_` proxy fallisce silently** se gli script `.husky/<hook>` non esistono. Comportamento documentato ma controintuitivo: invece di error "hook not found", proxy esegue no-op. Importante saperlo perché può mascherare hook disattivati.
3. **Test che dipendono da effetti su `origin/main` devono essere fatti con doppio gate**: hook attivo + autorizzazione esplicita dell'owner. Non fare test pre-push su `main` in modalità auto senza fermarsi a verificare lo stato degli hook prima.

### 2026-05-12 — PR #2 (`feat: husky...`) mergiata con CI rossa

**Cosa è successo.** Subito dopo la fase di hardening dei hook, ho fatto squash merge della PR #2 (`feat: add husky + lint-staged + commitlint with pre-push main protection`) sul branch `main`. La CI del commit di merge era **rossa**: ESLint si lamentava di `commitlint.config.cjs`:

```
error  'module' is not defined  no-undef
```

**Causa root.** ESLint 9 con flat config applica per default `sourceType: 'module'` a tutti i file, incluso `.cjs`. In ambiente ESM la global `module` non è definita, quindi la regola `no-undef` di `@eslint/js` segnala errore sui literal CommonJS. Il file `commitlint.config.cjs` era stato introdotto dalla PR #2 stessa e non era stato testato contro ESLint prima del merge (il pre-commit eseguiva lint-staged solo sui file in stage del commit, non sul repo intero).

**Decisione.** Fix in nuova PR #3 (`fix: configure ESLint flat config for .cjs files as CommonJS`) con override flat config:

```js
{
  files: ['**/*.cjs'],
  languageOptions: {
    sourceType: 'commonjs',
    globals: { module: 'readonly', require: 'readonly', __dirname: 'readonly', __filename: 'readonly', process: 'readonly' },
  },
},
```

Approccio "fix the root, not the symptom": i `.cjs` continuano a essere lintati, e l'override è riusabile per qualsiasi futuro `.cjs` di tooling. Alternativa scartata: aggiungere `commitlint.config.cjs` a `.eslintignore` (più rapido ma esclude da future regressioni). PR #3 mergiata → `38861e2` su main → CI verde ristabilita.

**Side effect del flusso.** GitHub UI "Revert" cliccato sulla PR #2 mergiata ha creato la branch remota `revert-2-feature/husky-lint-staged-commitlint` (banner "Compare & pull request"). La PR di revert non è stata aperta perché abbiamo deciso di andare avanti col fix. Branch orfana cancellata manualmente via `git push origin --delete revert-2-feature/...` durante chiusura macro-task.

**Lezioni.**

1. **Mai mergiare PR con CI rossa**, neanche per fretta. La protezione lato server non c'è (GitHub Free privato), quindi è disciplina umana: leggere lo stato CI prima del click "Squash and merge".
2. **Pre-commit `lint-staged` non sostituisce la CI**: `lint-staged` valida solo i file modificati nel commit. Se introduco un file nuovo (es. `commitlint.config.cjs`) che PASSA lint-staged ma rompe il lint globale su CI, il problema emerge solo a CI run completata. Pattern: dopo PR che introduce file di config, prevedere un giro locale `pnpm lint` completo prima del push.
3. **Il bottone "Revert" di GitHub crea branch anche se non si conferma la PR**: tracciarli e ripulirli manualmente, oppure ignorarli sapendo che è "branch in attesa di promozione a PR".

---

## 🧠 Note di contesto importanti

### Vincoli espliciti

- **NON andrà mai in produzione vera**: progetto di gioco/apprendimento
- **Niente utenti reali, niente dati reali, niente requisiti legali stringenti**: le note legali in brief sez. E sono "se andasse in produzione"
- Stack tecnico **vincolante** (non negoziabile): vedi A3 brief
- 25 blocchi funzionali approvati B1-B25 + scartati [BACKLOG] in sez. F

### Cose già scartate (in [BACKLOG] sezione F del brief)

NON proporre, NON includere senza esplicito sblocco:
- Modulo Retail integrato
- Computer Vision controllo piatti
- Voice ordering
- Benchmark anonimo tra tenant
- Plugin Marketplace pubblico (API/webhook interni sì, marketplace esterno no)

### Vincoli Nicolò (utente)

- Lavora in italiano
- IP dinamico, mobilità (no whitelist IP statico)
- Mac (BSD tools, differenze da GNU/Linux)
- Vuole imparare facendo + AI come copilot
- Preferisce procedere step-by-step con stop di conferma
- Quando AI propone qualcosa di security-sensitive o ampio, vuole revisione strategica prima di OK

---

## [2026-06-29] Insight AI margine via Groq ([ADR-0057](docs/architecture/ADR-0057-ai-insight-margine.md), #139)

**Seconda feature LLM del prodotto** e **primo riuso del modulo `ai/`** (ADR-0056) fuori dalle comunicazioni. Sblocca l'insight differito in ADR-0054 §7: ora che il tariffario (#127) deriva `importoPrestazioni`, un'analisi di redditività su dati significativi è legittima. Read-only puro: nessuno schema/migration/seed/permesso.

- **`complete()` generico in `GroqService`**: il core (client lazy, chiamata, mappatura errori → 503 con `errorCode` stabile `E_AI_DISABLED`/`E_AI_EMPTY`/`E_AI_UPSTREAM`) è estratto in `complete(systemPrompt, userPrompt, { temperature?, maxTokens? })`. `suggerisciRisposta()` (#136) rifattorizzato per delegarvi — comportamento invariato, coperto dai test di regressione. Fondamento riusabile per le prossime feature AI.
- **`analizzaMargine(rows)`** sopra `complete()` (`temperature 0.3`, `max_tokens 400`): una **sintesi globale** sull'intero set di mandati (pattern/criticità trasversali/suggerimenti), non un insight per riga — una chiamata LLM per richiesta. System prompt: ≤200 parole, italiano, analizza **solo i mandati presenti**, marca le righe scoperte `MANCANTE/PARZIALE` senza caveat fantasma su mandati inesistenti (riscontrato in runtime e corretto). Tipo d'ingresso `MargineRigaInsight` locale a `groq.service.ts` → evita la dipendenza inversa `ai → report`.
- **Guard deterministico `< 2 mandati`**: `ReportService.margineInsight` short-circuita **prima** di chiamare Groq quando `rows.length < 2` (un'analisi comparativa non ha senso, e su input degenere il modello riempiva la risposta con commenti sull'assenza di altri mandati) → `insight: null` + **`aiGenerated: false`**, `copertura` comunque corretta. Risparmia la chiamata LLM e rimuove il rumore alla radice. Guard in `ReportService` (business-logic), non in `GroqService` (resta wrapper AI puro).
- **`aiGenerated` flag → i18n FE**: le stringhe del path deterministico ("nessun mandato"/"un solo mandato") sono testo di prodotto e rispettano la parità IT/EN — il BE NON le hardcoda in italiano, ritorna `aiGenerated:false` e il FE rende la stringa localizzata interpolando dai dati già caricati. La prosa AI (`aiGenerated:true`) resta italiano generato dall'LLM (effimero, coerente con ADR-0056).
- **`POST /report/margine/insight`** (azione che invoca un provider esterno, non lettura cacheabile) in `ReportController`, gated **`report.operativo.visualizza`** — **nessun permesso nuovo** (l'insight aggrega dati già accessibili via `GET /report/margine`; identica motivazione di ADR-0054). `margineInsight(tenantId)` riusa `margine()` per i dati, calcola la **copertura** (`{ totali, conPrestazioni }`) e la ritorna **insieme** all'insight, così il FE mostra un disclaimer indipendente dal testo AI (fatto sui dati, non inferenza del modello).
- **FE**: bottone "Analizza con AI" su `/report/margine` (gated `aiEnabled` via `GET /ai/status`, caricato best-effort in parallelo ai dati → fail-soft), box insight + **disclaimer copertura** ("N di M mandati con importi"), errore inline (`localError`, no toast). i18n namespace `report` esteso IT↔EN in parità.
- **Feature-flag** invariato (ADR-0056): key assente → bottone nascosto, 503 solo sul path AI (≥2 mandati); con <2 mandati la risposta è sempre 200.

Riuso permesso `report.operativo.visualizza` (catalogo invariato **58**). CI #139 verde.

---

## [2026-06-30] F2 Tavoli / Mappa sala — schema + backend + mappa drag-drop ([ADR-0058](docs/architecture/ADR-0058-tavoli-mappa-sala-f2.md))

**Primo dominio nuovo costruito sul core estratto (ADR-0027) dopo F1 Menu** — valida la riusabilità di `packages/*` (api-client, auth, db/RLS, ui, i18n) su un secondo dominio-feature. La voce shell `mappa` era un `<PlaceholderPage>`.

**Consegnato:**

- **Schema** — modello `Tavolo` (`numero`, `capienza`, `posX`/`posY` Float `@default(0)`, soft-delete) sotto il confine DOMINIO. `Tenant.tavoli` back-relation. Re-export tipo `Tavolo` in `packages/db`.
- **Migration** `20260630120000_add_tavoli_models_f2_schema` — CREATE TABLE + index `tenant_id` + partial-unique soft-delete-aware `(tenant_id, numero) WHERE deleted_at IS NULL` (fuso in creazione, greenfield) + FK `ON DELETE CASCADE` + RLS `ENABLE`/`FORCE` + policy `tavoli_tenant_isolation` (USING-only, branch super-admin, pattern menu 1:1). Applicata su DB pulito via Testcontainers (CHECK-DB-1 ✅).
- **Backend** — modulo `tables/` (controller + service + DTO + unit spec), REST `/tables` CRUD gated: GET → `tavoli.visualizza`, POST/PATCH/DELETE → `tavoli.gestisci`. Soft-delete via `update deletedAt` sul tx. `PATCH` include `posX`/`posY` (drag-drop persiste via stesso endpoint, no position dedicato — YAGNI).
- **Seed** — +2 permessi `tavoli.visualizza` / `tavoli.gestisci`. Baseline array `PERMISSIONS` **58 → 60**. Assegnazione **description-driven**: `gestisci` → Direzione; `visualizza` → Direzione, Cassiere, Cameriere (description citano i tavoli); **Cucina/Bar esclusa** («Nessuna altra azione»); Super Admin + Admin sede automatici via `ALL_PERMISSION_CODES`.
- **FE** — `mappa/page.tsx`: mappa sala drag-drop (token assoluti a `posX`/`posY`, pointer events, persistenza on-drop ottimistica + rollback) + elenco accessibile (CRUD da tastiera/AT, fallback mobile). Form `TableForm` (RHF + zod i18n via `useMemo([t])`). Namespace i18n `tavoli` it↔en in parità (153/153 chiavi).
- **E2E** — 3 spec Testcontainers: `tables-crud` (CRUD + patch posizione + soft-delete invisibility + GET 404), `tables-rbac` (viewer→GET 200 / POST·PATCH·DELETE 403; manager→201), `tables-tenant-isolation` (cross-tenant GET/PATCH/DELETE → 404, no leak). **13 file e2e / 70 pass** (4 skip pre-esistenti TD-BS menu).

**Tech debt registrati (ADR-0058):**

- 🆕 **TD-sala-forward** — `Sala`/`Zona` (raggruppamento tavoli, multi-piano) deferred. **Confine:** unico piano sala finché non implementato. Relazione 1:N già provata da Menu→Category → zero validazione nuova. Severità BASSA, additivo. Si attiva col primo consumer multi-sala.
- 🆕 **TD-tavolo-stato-forward** — stato tavolo (libero/occupato/riservato) deferred. **Confine:** mappa senza colore-stato. Dipende da Comande (S23+): lo stato deriva da un ordine attivo, gated `comande.*`. `deletedAt` copre già "fuori servizio". Severità BASSA, additivo.

---

## [2026-06-30] Smoke funzionale per-verticale per-ruolo ([ADR-0059](docs/architecture/ADR-0059-smoke-funzionale-per-verticale-per-ruolo.md))

Gate **post-deploy** che colma il gap di processo emerso dal bug "tavoli 403" (Super Admin senza permesso nel DB prod → 403 sfuggito a GATE statico + e2e effimeri). Smoke Playwright che logga come ogni ruolo seedato e **visita ogni pagina accessibile al ruolo** contro gli **URL pubblici** → DB prod condiviso, fallendo su 403/≥500/`pageerror`/crash.

- **Read-only ASSOLUTO** con guard attivo (`page.route` → `route.abort()` su POST≠login/PUT/PATCH/DELETE): nessuna mutazione lascia il browser. Verificato (POST/PATCH/DELETE bloccati, GET passa; zero scritture su prod).
- **On-demand, non CI-bloccante**: config dedicate `playwright.smoke.config.ts` (entrambe le app) fuori da turbo; la config CI funzionale fa `testIgnore` di `page-tour.spec.ts`. Script: `pnpm smoke` / `smoke:accountant` / `smoke:restaurant`.
- **Tour = pagine accessibili per-ruolo** (single source of truth: `e2e/page-manifest.ts` per verticale, derivato da `NAV_ITEMS` + `page.tsx` + permessi seed). Dinamiche `[id]` risolte navigando l'index → primo link; lista vuota → skip.
- **Scaffold accountant** (prima senza e2e): `playwright.smoke.config.ts` + `e2e/auth.setup.ts` (storageState per profilo-ruolo, localStorage) + `.env.e2e.example`, replicando il pattern restaurant (ADR-0016).
- **Run reale post-deploy**: **restaurant 10/10 PASS** (incl. `mappa`/tavoli → 403 originale risolto), **accountant 32/32 PASS**. Bonus: il tour ha pescato un finding architetturale (mutate-on-view comunicazioni).
- **Copertura Fase 1**: 3/11 ruoli (Super Admin/Collaboratore/Cliente — gli unici seedati). Limiti noti + 3 TD (`TD-no-error-boundary`, `TD-sidebar-permission-filter`, `TD-comunicazioni-mutate-on-view`) in ADR-0059 + HANDOFF.

---

## [2026-06-30] Cleanup tenant di test + comando ops `purge-tenant` (#143)

Pulizia del DB prod condiviso da tenant di test/verifica residui, e versionamento del tool che l'ha eseguita (i tenant di test ricorrono → consumer reale e dimostrato).

- **Rimossi 3 tenant** (hard-delete, ruolo `postgres` superuser via `DIRECT_URL`/`docker exec`, bypassa RLS FORCE): `verifica-41554` (Studio Verifica, residuo soft-deleted di una verifica deploy del 24/06), `rls-a-…`/`rls-b-…` (fixture del test RLS finite su prod il 19/06). **22 righe** totali via singolo `DELETE` + `ON DELETE CASCADE` (3 tenants, 11 roles, 1 user, 1 user_roles, 1 sede, 1 audit_log, 1 azienda, 1 comunicazione, 1 com_messaggi, 1 com_allegati). Well-known (`demo`/`acme`/`studio-demo`/`oneplatform`) intoccati.
- **Gate anti-rigenerazione chiuso con evidenza** (nessun TD aperto): `git log -S"rls-a-"` → 0 commit ⇒ slug mai versionati = artefatti runtime one-shot; i test RLS usano solo Testcontainers ephemeral; lo smoke #142 è read-only su tenant esistenti (nessun `tenant.create`). Nessun path test→prod che li ricrei.
- **Esecuzione transazionale con verifica pre-commit**: `BEGIN` → guard well-known riasserito nel set → `DELETE` → `COMMIT` solo se `ROW_COUNT = 3` E figli azzerati, `ROLLBACK` altrimenti. Post: `tenants = 4` (solo well-known).
- **Non-regressione**: `pnpm smoke` verde post-cleanup — **accountant 32/32 + restaurant 10/10** contro prod → l'operativo non è stato sfiorato.
- **Tool ops versionato** `pnpm --filter @gestionale/db purge-tenant` (⭐ YAGNI non si applica: consumer ricorrente e appena usato). Guard-rail: blocklist well-known categorica, **match esatto per `--slug`/`--id`** (mai pattern `LIKE`), **dry-run di default** (`--execute` per cancellare davvero), transazione con verifica pre-commit. Connessione `DIRECT_URL` (superuser, no estensione RLS). Doc nel [README del package db](packages/db/README.md#ops-purge-tenant). Scelto **niente ADR**: è tooling ops, non una decisione architetturale strutturale.

---

## [2026-07-01] Sync permessi template→tenant — no-op verificato, debito deferito ([ADR-0060](docs/architecture/ADR-0060-sync-permessi-template-tenant-noop.md)) (#144)

Task #1 (causa-radice del 403 tavoli) chiuso come **no-op verificato**, non costruito.

- **STOP 0 ricognitivo (read-only su prod):** delta dati = **0** — 0 permessi mancanti, 0 eccessi, 0 ruoli custom, 0 orfani su tutti i 6 ruoli materializzati × 4 tenant. `tavoli.*` già presente su ogni Super Admin → il 403 è chiuso a livello dati dal re-seed additivo. Ancore: 60 permessi, 11 template (tutti `isDefault`), 245 role_permissions.
- **Decisione (Pattern 43):** nessun sync correttivo senza consumer reale. Il valore del sync è preventivo/forward, non correttivo: nessun tenant via API esiste → nessun drift attivo.
- **Meccanismo idempotenza accertato** (per quando servirà): upsert additivo su `role_permissions` PK `(role_id, permission_id)`; scrittura via `DIRECT_URL`/postgres (`roles` è RLS FORCE, app role non vede cross-tenant); Super Admin enumerato esplicito da includere.
- **Debito reale registrato** (3 TD coesi, trigger comune = verticale first-class #4 / primo tenant API): **TD-perm-propagation**, **TD-bootstrap-verticale**, **TD-role-template-key** (vedi HANDOFF + ADR-0060).
- **Chore:** allineati i commenti stale sui conteggi template/permessi (`tenants.service.ts`, `seed.ts`, e2e `rbac-permissions`) — solo commenti, nessun cambio logica. **GATE ADR-0052: N/A** (nessun FE/BE/DB/migration).

---

## [2026-07-01] Branding per-verticale build-time — pattern riusabile ([ADR-0061](docs/architecture/ADR-0061-branding-per-verticale-build-time.md)) (#145)

Task #4 (ultimo dei 4 aperti il 2026-06-30): i due verticali dicevano entrambi "Gestionale", zero logo. Ora hanno brand distinti, con un pattern che paga il prossimo verticale.

- **Pattern:** tipo `BrandConfig` in `packages/ui` (type-only, runtime-zero) + **istanza per-app disaccoppiata** (`apps/*/src/lib/brand.tsx`): `StudioDesk` (accountant), `FoodDesk` (restaurant, segnaposto). Nessuna app importa il brand di un'altra → aggiungere un verticale = una sola istanza brand, non clonare login/shell.
- **Asset placeholder via codice:** wordmark SVG in `currentColor` (light+dark) + favicon-tile a colore fisso. Sostituibili nello stesso path senza altri cambi.
- **Cablaggio simmetrico (8 punti UI):** `metadata.title`/`applicationName`/`icons` + login `CardTitle` (→ `brand.Logo`, titolo **i18n** `auth.login.title` "Accedi a {brand}", brand come param fuori dal catalogo) + Sidebar header + Topbar mobile. Effetto collaterale corretto: **login restaurant portato a next-intl** (prima hardcoded, namespace `auth` assente) → parità i18n con accountant.
- **Dimensioni tenute separate:** V (brand verticale, build-time) ≠ T (logo del singolo studio, ADR-0049, NON cablato sul login) ≠ Θ (dark, invariato). Palette `globals.css` non toccata.
- **Verticale strutturale per scelta:** nessun dato `vertical`, nessuna migration. Il verticale-dato nascerà col trigger dei 3 TD di ADR-0060 (primo tenant via API).
- **GATE ADR-0052 completo (FE live):** CHECK-FE 1–6 tutti ✅ con evidenza reale (render Playwright login light/dark/mobile, `next build` entrambe, parità i18n, a11y `role="img"`+accessible name). 3 asserzioni e2e aggiornate nello stesso commit.

---

## [2026-07-01] Hotfix cambio lingua — route Next fuori da `/api/*` ([ADR-0062](docs/architecture/ADR-0062-no-next-route-under-api.md)) (#146)

Bug: in prod, loggato come operatore, il cambio lingua IT→EN non faceva nulla. **Diagnosi (discriminante empirico):** NON ruolo-specifico (Super Admin e Collaboratore rotti identici; il cliente non ha lo switcher sul portale) — è **generale e prod-only**. La route Next `POST /api/set-locale` cadeva in `handle /api/*` di Caddy → backend NestJS (prefix `api/v1`) → **404** (`E_NOT_FOUND`) → `setLocale` `res.ok=false` → cookie `NEXT_LOCALE` mai scritto → UI resta IT. Invisibile in dev (no Caddy). Vale su **entrambi** i verticali.

- **Fix (asse: route mal-posizionata, non infra):** spostata `app/api/set-locale/` → `app/set-locale/` (path top-level `/set-locale`, fuori da `/api/*`) in accountant + restaurant; client `@gestionale/i18n` → `fetch('/set-locale')`; middleware matcher esclude `set-locale$` (anchor di segmento, non prefisso — verificato `/set-locale-foo`→404).
- **Contratto eseguibile (ADR-0062):** guard CI `scripts/check-no-api-next-routes.sh` (job checks) fallisce se compare una route sotto `apps/*/src/app/api/**`, con messaggio che spiega il **perché** (Caddy ingoia `/api/*` → usa path top-level). Rende auto-enforced il contratto same-origin di ADR-0042.
- **Regression guard:** mini-e2e switcher `locale-switcher.spec.ts` (restaurant) — click lingua → `POST /set-locale`=200 → cookie → UI cambia. Ambito dichiarato: copre la logica switcher, **non** la classe prod-routing (dev no Caddy) → quella è chiusa dal guard CI + verifica prod.
- **Verifica dev:** `POST /set-locale` → 200 + `Set-Cookie NEXT_LOCALE` (entrambe); `/api/set-locale` → 404. GATE: `next build` ×2 ✅; FE-1/2/3/5/6 N/A (nessuna UI/stringa nuova); BE N/A. **Deploy prod** (rebuild web ×2, Caddy intatto) = step separato con verifica reale.
- Commit split: `fix(i18n)` / `chore(ci)` (guard) / `docs`.

---

## [2026-07-01] FE-5 drag-persist mappa tavoli + utente Direzione food + tiering STOP-gate ([ADR-0063](docs/architecture/ADR-0063-tiering-stop-gate.md) / [ADR-0064](docs/architecture/ADR-0064-seed-utente-per-ruolo-food-fe5.md))

Chiuso il buco storico **FE-5**: il drag-drop della mappa sala (F2, ADR-0058) non era mai stato esercitato a livello browser (contract API coperta da `tables-crud #4` + `tables-rbac`, ma il pointer-event reale → PATCH no; deferito in #138). Radice: il seed dev assegnava a ogni utente food **solo** Super Admin → nessun non-super con `tavoli.gestisci` con cui provare il gating runtime.

- **Tiering STOP-gate (ADR-0063):** il workflow STOP-gate diventa tiered per rischio. Tier ALTO (live/config-condivisa/migration/security/irreversibile) = STOP-gate pieno; tier BASSO (additivo+idempotente+coperto-da-CI+reversibile) = round-trip singolo, STOP solo a `gh pr create`. GATE invarianti in entrambi. Default in dubbio → alto. Questo task è **tier BASSO**.
- **Seed (ADR-0064):** `seedDevDirezione(demo)` → `direzione@demo.local` (ruolo `Direzione`, non-super, `tavoli.visualizza`+`tavoli.gestisci`), clone del template come `seedDevCollaboratore`; `seedDevTavoli(demo)` → 2 tavoli demo (idempotenti su `numero`+tenant). `seedDevTenant`/Super Admin **non** toccati.
- **Copertura FE-5:** `restaurant-web/e2e/mappa-drag-persist.spec.ts` — login `direzione@demo.local` → assert controlli gestione (`canManage===true`) → drag reale `page.mouse` → `PATCH /tables/:id` 200 → reload → posizione persistita. Handle: `data-testid` su canvas + token (solo attributi test).
- **DB isolato (mitigazione TD-dev-env-punta-prod):** tutto il mutante girato su Postgres 16 throwaway (`gestionale_test_pg`, porta 55432, volume effimero) con `DATABASE_URL`/`DIRECT_URL` inline; prod `food.studiodesk.cloud` mai toccata (annullerebbe il purge #143).
- **TD candidate registrati (ADR-0064):** (a) `seedDevTenant` assegna solo Super Admin (buco strutturale); (b) **TD-dev-env-punta-prod** — `.env` dev → DB prod, rischio sistemico, fix fuori scope.
- **Tier BASSO — GATE self-check:** baseline BE e2e verde (70 pass/4 skip); permessi = **60** (array/DB count); `db:seed` ×2 idempotente; `migrate deploy` verde (CHECK-DB-1); spec FE-5 verde in isolamento + suite; PATCH 200 + persistenza; `next build` verde (CHECK-FE-4); FE-1/2/3 N/A (solo `data-testid`); CHECK-BE-1 non regredito.
- Commit split: `docs(adr)` ADR-0063 / `feat(seed)` / `test(restaurant-web)` / `docs(adr)` ADR-0064 + PROGRESS.

## [2026-07-01] Triage TD residui accountant (ex-ADR-0044) → [ADR-0065](docs/architecture/ADR-0065-triage-td-residui.md)

Micro-PR **solo-docs** (tier BASSO, ADR-0063): nessun codice/schema/seed/permesso toccato. Una verifica empirica read-only (STOP 0 cross-codebase) ha riclassificato i tre TD residui nati da ADR-0044, chiudendo la voce generica "TD residui accountant".

- **TD-documenti-tipo-codice → DEFERRED (trigger-gated):** `DocumentoTipo` funziona a `nome`, 0 consumer di un codice macchina; trigger = fase 6C (questionari), **assente in codice**.
- **TD-utente-enum-forward → DEFERRED (trigger-gated, security-sensitive):** portale cliente (ADR-0046) live con ACL per-ruolo (`VisibilitaDocumento {tutti, azienda}`); targeting per-utente mai richiesto → non si tocca enum condiviso né ACL live `clienteWhere`.
- **TD-storage-gc → BACKLOG OPS ATTIVO:** soft-delete-keeps-file intenzionale, ma orfani reali; GC = sottosistema cron da costruire, cancellazione irreversibile, tier alto. Nessuna urgenza dimostrata.
- Esito: 2 deferred-con-trigger (riattivazione automatica quando il consumer comparirà in codice) + 1 backlog ops esplicito. Tutti e tre tier alto: nessun fix meccanico. HANDOFF `Tech debt aperti` aggiornato.

## [2026-07-01] Blocco COMANDE PR-1 — fondamenta dati aggregato Conto ([ADR-0067](docs/architecture/ADR-0067-modello-aggregato-conto.md))

Primo sotto-blocco della sequenza food **Comande → KDS → Cassa pre-fiscale → RT differito**. Tier **ALTO** (nuovo aggregato + migration su `schema.prisma` condiviso + RLS tenant), STOP-gate pieno. PR-1 = **solo fondamenta dati** (no endpoint, no permessi): endpoint + enforcement `comande.*` → PR-2, FE pagina comande → PR-3.

- **Aggregato 2 livelli `Conto` (testata) → `ContoRiga` (riga)**, `contoId` non-null. La **Comanda (KDS) è differita**: aggancio additivo futuro `comandaId` nullable — PR-1 non predispone.
- **`Conto`** tenant-scoped come `Tavolo` (no FK Tavolo→Sede; `sedeId` futuro additivo nullable con trigger): `tavoloId` nullable (asporto/delivery), `channel` (riusa enum food), `coperti` nullable, `stato StatoConto{aperto,chiuso,annullato}`, `apertoIl`/`chiusoIl`, soft-delete.
- **`ContoRiga` snapshot pricing (DP-C):** `nomeArticolo`/`prezzoUnitario`/`reparto` congelati dall'`Article` all'ordine, colonne indipendenti (verificato: modifica dell'Article sorgente non muove la riga).
- **`createdBy` ASSENTE** — coerenza col pattern food (Menu/Article/Tavolo non lo hanno; unico è Documento accountant). Deviazione consapevole dal prompt (citava createdBy a memoria); "verifica il pattern, non inventare". Additivo nullable se servirà.
- **RLS FORCE su entrambi i model** + soft-delete. Isolamento **esercitato** (non solo scritto): spec `conti-rls-isolation.e2e-spec.ts` come ruolo `gestionale_app` non-superuser, 8 casi che tentano la violazione cross-tenant e falliscono chiuso (read vuoto, update→P2025 con vittima intatta, insert `tenantId` altrui bloccato da WITH CHECK) + soft-delete invisibility (CHECK-BE-2) + snapshot independence.
- **Forward dichiarato (rimando [ADR-0021](docs/architecture/ADR-0021-soft-delete-rls-tx-escape-fix.md), non TD nuovo):** `.delete()` su plain client sotto RLS → P2025 (rewrite delete→update fuori dalla tx RLS); il path service `withTenantContextAtomicTx`+`tx.update({deletedAt})` arriva in PR-2. Test PR-1 valorizza `deletedAt` via `update()` e verifica l'invisibilità.
- **Migration solo su DB throwaway** (Postgres 16, porta 55432, volume effimero, `DATABASE_URL` inline): `.env` prod intoccato, container prod invariati pre/post. Catalogo permessi resta **60**.
- Commit split: `feat(db)` aggregato+migration+RLS / `test(db)` isolamento+soft-delete / `docs(adr)` ADR-0067 + PROGRESS.

## [2026-07-01] Blocco COMANDE PR-2 — operatività (endpoint + RBAC + pricing) ([ADR-0068](docs/architecture/ADR-0068-operativita-comande.md))

Modulo `conti` (restaurant-api) sopra l'aggregato di PR-1. Tier **ALTO** (mutazioni + RBAC + audit su schema/permessi condivisi), STOP-gate pieno. **Nessuno schema/migration**, **nessun permesso nuovo** (li *enforce* → catalogo resta **60**), no FE (→PR-3), no AI (blocco separato).

- **Resolver prezzo-per-canale (D2):** `channel → PriceList attivo → ArticlePrice ∨ basePrice`. **Fail-fast `E_PRICE_AMBIGUOUS` (409)** se ≥2 listini attivi collidono sul canale (modello+service non lo impediscono). Core puro `resolveUnitPrice` (6 unit test) + `PricingService`. Snapshot congelato (prezzo/nome/reparto) provato a livello dati (muto `articles`+`article_prices` via SQL → riga invariata).
- **`TD-pricing-multilistino`:** `priority`/finestre validità dormienti (non usate dal resolver), riattivazione trigger-gated su dati multi-listino reali.
- **RBAC (D4):** `comande.crea`→apri; `comande.modifica`→aggiungi/modifica riga + chiudi/annulla; `comande.elimina`→storno; `comande.visualizza`→GET. **`comande.stato.cambia` = orfano intenzionale** (semantica KDS "cucina/bar", trigger = blocco KDS — in attesa, non dimenticanza).
- **Coerenza canale↔tavolo (D3, nel service):** `cassa ⇒ tavolo obbligatorio`, altri ⇒ assente → `E_CONTO_CHANNEL_TAVOLO_MISMATCH` (400). **State machine (D5):** `aperto → {chiuso, annullato}` terminali; mutazioni su non-aperto → `E_CONTO_NOT_OPEN` (409). Distinzione 400 (input) / 409 (stato) applicata con criterio.
- **Soft-delete storno** via service (`tx.update({deletedAt})`, path ADR-0021 — forward di PR-1 chiuso). Totale conto derivato in read (mai persistito, YAGNI).
- **Nota tecnica `TenantTx`** (`common/tenant-tx.type.ts`): `Prisma.TransactionClient` base non è assignabile al tx del client esteso (soft-delete aggiunge `forceDelete`); `Omit<ExtendedPrismaClient, metodi-top-level>` condiviso tra service collaboratori dentro un tx. Pattern riusabile dai moduli food futuri.
- **GATE-1 esercitato:** 6 unit + **16 e2e** (`comande.e2e-spec.ts`) con RBAC reale — ogni guardia *tentata* (pricing ambiguo, cassa senza tavolo→400, addRiga su conto chiuso→409, demo sui conti acme→404, storno invisibile+fisicamente presente, audit-in-tx).
- Commit split: `feat(restaurant)` resolver / `feat(restaurant)` modulo conti / `test(restaurant)` e2e / `docs(adr)` ADR-0068 + PROGRESS.

## [2026-07-02] Blocco COMANDE FE PR-1 — core comande (FE + filtro GET /conti)

Primo FE del blocco COMANDE, consumer del BE #151/#152 (ADR-0067/0068). Sequenza FE in 2 PR: **PR-1 = core comande** (questa), **PR-2 = integrazione tavoli**. **Nessuno schema/migration, nessun permesso nuovo** (catalogo resta **60**). Split per rischio: commit BE (tier ALTO) isolato dal commit FE (tier BASSO).

- **BE — filtro opzionale `GET /conti` (tier ALTO):** `ListContiQueryDto` (`?stato=` `@IsEnum(StatoConto)`, `?tavoloId=` `@IsString` — `id` è cuid/uuid, non `@IsUUID`); `list(tenantId, filters?)` costruisce il `where` condizionalmente. **Backward-compat provata:** STEP 0 ha confermato la firma reale (`findMany({where:{tenantId}, orderBy apertoIl desc})`, nessun filtro preesistente); 4 e2e (no-param/stato/tavoloId/combinati) verdi. Il test 400 su `?stato=` invalido è `it.skip` (**TD-BS Sub-2** — ValidationPipe non esercitabile in harness E2E, come articles/menus); constraint coperto da `list-conti.query.dto.spec.ts` (unit 6/6).
- **FE — `lib/conti-api.ts` + tipi:** stampo di `menu-api`, **normalizzazione Decimal→number** nei mapper wire→dominio (`prezzoUnitario`, `totale`); la UI non vede mai la stringa raw. `listConti` non mappa (il `Conto` flat non espone Decimal — il totale vive solo in `getConto`).
- **FE — pagina `/comande`:** lista conti aperti (`listConti stato=aperto`) + apertura conto inline **solo canali non-cassa** (asporto/delivery/menu_online — `cassa`+tavolo → PR-2). **La lista NON mostra il totale per conto** (assente dal serializer del `Conto` flat): scelta corretta per PR-1, il totale si vede entrando nel conto. Totale-in-lista, se servisse, → estendere il serializer BE del `Conto` flat in PR-2 (**non** N fetch).
- **FE — vista `/comande/[contoId]`:** righe add/edit-quantità/storno, totale, chiudi/annulla con conferma; **sola lettura** se conto non aperto. **`E_PRICE_AMBIGUOUS` reso come blocco sul singolo articolo** (opzione `disabled` + avviso dedicato), non toast generico. Picker articoli composto dagli endpoint esistenti (`menu→categorie→articoli`).
- **🆕 TD-articles-flat-endpoint** (ID verificato non collidente con TD-AW/TD-pricing-multilistino/TD-tavolo-stato-forward/TD-BS Sub-2): il picker fa fetch a cascata O(N) (`listMenus`→`listCategories`→`listArticlesByCategory`), che degrada con la scala. **Trigger:** primo consumer aggiuntivo di lista-articoli (KDS o Cassa) — che allora crea l'endpoint flat *una volta per tutti* — oppure catalogo reale oltre soglia categorie. Nessun fix ora (non inventare l'endpoint sul singolo consumer).
- **RBAC FE inline** (`comande.visualizza/crea/modifica/elimina`), gate UX (i permessi sono oggi orfani → verificato che il gate nasconde le azioni senza crashare). Error code mappati in `error-codes.ts` (tutti `E_CONTO_*`, `E_PRICE_AMBIGUOUS`, `E_TAVOLO_NOT_FOUND`, `E_AUTH_INSUFFICIENT_PERMISSIONS`); i18n namespace `comande` (it/en). GATE FE verdi (typecheck/lint/build).
- Commit split: `feat(restaurant-api)` filtro GET /conti / `feat(restaurant-web)` conti-api + pagine comande (+ PROGRESS).

## [2026-07-09] Registrazione TD-rbac-tavolo-write-subset (docs-only, STOP 0 read-only) → [ADR-0058](docs/architecture/ADR-0058-tavoli-mappa-sala-f2.md)

Micro-PR **solo-docs** (tier BASSO): nessun codice/schema/seed/permesso toccato. Uno STOP 0 read-only sul precursor KDS ha riclassificato il residuo di test della scrittura-posizione-tavolo.

- **🆕 TD-rbac-tavolo-write-subset** (ID verificato non collidente): il path RBAC **negativo** su un tenant reale — ruolo con **sottoinsieme** di permessi che riceve un `403` (corretto o indebito) dal `PermissionsGuard` su `PATCH /tables/:id` — non è mai stato esercitato. **Trigger:** primo ruolo non-admin creato su un tenant restaurant reale. Tier BASSO (verifica runtime). Dipendenza esplicita: si attiva insieme a `TD-bootstrap-verticale` (i ruoli clonano i template cross-verticale).
- **#138 è chiuso da FE-5 (2026-07-01, sopra), non è un pending aperto:** in questo file compare solo nella narrativa di chiusura FE-5. Nessuna rimozione fatta. Il residuo riclassificato è **RBAC, non RLS**: `app.is_super_admin` (SET LOCAL di `rls.ts`) è costante `false` in ogni entrypoint JWT (`true` solo da `withSystemContext`/`withSuperAdminContext`, seed/bootstrap) → l'RLS sulla scrittura tavolo era già esercitata anche da FE-5 (Direzione non-super, DB throwaway). Dettaglio in ADR-0058 (nota RLS-vs-RBAC).
- Commit: `docs(adr)` ADR-0058 + PROGRESS.

## [2026-07-12] Registrazione TD-ci-e2e-testcontainers-be (docs-only) → [ADR-0071](docs/architecture/ADR-0071-ci-e2e-testcontainers-be-non-gated.md)

Micro-PR **solo-docs** (nasce da una scoperta sul pipeline durante #163, non dallo storno). **La e2e testcontainers di `restaurant-api` (`comande.e2e-spec` ecc.) NON gira in CI**: il job "Lint·Typecheck·Format·Test" fa `turbo run test` = `--project=unit`; il job Playwright fa `test:e2e:ci` = `playwright test` (solo FE). Nessuno step invoca `vitest run --project=e2e` del BE.

- **🆕 TD-ci-e2e-testcontainers-be** (ID collision-checked, 0 occorrenze): il **comportamento** di comande/conti (pricing, RBAC, state machine, storno, feed, isolamento, audit) è validato **solo in locale** → una regressione comportamentale non verrebbe colta dalla CI. Vale retroattivamente per #158/#161/#163 (test e2e BE eseguiti solo in locale). **Severità ALTA** (sicurezza-di-regressione su superficie live). **Trigger:** prossima sessione dedicata (non "quando capita" — degrada ogni CI-verde futuro su restaurant-api). **Fix:** serve un Postgres nel runner per testcontainers; il job Playwright ne ha già uno → agganciare la e2e BE lì o dargliene uno dedicato (STOP 0 a sé). Distinto da TD-BS (ADR-0019, "ValidationPipe non gira nell'harness"): qui l'harness e2e BE non gira affatto in CI.
- Fino al fix: chi tocca comande/conti esegue la e2e BE in locale e lo dichiara nello STOP 2 ("validato in locale, non in CI").
- **Sotto-obiettivo assorbito ([2026-07-22], ex-`TD-CB`):** oltre al *comportamento* comande/conti, in CI non è esercitato l'**enforcement RLS DB-level come `gestionale_app`** — la suite e2e api gira da **superuser DB** (bypassa RLS), quindi i test "isolation" (`menu-tenant-isolation`, `soft-delete-rls`, `tenant-consistency`, `rls-isolation`) validano l'isolamento *applicativo*, non quello *DB-level*. Mitigazione attuale: `smoke:rls-core` (core-only) in CI. **Stesso trigger/fix** di questo TD (Postgres nel runner + suite api come `gestionale_app`) → chiuderà entrambi i fronti. Chiude l'orfananza di TD-CB.
- Commit: `docs(adr)` ADR-0071 + PROGRESS.

## [2026-07-15] Sync log — blocco restaurant #155–#165 (feature mai loggate) + deploy prod

Colmata la lacuna emersa nel preflight HANDOFF: PROGRESS copriva solo fino a #154; #159/#164 erano registrazioni docs-only; il blocco feature intermedio (KDS / vat / storno / portata) non era mai entrato nel log. Sync **sintetico**, una riga per feature con cross-link — la ricostruzione narrativa vive negli ADR.

- **#155** — integrazione TAVOLI↔COMANDE: un-tavolo-un-conto + apertura conto dalla mappa sala ([ADR-0068](docs/architecture/ADR-0068-operativita-comande.md)).
- **#156** — KDS PR-1: attivazione layer Comanda (invio per reparto, feed KDS, transizioni, immutabilità righe inviate) ([ADR-0069](docs/architecture/ADR-0069-attivazione-layer-comanda.md)). `comande.stato.cambia` **non è più orfano** (qui trova il consumer).
- **#157** — KDS PR-2: vista conto con invio comande + note riga.
- **#158** — fix: trim e normalizzazione `empty→null` su note riga conto.
- **#160** — auth-refresh FE single-flight (401 → refresh → retry) su **entrambi** i verticali; consolidate 21 `authOptions()` in helper condiviso. Merged `ebce256`, e2e Playwright CI verde. Residuo aperto: **`TD-blob-download-no-refresh`** (3 blob-download accountant fuori da `request()`, mai fatto).
- **#161** — semantica prezzi lordi + snapshot `vatPercent` su `ContoRiga` ([ADR-0070](docs/architecture/ADR-0070-prezzi-lordi-snapshot-aliquota-riga.md)). Sblocca la Cassa pre-fiscale.
- **#162** — warning coperti oltre capienza tavolo (FE restaurant-web).
- **#163** — storno riga **inviata** (flag distinto `stornata`, feed marcato, audit-perdita); riusa `comande.elimina`, nessun permesso nuovo.
- **#165** — portata/corso (raggruppamento) su `Article` + snapshot su `ContoRiga` (enum `Portata` nuda, no backfill; BE non riordina).

**Deploy prod (verificato 2026-07-15, docker/DB):** restaurant `web`/`api` a `167cb3d` (build 07-14, marker `stornoInviata`+`portata` nel bundle); DB prod = **32 migration**, ultima `add_portata`. Accountant ridistribuito **10/07** per #160 (~main@10/07, post-#160 pre-#161), non fermo al cutover. Catalogo permessi invariato = **60**. 10 tag `:rollback-*` vivi. Dettaglio in [HANDOFF](docs/handoff/HANDOFF.md).

## [2026-07-22] `TD-blob-download-no-refresh` chiuso — blob/multipart accountant sotto single-flight refresh

Completamento naturale di #160: i 5 `fetch` raw di accountant-web (3 download blob + 2 upload multipart) bypassavano l'interceptor → a token scaduto (15 min) fallivano con 401 silenzioso (i consumer fanno `.catch(() => undefined)`, failure invisibile). Branch `fix/blob-download-auth-refresh`, 4 commit, **non ancora mergiato**.

- **Commit 1 — `feat(api-client)`:** nuovi verbi `apiGetBlob` (→ `Blob`) e `apiPostMultipart<T>` (→ JSON) sopra un core interno `fetchWithAuthRetry` che replica la SOLA decisione 401→refresh→retry di `request()` ritornando la `Response` grezza. **`request()` NON toccato** (diff = solo aggiunte, verificato). 6 test nuovi che esercitano il retry (non solo l'happy path); 15 test api-client + 18 auth-web esistenti verdi invariati.
- **Commit 2 — `refactor(accountant-web)`:** migrati i 3 file (`comunicazioni-api` / `documenti-api` / `portale-documenti-api`) ai nuovi verbi. Rimossi 5 `fetch` raw + 3 `API_BASE` locali + header `Authorization` manuali (ora da `authOptions()`). Save-bundle browser resta nel call-site; firme pubbliche FE e consumer invariati. GATE: typecheck+lint+build accountant-web verdi, `grep fetch( accountant-web = 0`.
- **Sub-1 (§7 rev.2) — `test(accountant-web)`:** e2e route-mocked `blob-auth-refresh.spec.ts` (+ `playwright.blob.config.ts`, webServer `next dev` :3013, **no BE/DB**). 3 scenari (download refresh→retry con evento `download` reale; upload multipart+boundary su entrambi i tentativi; refresh fallito → no loop, token ripuliti). **9/9 verde** `--repeat-each=3`, deterministico. Runbook: `pnpm --filter accountant-web test:e2e:blob`.

**TD registrati:**
- **`TD-blob-retry-duplication`** (nuovo) — la decisione 401→refresh→retry vive ora in 2 punti: `request()` (ramo JSON) e `fetchWithAuthRetry` (ramo `Response`). Scelta deliberata per non toccare il path critico condiviso di entrambi i verticali in questo fix. **Trigger:** prossima modifica sostanziale alla logica retry/refresh (semantica theft-detection, backoff, 2° retry) → unificare `request()` sopra `fetchWithAuthRetry` come single source, con GATE sui test interceptor. **Tier riattivazione:** ALTO.
- **`Sub-2`** (dentro **`TD-dev-env-punta-prod`**) — la verifica **full-stack** dei 5 path blob/multipart contro BE reale è rinviata: sull'host non esiste un DB dev isolato (unico Postgres = prod-shared) e §7 vieta prod; l'upload è una mutazione. **Trigger:** esistenza di un dev env con DB isolato → eseguire login reale + download/upload + assert `/auth/refresh` singola lato BE (pattern del test-3 restaurant-web `auth-refresh-single-flight.spec.ts`). Nel frattempo Sub-1 (route-mocked) copre il runtime FE reale.

**Nota CI:** `blob-auth-refresh.spec.ts` **non gira in CI** — il job `e2e-playwright` esegue solo `apps/restaurant-web`. Segnalato, non forzato (l'infra e2e accountant-web non è CI-gated per scelta pregressa). Girabile on-demand. Registrato come **`TD-ci-e2e-accountant-web-fe`** (tier riattivazione MEDIO; trigger = prossimo intervento sull'infra CI e2e → aggiungere `accountant-web` al job Playwright). Analogo FE di `TD-ci-e2e-testcontainers-be`.

---

## [2026-07-22] `TD-dev-env-punta-prod` / Sub-A — guard anti-prod-da-host (meccanismo, non disciplina)

Un solo Postgres sull'host, condiviso prod+dev (`127.0.0.1:5432/gestionale`). Il near-incident: un dev server lanciato da host eredita il `.env` root e punta al DB **prod** con `NODE_ENV`≠production. Fermato solo da auto-correzione manuale, nessun guard. Sub-A trasforma la difesa da disciplina a guard meccanizzato. Branch `fix/db-prod-guard`, 3 commit, **MERGED** (#168, main @ `28d2b81`).

- **Commit 1 — `feat(db)`:** funzione **pura** `assertSafeDbTarget(url, ctx)` (nuovo `packages/db/src/assert-safe-db-target.ts`) + `ProdDbAccessBlockedError`. Match su **host:porta:db** (`{127.0.0.1|localhost}:5432/gestionale`), ignora user/password → copre sia `DATABASE_URL` (app-role) sia `DIRECT_URL` (superuser). Inerte se `NODE_ENV=production` o `ALLOW_PROD_DB_ACCESS=1`; url malformata → no-op (non è compito del guard validarla). Wired in `createPrismaClient()` **prima** di istanziare il client (nient'altro toccato nel factory). **9 test puri** (nessuna connessione): near-incident, whitelist, container prod, normalizzazione localhost + default-port, Testcontainers, dev-env-isolato futuro (Sub-B, porta diversa), db diverso, url malformata.
- **Commit 2 — `fix(db)`:** `purge-tenant.ts` (client diretto su `DIRECT_URL`, non passa dalla factory) chiama il guard esplicitamente sull'url effettivo. I **5 wrapper** di manutenzione host-run legittima (`db:seed`, `smoke:rls-core`, `smoke:rls-e2e`, `smoke:soft-delete`, `purge-tenant`) prefissati con `ALLOW_PROD_DB_ACCESS=1` → passano il guard via `pnpm`, abortano se lanciati "nudi". Prefisso inline (host Linux); `cross-env` non introdotto (non in uso).
- **GATE:** 9 nuovi test + suite db esistente (3) verdi invariati (12/12); typecheck + lint verdi. **Verificato (non assunto):** il vitest config di `packages/db` inietta `localhost:5432/**test**` (db `test`≠`gestionale`) → guard inerte al require-time del singleton. **Nessuno script eseguito contro prod.**

**Scope chiuso da Sub-A:** il **vettore** del near-incident (factory + `purge-tenant`). **Non** l'intero TD: resta **Sub-B** (dev env con DB isolato), che sbloccherà anche **Sub-2** (verifica full-stack blob/multipart contro BE reale). La verifica runtime end-to-end del guard (vederlo abortire davvero) appartiene a Sub-B, dove è osservabile senza rischio prod.

**TD registrato:** **`TD-prisma-studio-prod-unguarded`** (tier BASSO-MEDIO) — `prisma studio` è Prisma CLI, non attraversa `createPrismaClient()` → fuori dal guard; editor visuale su prod resta apribile da host. Trigger + opzioni in [HANDOFF](docs/handoff/HANDOFF.md).

**Nota di rettifica (V5 del preflight):** in STOP 0 avevo segnalato come "anomalia" che le web-app FE condividessero `gestionale_network` con Postgres, in apparente contrasto con `reference_web_network_isolation`. **Rettifica verificata:** quella memoria riguarda la rete docker **esterna** `web` (host hobby di terzi), non il tier FE del gestionale; postgres/API sono confinati a `gestionale_network` e la rete `web` contiene solo i container hobby + `gestionale_caddy` (l'unico ponte, by design). La memoria è **corretta**, non stale — la V5 era un mio misread. **Nessuna correzione doc dovuta.**

---

## [2026-07-22] `app.is_super_admin` (flussi JWT / RLS) — verificato **non-bug** (STOP 0 read-only) + fold TD-CB

Preflight read-only su una segnalazione «bug `app.is_super_admin` nei flussi JWT». **Esito: non-bug.** Nessuna modifica al codice — solo verifica statica + registrazione. L'ipotesi di partenza (pooling-leak da `SET` session-level che persiste su connessione poolizzata → un utente normale eredita il bypass RLS di un super-admin precedente) è **smentita punto per punto**. Sintesi a verbale:

1. **Non è un claim JWT.** Il payload è minimale — `sub` / `tenantId` / `sessionId` / `type` ([jwt-payload.interface.ts](packages/auth/src/auth/interfaces/jwt-payload.interface.ts)); nessun claim `isSuperAdmin`/`roles`. Il "Super Admin" del seed è un **ruolo RBAC applicativo** (bundle di permessi), disaccoppiato dal bypass RLS (già in [ADR-0058 §Nota RLS-vs-RBAC](docs/architecture/ADR-0058-tavoli-mappa-sala-f2.md)).
2. **GUC con `SET LOCAL` in tx interattiva, stesso scope di `tenant_id`.** L'extension RLS wrappa ogni op in `$transaction` e fa `SET LOCAL app.tenant_id` + `SET LOCAL app.is_super_admin` ([rls.ts:370-372](packages/db/src/rls.ts#L370-L372)); tenant e super_admin usano lo **stesso** scope LOCAL (nessuna asimmetria). `SET LOCAL` è resettato da Postgres a commit/rollback → **nessuna persistenza cross-request**. Nessun `SET` nudo (session-level) in codice di produzione (l'unico è in un e2e e imposta `'false'`).
3. **`isSuperAdmin = false` costante in tutti e 5 gli entrypoint del request-path JWT:** [tenant.middleware.ts:71](packages/auth/src/tenant/tenant.middleware.ts#L71), [jwt.strategy.ts:58](packages/auth/src/auth/strategies/jwt.strategy.ts#L58), [permissions.guard.ts:102](packages/auth/src/rbac/guards/permissions.guard.ts#L102), [tenant-context.interceptor.ts:52](packages/auth/src/context/tenant-context.interceptor.ts#L52), [auth.service.ts:275](packages/auth/src/auth/auth.service.ts#L275). `true` **solo** server-side via `withSystemContext`/`withSuperAdminContext` (seed/bootstrap/script). L'unico path cross-tenant runtime (`platform.service`, `withSystemContext`) è gated a **doppio strato**: `@UseGuards(PlatformGuard)` (tenant == `oneplatform`, fail-closed se env mancante) **+** `@RequirePermissions('sistema.tenant.gestisci')` ([platform.controller.ts:37](apps/accountant-api/src/platform/platform.controller.ts#L37)).
4. **Policy default fail-closed.** Predicato `current_setting('app.is_super_admin', true) = 'true' OR tenant_id = current_setting('app.tenant_id', true)`; `missing_ok=true` → GUC non settata ritorna **NULL** → `NULL = 'true'` → NULL (non-true) → nega. Anche i raw query (`$queryRaw`/`$executeRaw`, che bypassano l'extension) leggono default NULL → RLS attiva + `tenant_id` vuoto → **vedono nulla, non tutto**.

**Conclusione:** su questo asse il sistema è **fail-closed e sicuro**; nessun leak cross-tenant. La voce "bug `app.is_super_admin`" è **chiusa come non-bug**.

**Fold TD-CB → TD-ci-e2e-testcontainers-be.** L'unico residuo emerso non è un leak ma un **gap di copertura CI**: in CI la suite e2e api gira da **superuser DB** (bypassa RLS), quindi l'enforcement **DB-level** come `gestionale_app` non è esercitato (mitigato solo parzialmente da `smoke:rls-core`, core-only). Era tracciato come **TD-CB**, orfano. **Assorbito** come **sotto-obiettivo esplicito** dentro **`TD-ci-e2e-testcontainers-be`** (ADR-0071) — vedi [2026-07-12] annotato. **Trigger di quel TD invariato** (prossima sessione dedicata: Postgres nel runner). TD-CB non più autonomo → non resta orfano.

- Commit: `docs` (PROGRESS + HANDOFF), zero file di codice toccati.

---

## [2026-07-23] `TD-dev-env-punta-prod` CHIUSO — Sub-B (dev env isolato) + 2 discovery a runtime

Sub-B completa il TD: Sub-A (guard meccanizzato, #168) + Sub-B (ambiente dev isolato dev-by-default) = `TD-dev-env-punta-prod` **risolto**. Residuo aperto solo **Sub-2** (verifica full-stack blob/multipart contro BE reale), ora **eseguibile**. Branch `feat/dev-db-isolated`, PR unica.

**Cosa fatto:**
- **DB dev isolato** ([`docker-compose.devdb.yml`](docker-compose.devdb.yml)) STANDALONE, project name `gestionale-devdb` (mai nel merge prod): container `gestionale_postgres_dev` + volume `postgres_dev_data` + porta `127.0.0.1:55432` + rete `gestionale_devdb_network` dedicata, credenziali dev ≠ prod. `55432 ≠ 5432` → guard Sub-A non matcha (difesa in profondità intatta).
- **Env injection dev-by-default** senza toccare `.env` root: `.env.devdb` committato (solo i 2 url dev, zero segreti prod) + script `dev` delle 2 API con `dotenv -e ../../.env.devdb -e ../../.env`. **Verificato empiricamente** (micro-check Commit 1) che dotenv-cli fa vincere il **primo** `-e`; una var già in `process.env` e `-v` vincono a loro volta → i 2 url dev vincono, il resto (JWT/SMTP/…) cade sul `.env` root intatto. Inversione: **dev-by-default, prod richiede intenzione**.
- **Script** `devdb:up/down/migrate/seed/setup` + `verify:guard-runtime`. `devdb:seed` **non** forza `ALLOW_PROD_DB_ACCESS` (footgun evitato: dev non ne ha bisogno, e il flag mascherrebbe un mistargeting).
- **GATE passato**: `devdb:setup` idempotente → 32 migrazioni + 4 tenant seedati; **login HTTP reale** `studio-demo` (`admin@studio.local`) contro il DB dev → 201 con `accessToken`. Prod (`gestionale_postgres`) mai toccato.

**Discovery #1 (runtime) — init app-role rotto → fix `fix(infra)` (tocca infra condivisa prod).** [`01-create-app-role.sh`](infra/postgres/init/01-create-app-role.sh) falliva al cold-boot: `:'app_db_password'` era **dentro** un blocco `DO $$…$$` e psql non interpola `:var` nel dollar-quoting → `syntax error at or near ":"` → il role veniva poi creato dalla migration con **`PLACEHOLDER_MUST_BE_ROTATED`** → seed auth-fail. **Fix**: interpolazione fuori dal DO block (`format(…, %L) … WHERE NOT EXISTS \gexec`, idempotente) + **fail-loud** (post-check → `exit 1` se il role manca, così un init rotto non passa più inosservato). **Impatto cross-verticale**: `infra/postgres/init` è condivisa; **prod running non impattato** (init inerte su volume di 3 settimane); il fix ripara il **bootstrap fresco** per entrambi i verticali (dev ora, ricostruzione volume prod futura) → da bug latente di disaster-recovery a bootstrap affidabile. Verificato via login `gestionale_app`/pw-dev su **TCP-over-bridge (scram)**, non loopback-trust.

**Discovery #2 (runtime) — Sub-A era INERTE a runtime sull'host fino a questo rebuild (correzione sostanziale alla narrazione).** Alla chiusura di Sub-A avevamo messo a verbale *"il near-incident è ora un guard meccanizzato, non disciplina"*. **Nel sorgente TS e nei 9 unit test era vero; a runtime sull'host era falso.** I dev server importano il **`dist` buildato** di `packages/db`, non il src; il `dist` sull'host era del **2026-07-14 (pre-Sub-A, #168 mergiato il 15/07)** e **non conteneva** `assertSafeDbTarget`. Quindi **per tutta la finestra tra il merge di #168 e questo rebuild il near-incident era ancora possibile sull'host** — il guard non c'era dove contava. Verificato empiricamente: prima del rebuild l'API partiva e **tentava il connect a prod:5432**; dopo `pnpm --filter @gestionale/db build` il guard **aborta** (`ProdDbAccessBlockedError`) prima di qualunque connessione (0 connessioni `guard_probe` su prod).

A chiudere il cerchio: **è stata la verifica runtime — quella che avevo io stesso rinviato a Sub-B — a rivelarlo.** Il rinvio, giustificato come ragionevole, ha significato che il guard è rimasto inerte più a lungo. **Lezione di sistema (verificato vs promesso): test verdi sul sorgente TS non provano il comportamento a runtime host quando in mezzo c'è un artefatto compilato (dist). Il GATE non prova la sicurezza — l'avevamo scritto, ora l'abbiamo vissuto.**

**🆕 TD-db-dist-stale-runtime** (collision-checked: 0 occorrenze) — **tier MEDIO.** Ogni protezione runtime che vive in `packages/db` è reale sull'host **solo se il `dist` è fresco**: l'host esegue il compilato, non il sorgente. Dati che fissano il tier: (a) `verify:guard-runtime` gira **solo on-demand** (non in CI, non in pre-commit); (b) root `pnpm dev` (`turbo`) ricostruisce via `dependsOn: ["^build"]` (mecanizzato), ma **`pnpm --filter <api> dev` diretto no** (nessun `predev`) — ed è il path più comune e la forma stessa del near-incident; (c) prova che il gap è reale e già noto: `.github/workflows/ci.yml` (commento a ~riga 253 + `pnpm --filter … build` esplicito prima di `pnpm dev`) lo aveva già colpito e tamponato localmente senza generalizzarlo. **Mitigazione già in essere:** Sub-B rende **dev-by-default** (target 55432) → anche con guard inerte, colpire prod richiede un override esplicito di `DATABASE_URL` **più** un dist stale. **Trigger (mecanizzare, così il gap non ricorra):** o un `predev` che builda `packages/db` sugli script app, o risoluzione di `@gestionale/db` al **sorgente TS** (conditional exports `development` / tsconfig paths) per i dev server, o agganciare `verify:guard-runtime` alla CI/pre-commit. Prod containers non impattati (build in Docker + `NODE_ENV=production` → guard inerte by design). Lo script `verify:guard-runtime` (check[0]) cattura la regressione "guard assente nel dist". Runbook README aggiornato con l'avvertenza build-currency.

**Lezione (senior empirical re-validation):** una lettura consolidata non è verità eterna. STOP 0/1 avevano letto i *commenti* dell'init ("crea il role con la pw reale") e dato per **attivo** il guard; il runtime — abilitato proprio da Sub-B — ha smentito **entrambi**. Il DB dev isolato è lo strumento di verifica che mancava. Convenzione catturata in [ADR-0072](docs/architecture/ADR-0072-dev-db-isolated-and-init-conventions.md).

**Prossimo:** Sub-2 (full-stack blob/multipart contro BE reale) ora eseguibile — login reale + download/upload + assert `/auth/refresh` singola lato BE, contro il DB dev.

---

## [2026-07-23] Sub-2 verificato full-stack → `TD-dev-env-punta-prod` ESTINTO

Ultimo fronte di `TD-dev-env-punta-prod`: verifica **full-stack contro BE reale** dei 5 path blob/multipart di accountant-web dopo scadenza dell'access token (il boundary lasciato aperto dal blob-fix, che Sub-1 route-mocked non poteva coprire). Reso possibile da Sub-B (dev env isolato). **Verifica, non implementazione** → artefatto = solo questo verbale (harness effimero, non committato).

**Metodo (fedele):** eseguito il **codice REALE FE** — `apiGetBlob`/`apiPostMultipart` di `@gestionale/api-client` + il single-flight **reale** `authOptions`/`refreshAccessToken` di `auth-web` (import da sorgente via `tsx`, shim `window`/`localStorage`) — contro il **BE reale** (`accountant-api` dev → DB dev 55432, storage filesystem, RLS fedele `gestionale_app` NOBYPASSRLS). Scadenza simulata via **invalidazione client-side** dell'access token (bogus) mantenendo il refresh valido (sanzionato dalla spec; TTL è costante hardcoded, non env). Tenant `studio-demo`, utenti seed noti.

**Esito — 5/5 path + single-flight, tutti PASS:**

| # | Funzione FE | Endpoint BE | Esito | `/auth/refresh` | Evidenza |
|---|---|---|---|---|---|
| #5 | `uploadDocumento` | POST `/documenti` | completato | **1** | persistito in dev DB |
| #2 | `downloadDocumento` | GET `/documenti/:id/download` | completato | **1** | 47 byte, match esatto |
| #4 | `uploadAllegato` | POST `/comunicazioni/messaggi/:id/allegati` | completato | **1** | persistito in dev DB |
| #1 | `downloadAllegato` | GET `/comunicazioni/allegati/:id` | completato | **1** | 46 byte, match esatto |
| #3 | `downloadPortaleDocumento` | GET `/portale/documenti/:id/download` | completato | **1** | 47 byte, match esatto (ruolo **cliente**) |
| — | single-flight (2 concorrenti) | GET download ×2 | completato | **1** | coalescing, entrambi match |

- **Refresh trasparente confermato sul BE reale**: per ogni path, access scaduto → 401 → **una sola** `/auth/refresh` (rotazione + theft-detection reali) → retry con il **nuovo** token → 200/201. Nessun path in cui il BE reale **rifiuti** il token refreshato (era l'unico esito che avrebbe aperto un fronte-bug: non si è verificato).
- **Persistenza reale sotto RLS fedele**: upload #4/#5 scritti e riletti nel DB dev come `gestionale_app` (non superuser). Download byte-identici al contenuto caricato (round-trip storage→BE→FE verificato).
- **Single-flight sotto latenza vera** (valore aggiunto vs Sub-1, non gate): 2 download concorrenti a token scaduto → **1** sola `/auth/refresh` (il coalescing `refreshInFlight` regge col BE reale, la rotazione e la latenza). Coerente con unit + e2e #160.
- **Prod mai toccato**: API su 55432, harness interroga `gestionale_postgres_dev`; `gestionale_postgres` (prod) intatto.

**Caveat (portata esatta, non gonfiata):** (1) l'harness gira via `tsx` con shim `window`/`localStorage`, **non in un browser**: è il codice FE reale (`apiGetBlob`/`apiPostMultipart`, `authOptions`, `refreshAccessToken`) → fedeltà **alta sull'asse auth**, ma non è un browser (quell'asse resta coperto da Sub-1 route-mocked + il save DOM `createObjectURL`/click, estraneo all'auth/BE, non esercitato qui). (2) La scadenza è **invalidazione client-side** dell'access token, **non attesa del TTL reale** (costante hardcoded, non env): sanzionata dalla spec ed equivalente sul path 401→refresh→retry, ma **non esercita l'espirazione lato server** (il BE rigetta un token malformato, non un token scaduto-ma-valido-in-firma). Differenza minore, dichiarata.

**Chiusura boundary → `TD-dev-env-punta-prod` completamente ESTINTO.** I tre fronti chiusi: Sub-A (guard meccanizzato, #168) + Sub-B (dev env isolato dev-by-default, #171) + **Sub-2 (questa verifica full-stack)**, che era l'ultimo trigger residuo. Con Sub-2, anche `TD-blob-download-no-refresh` è verificato end-to-end contro BE reale (oltre a Sub-1 route-mocked + unit). Nessun residuo.

- Commit: `docs` (PROGRESS + HANDOFF), zero codice.

---

## [2026-07-23] CI gate RLS dominio (Fase 1) + blob FE + discovery bit-rot

`TD-ci-e2e-testcontainers-be` **Fase 1**: chiuso il fronte **fedeltà RLS DB-level sul dominio**. Tier MEDIO (solo CI + config test; nessun codice applicativo, migrazione, prod). Branch `ci/e2e-rls-domain`.

**Cosa fatto:**
- **Nuovo job CI `e2e-rls-domain`** (ubuntu-latest, Docker host — non nel container Playwright): esegue **solo** i 3 spec che asseriscono l'isolamento tenant **DB-level come `gestionale_app`** (NOBYPASSRLS) — `conti-rls-isolation`, `comande-rls-isolation`, `soft-delete-rls` — via Testcontainers dedicati (**DP-2**, no riuso service-DB Playwright). Script `test:e2e:rls` con selezione **esplicita** (verificato: esattamente 3 file, 23 test). Una regressione di policy RLS su comande/conti ora **rompe la CI**.
- **DP-3 hardening**: `APP_ROLE_PASSWORD` da env `TEST_APP_ROLE_PASSWORD` (default = placeholder). Comportamento invariato; il pattern non si rompe se il substrato ruota la pw.
- **Nessun refactoring fixture**: le fixture **restano** superuser (TRUNCATE non concesso all'app-role; INSERT cross-tenant respinti da WITH CHECK); il pattern "setup superuser + assert app-role" esisteva già.
- **Job FE additivo `e2e-accountant-web-blob`**: `blob-auth-refresh.spec.ts` (route-mocked, `next dev` :3013, no BE/DB). Chiude `TD-ci-e2e-accountant-web-fe`. Escluso `page-tour.spec.ts` (infra full-stack). Verificato locale: 3 test PASS ~13s.

**Discovery — bit-rot `conti-rls-isolation` (la tesi del TD materializzata):** `seedContoFor` non passava `vatPercent`, reso `Int` required senza default dal #161 (ADR-0070) → `PrismaClientValidationError` in `beforeEach` → 8/8 rossi. **Mai intercettato perché la e2e BE non gira in CI.** Fixato (1 riga, `vatPercent: article.vatPercent`; unico campo mancante). È l'argomento più forte a favore del gate: uno spec RLS era rotto e invisibile.

**Prova di efficacia (il gate non è teatro):** forzato bypass RLS in `rls.ts` (`is_super_admin=true`) + rebuild → `comande`+`conti-rls-isolation` **ROSSI** (9 test: acme legge/muta/crea righe di demo); `soft-delete-rls` verde (assert intra-tenant, non sensibile a questo vettore). Ripristinato + rebuild → **23/23 verdi**; `git status` pulito.

**Residuo registrato (ADR-0071 Update):** **Fase 2** = copertura comportamentale completa restaurant-api (13 spec, ~136 test) in CI — trigger = `globalSetup` Vitest con container **condiviso** (oggi per-file, 16 coppie = costo strutturale). Boundary: **`TD-ci-e2e-accountant-api`** (20 spec fuori CI, tier MEDIO, stesso trigger `globalSetup`). Non orfano.

- Commit: `test` (hardening+bit-rot) · `ci` (job RLS) · `ci` (job blob FE) · `docs`.

---

## [2026-07-23] KDS board Fase 1 — nucleo funzionale (ciclo cameriere→cucina chiuso)

Il blocco KDS/FE comande: lo STOP 0 aveva disambiguato lo stato — flusso **cameriere costruito e in CI**, board KDS **placeholder da 5 righe**, feed BE (`GET /comande` + `PATCH /comande/:id/stato`) **orfano**. Fase 1 consuma i 2 endpoint e rende la cucina operativa. Tier MEDIO (solo restaurant-web + wrapper API). Branch `feat/kds-board`. [ADR-0073](docs/architecture/ADR-0073-kds-board-fase-1.md).

**§0 prerequisito (read-only):** permessi `comande.visualizza`/`comande.stato.cambia` esistono (catalogo **60**), ruolo template **`Cucina/Bar`** li ha già; Super Admin entrambi. **Nessun tocco al seed** → nessuna superficie condivisa.

**Cosa fatto (4 commit):**
- **`comande-api.ts`**: `listComande` + `cambiaStatoComanda` sopra `@gestionale/api-client` + `authOptions()`. **Zero fetch raw** (invariante restaurant-web preservata, grep=0). Tipi `Comanda`/`ComandaFeedRiga` derivati dalla risposta **reale** del BE; `PORTATA_ORDER`/`REPARTO_ORDER` (ordine di servizio).
- **Board `kds/page.tsx`** (sostituisce il placeholder): colonne per **reparto**, righe per **portata** in ordine di servizio, card con tavolo + badge stato + note cameriere evidenziate; loading/errore/coda-vuota; tipografia grande/contrasto alto (display a muro). Refresh **polling** (`usePollingRefresh`, 8s, DP-1; SSE deferito trigger invariato). i18n namespace `kds` (it+en, parità).
- **Avanzamento forward-only**: pulsante → `cambiaStatoComanda(id, next)` (`STATO_NEXT`, subset in-avanti). **UI ottimistica + rollback** via layer `pending`; **anti-race** polling↔ottimistica: le override `pending` vincono nel render sopra il feed pollato → un refresh in volo non regredisce uno stato appena avanzato; override pulita a conferma (refetch) o errore (rollback). Gating su `comande.stato.cambia`.

**Verifica runtime (dev env Sub-B, DB dev 55432, mai prod):** flusso cameriere reale (conto tavolo 1 → 3 righe cucina+pizzeria → invia) → board mostra **2 comande split per reparto** (cucina: antipasto+primo; pizzeria: secondo), note evidenziate; ciclo avanzamento `Avvia`→`In preparazione`→`Pronta` → la comanda pronta **esce dal feed** (BE la esclude), l'altra resta. Zero errori pagina. Verificato via Playwright headless one-off (effimero, non committato).

**Fase 2 residua (trigger, ADR-0073):** kiosk layout route group `(kiosk)/` (DP-2), segnale storno passivo sulla board (righe `stornata` già nel wire), e2e Playwright KDS in CI, SSE (trigger invariato).

- Commit: `feat` (api wrapper) · `feat` (board) · `feat` (avanzamento) · `docs`.

---

## [2026-07-23] PR-0 Note Spese — gate E2E domain RLS esteso ad accountant

Prerequisito di **Note Spese** (STOP 0 di ri-validazione: la spec regge, unico aggiustamento sostanziale = il gate RLS oggi è restaurant-only). PR-0 = **infra CI, non feature**. Tier MEDIO (solo CI + script test). Branch `ci/e2e-rls-accountant`. [ADR-0071 Update](docs/architecture/ADR-0071-ci-e2e-testcontainers-be-non-gated.md).

**§0 censimento:** accountant-api ha **1** spec RLS DB-level app-role — `rls-isolation.e2e-spec.ts` (10 test, anagrafica ADR-0035); `documenti-download-isolation` è IDOR/HTTP superuser (comportamentale, escluso). Selettore N=1.

**Cosa fatto:**
- **Job CI `e2e-rls-domain-accountant`** (gemello di `e2e-rls-domain`, ubuntu-latest, Testcontainers dedicati): esegue lo spec RLS accountant come `gestionale_app` (NOBYPASSRLS). Una regressione di policy RLS su tabelle accountant ora **rompe la CI**. Script `test:e2e:rls` accountant (selezione esplicita, verificato: esattamente 1 file, 10 test). **DP-3 hardening** `APP_ROLE_PASSWORD` da env+default (allineato al gate restaurant, no costante hardcoded duplicata). Job restaurant **invariato**.
- **Nessuna bit-rot** nello spec RLS accountant (a differenza di `conti` su restaurant): 10/10 verdi baseline.

**Prova di efficacia (obbligatoria, DP-3):** rotta la policy `preventivi_voci` (`USING true`) nella migration → il testcontainer la applica fresh → **S-prev-4 ROSSO** (raw-query DB-level come `gestionale_app`: tenant B legge 4 voci invece di 2, leak cross-tenant). Ripristinato → **10/10 verdi**, `git status` pulito. **Nuance vettore:** su accountant il break efficace è la **policy** (non l'extension `rls.ts` come su restaurant), perché i test HTTP di `rls-isolation` sono anche app-filter-protected (`where:{tenantId}`, defense-in-depth) → solo il raw-query S-prev-4 esercita puramente la policy. Il gate è comunque efficace.

**Bit-rot trovata (fuori scope, comportamentale):** `report-margine.e2e-spec.ts` 2 test rossi (200 vs 201, guard <2 mandati) — non RLS, non fixata, tracciata sotto `TD-ci-e2e-accountant-api`.

**Residuo:** le ~17 spec comportamentali accountant restano fuori CI (`TD-ci-e2e-accountant-api`, trigger `globalSetup` invariato). La porzione **RLS** è ora gatata su entrambi i verticali. Note Spese potrà nascere il suo spec di isolamento **dentro** questo gate.

- Commit: `test` (selettore+hardening) · `ci` (job) · `docs`.

---

## [2026-07-23] Note Spese v1 PR-1 — schema + fondamenta (accountant)

Prima feature del blocco Note Spese. **Tier ALTO** (DDL su schema Prisma unico condiviso, prod live di entrambi i verticali). Solo fondamenta: schema + migrazione + permessi + gate RLS; **nessun service/endpoint/FE** (PR successive). Branch `feat/note-spese-schema`. [ADR-0074](docs/architecture/ADR-0074-note-spese-pr1-schema.md) + [spec persistita](docs/spec/note-spese-v1.md).

**Blocco risolto a STOP 1**: la spec viveva solo in chat; ricostruita e **persistita** in `docs/spec/note-spese-v1.md` (Commit 0) — fonte autoritativa. §4-§7 (regole business complete, API/service, 14 test) **non recuperate** → PR-2 bloccata finché non lo sono.

**Cosa fatto (6 commit):**
- **Schema** (D1-D7): 2 modelli (`NotaSpesa`/`note_spese`, `NotaSpesaAllegato`/`note_spese_allegati` child) + 6 enum suffissati + back-relations additive su User (autore+approvatore)/Azienda/Mandato. D1 (no `@default`), D2 (`@@map` plurale), D5 (hard-delete, no `deletedAt`). Diff 100% additivo (136 ins, 0 del).
- **Migrazione** `add_note_spese`: additiva pura — **DDL ispezionato, zero ALTER su tabelle esistenti**. RLS template corrente (TEXT, USING-only, FORCE su entrambe, no `::uuid`, no GRANT espliciti). Applicata su dev Sub-B (55432): `pg_policies` + `relforcerowsecurity=t` verificati. **Mai su prod.**
- **Permessi 60→63**: 3 `notespese.*` nell'array. PIN verificato empiricamente: **63 = PERMISSIONS.length**, **59 = Super Admin (63−4 portale)**. Commenti "60" aggiornati. **STOP**: assegnazione a ruoli NON-admin non nella spec → non decisa (solo array editato).
- **Gate RLS**: `note-spese-rls-isolation.e2e-spec.ts` nel selettore accountant (N=1→**N=2**). **Solo raw-query DB-level** (PR-1 senza service; e il gate deve esercitare la policy, non il filtro app — discovery PR-0). Copertura lettura+scrittura, entrambe le tabelle. **Prova di efficacia** (vettore policy): rotta policy `note_spese` → S1(READ)+S3(WRITE) rossi → ripristino 15/15 verdi.

**Impatto altro verticale: verificato** — additivo puro; back-relations su `User` (shared) sono relazioni inverse, nessuna colonna/ALTER; nessuna interferenza con tabelle/policy restaurant.

**Residuo (per PR-2):** recuperare §4-§7 da `MT_Accountant_S18`; sciogliere l'assegnazione permessi a ruoli non-admin; implementare D6 (mismatch mandato/azienda, analogo `documenti.assertAzienda`).

- Commit: `docs`(spec) · `feat(db)`(schema) · `feat(db)`(migration RLS) · `feat(db)`(permessi) · `test`(gate) · `docs`(ADR).

---

## [2026-07-23] Note Spese v1 PR-2 — CRUD + allegati/storage (accountant)

Secondo blocco Note Spese, consumer delle fondamenta PR-1. **Tier MEDIO** (modulo accountant-only, **nessuno schema/migrazione**). Modulo NestJS CRUD + allegati/storage; **la state machine (invia/approva/respingi) è PR-3**. Branch `feat/note-spese-api`. [ADR-0075](docs/architecture/ADR-0075-note-spese-pr2-crud-storage.md) + [spec](docs/spec/note-spese-v1.md).

**Blocco risolto a STOP 1**: §4-§10 della spec (regole business, storage, API, 14 test, split) — non recuperate a PR-1 — **ricostruite e persistite** (Commit 0). Assegnazione permessi a ruoli non-admin (aperta a PR-1) **decisa**.

**Cosa fatto (6 commit):**
- **Spec §4-§10** persistita in `docs/spec/note-spese-v1.md` — fonte autoritativa per PR-2/PR-3/FE.
- **Ruoli (role template)**: `notespese.gestisci` → Collaboratore + Direzione; `notespese.leggi_tutte` + `notespese.approva` → Direzione; Cliente → nessuno. Solo template Direzione/Collaboratore editati (admin-tier eredita via `ALL_PERMISSION_CODES`). **GATE seed**: `smoke:rls-core` + `rbac-permissions` **invariati** (nessun test aggiustato); PIN **63/59** confermato.
- **Modulo CRUD** (`NoteSpeseModule`): 5 endpoint (POST/GET lista/GET :id/PATCH/DELETE), gated `notespese.gestisci`. Scoping `leggi_tutte` **non bypassabile** (query `userId` ignorato senza il permesso, via `UsersService.hasPermission`). **D6** hard-fail su create+update (mandato/azienda mismatch, mandato tenant-scoped). Ownership + load-then-authorize (404 no-leak); update solo `{bozza,respinta}`, delete solo `bozza` (D5). `id: id()` app-side.
- **Allegati/storage** (`StorageService` astratto, ADR-0043): 3 endpoint `/note-spese/:id/allegati`. Allow-list MIME (pdf/jpeg/png/webp) al fileFilter **E** nel service; `mimeType` persistito = verificato. Download load-then-authorize (accetta l'id, mai lo `storageKey`). `@@unique(tipo)` → 409 + orphan cleanup del file. Delete allegato = row + `storage.delete` **stessa tx**; delete nota = cascade + cleanup file storage.
- **Test §7 (9, fase PR-2)** `note-spese-security.e2e-spec.ts`: 1,2,3(HTTP 404),9,10,11,12,13,14 — **service-level** dal DI container (vettore = filtro applicativo). **9/9 verdi**; gate RLS PR-1 ri-eseguito **invariato 5/5**.
- **Docs**: ADR-0075 + PROGRESS + HANDOFF.

**Impatto altro verticale: verificato** — nessuno schema/migrazione; unica modifica `packages/db` = re-export additivo dei 6 enum + 2 tipi Note Spese in `src/index.ts` (nessun cambiamento comportamento restaurant). Tutto il resto accountant-only. `StorageModule` già in uso.

**Residuo (per PR-3):** state machine (invia/approva/respingi) + auto-approvazione + gating giustificativo/scontrino, con i 5 test residui §7 (4,5,6,7,8). FE = PR-4/5 (§8).

- Commit: `docs`(spec §4-§10) · `feat(db)`(role template) · `feat(accountant-api)`(CRUD) · `feat(accountant-api)`(allegati+storage) · `test`(security) · `docs`(ADR).

---

## [2026-07-23] Note Spese v1 PR-3 — state machine + gating (accountant)

Terzo e ultimo blocco backend Note Spese: macchina a stati (invia/approva/respingi) + gating §4.1/§4.2, sopra il CRUD di PR-2. **Tier MEDIO** (accountant-api only, **nessuno schema/migrazione/seed**). Branch `feat/note-spese-state-machine`. [ADR-0076](docs/architecture/ADR-0076-note-spese-pr3-state-machine.md) + [spec](docs/spec/note-spese-v1.md).

**STOP 0 (read-only) — 3 verifiche prima di scrivere:** (1) §7.8 già enforced da PR-2 (`assertOwnEditable`/delete gated) → **nessun buco**, il test verifica; (2) le macchine a stati esistenti (comande/circolari) usano read-then-write → **non** il modello di concorrenza (DP-3 lo vieta); (3) **divergenza segnalata**: spec persistita §4.3 dice `respinta → bozza`, DP-1 lockato dice `respinta → inviata` → procedo con DP-1, reversibilità in ADR.

**Cosa fatto (3 commit):**
- **State machine** (3 endpoint HTTP 200): `bozza|respinta → inviata → approvata|respinta`, `approvata` terminale. `invia` = gestisci + **autore** (ownership nel service, non-leak 404); `approva`/`respingi` = `notespese.approva`. **Auto-decisione vietata** su approva **e** respingi (auto-rifiuto = estensione oltre il testo, dichiarata). `respingi`: motivo obbligatorio (DTO + guard service-level). **DP-2**: re-invio da respinta azzera `decisaAt`/`decisaDaId`/`motivoRifiuto`.
- **Gating §4.1/§4.2** letti nella **stessa tx** della transizione: giustificativo se `totale>0`, scontrino POS se pagamento carta.
- **Concorrenza (DP-3)**: `updateMany` con stato atteso nel `WHERE` + check `count` dentro `withTenantContextAtomicTx` — race chiusa dalla condizione di update, non dalla lettura (fast-fail precondizione per l'errore corretto). Opzione primaria DP-3; comande/circolari (read-then-write) segnalati come debito non in scope.
- **Errori distinti** (FE): `INVALID_TRANSITION` (409) / `GIUSTIFICATIVO_MANCANTE` / `SCONTRINO_MANCANTE` / `AUTO_DECISIONE` (422) / `MOTIVO_RICHIESTO` (400).
- **6 test** `note-spese-state-machine.e2e-spec.ts` (§7: 4,5,6,7,8 + T15 su DP-1/DP-2): **6/6 verdi**. Suite PR-2 (security 9/9 + gate RLS 5/5) **invariata**. Totale Note Spese: **15**.

**Impatto altro verticale: N.A. verificato** — nessun tocco a `packages/db`/platform/seed/schema/migrazioni; tutto in `apps/accountant-api`.

**Residuo:** FE = PR-4/5 (§8: calendario/elenco, form con hint validità, pannello approvazione gated `notespese.approva`). **La migrazione Note Spese (PR-1) è su `main` ma non ancora in produzione** — si applica al prossimo deploy (tracciato in HANDOFF, anti deployment-drift).

- Commit: `feat(accountant-api)`(state machine) · `test`(6 test) · `docs`(ADR-0076 + PROGRESS/HANDOFF).

---

## [2026-07-24] Note Spese v1 PR-3a + PR-4 — allegati nei read path + UI operatore

Primo **frontend** del blocco Note Spese (`accountant-web`), preceduto da una micro-PR BE emersa nello STOP 0. **Tier MEDIO**. Branch `fix/note-spese-read-allegati` (#179) e `feat/note-spese-web`. [ADR-0077](docs/architecture/ADR-0077-note-spese-pr4-ui-operatore.md).

**STOP 0 → blocco reale riportato, non aggirato:** i read path BE non esponevano gli allegati e non esiste un `GET` lista allegati → badge "giustificativo/scontrino mancante" (§8), indicatore presenza in riga (§2) e vista/download allegati di una nota già salvata erano **infattibili**. Riportato con opzioni; scelta A → **PR-3a** (#179, mergiata): `getById` include allegati completi, `list` li include leggeri `{id,tipo}`, ordine deterministico, **mai `storageKey`**; 3 test (incl. assert sull'**assenza** della chiave e cross-tenant sull'include) + 20 esistenti invariati.

**PR-4 (4 commit):**
- **Client API** sopra `@gestionale/api-client`, allegati via `apiPostMultipart`/`apiGetBlob`: **invariante "nessuna chiamata HTTP raw" preservata** (grep = 0). Wire→domain nel client, verificato sul BE reale (`totale` arriva stringa, `data` ISO, il POST non include allegati).
- **Viste**: toggle calendario ↔ elenco, navigazione mese (DP-4), totali mese/giorno, stati vuoti. **Calendario costruito da zero** (non esisteva, nessuna dipendenza date aggiunta): lunedì-first, UTC, giorno senza note distinto da giorno a zero. Layout due colonne da 860px, **nessun container fisso 480px**; sotto 860px stack (DP-3).
- **Form + allegati**: upload separati con hint **inline**, sola lettura su inviata/approvata, `motivoRifiuto` in evidenza, **D6 prevenuto a monte** (mandato determina l'azienda), warning non bloccanti. **Compressione client-side da zero**: 1280px + JPEG q0.7, solo immagini, fallback sull'originale.
- **i18n** it/en completo (incl. label enum) + voce sidebar gated. **DP-1..DP-4** registrate come decisioni di interazione **reversibili**.

**GATE runtime su dev Sub-B (mai prod), ruolo NON-superuser, browser reale desktop+mobile:** ciclo completo crea → invia (422 giustificativo) → allega → invia (422 scontrino) → allega → inviata + sola lettura; delete con conferma. Compressione sul dato reale: **PNG 5.26MB → image/jpeg 75.8KB**, PDF invariato.

**Tre difetti trovati dai gate, invisibili al typecheck:** (1) il rifiuto BE su `invia` finiva in unhandled rejection → l'utente **non vedeva nulla**, ora è messaggio a schermo; (2) toggle vista icon-only senza `aria-label` sotto `sm`; (3) `ConfirmDialog` mai montato (import/handler orfani, colto da eslint). Tutti corretti e ri-verificati.

**Impatto altro verticale: N.A. verificato** — PR-3a solo `apps/accountant-api`, PR-4 solo `apps/accountant-web`.

**Residuo:** **PR-5** = pannello approvazione (`notespese.approva`): vista separata, `approva`/`respingi` con motivo.

- Commit: `feat(accountant-api)`(PR-3a) · `feat(accountant-web)`×3 (client, viste, form) · `docs`(ADR-0077).

---

## [2026-07-24] Note Spese v1 PR-5a + PR-5 — autore nei read path + pannello approvazione · **BLOCCO COMPLETO**

Ultimo blocco: la vista di chi **decide**, separata da quella operatore. Preceduta da una micro-PR BE emersa nello STOP 0. **Tier MEDIO**. Branch `fix/note-spese-read-autore` (#181) e `feat/note-spese-approvazione`. [ADR-0078](docs/architecture/ADR-0078-note-spese-pr5-pannello-approvazione.md).

**STOP 0 → secondo blocco riportato, non aggirato:** il payload esponeva solo `userId` (UUID) e l'unica lista utenti del tenant è `GET /tariffe/users`, gated su **`tariffario.gestisci`** — i costi orari del personale, che la Direzione non ha. Il pannello avrebbe mostrato UUID e preso 403; agganciarlo a quel permesso sarebbe stato sbagliato nel merito. Scelta A → **PR-5a**: `list`/`getById` includono `user` e `decisaDa` con **select esplicito** `{id,firstName,lastName}` (mai `email`, assert sull'assenza); 3 test + 23 esistenti invariati.

**PR-5 (3 commit):** rotta separata gated `notespese.approva`; coda default `stato=inviata`; filtri stato/utente/periodo sui query param §6, con **opzioni utente derivate dagli autori in coda** (nessuna nuova superficie BE); dettaglio con allegati scaricabili; **esclusione auto-decisione** (azioni non mostrate, non solo errore gestito); `approva` con conferma (terminale), `respingi` con motivo obbligatorio validato prima dell'invio; refetch dopo la decisione; **stato esplicito se manca `leggi_tutte`** invece di lista vuota muta.

**GATE runtime dev Sub-B, ruolo Direzione NON-superuser** (seed solo dev, mai prod): coda con autore, esclusione auto-decisione, respingi+motivo, **l'autore vede il motivo nella UI operatore** (catena end-to-end fra le due viste), e **race provocata davvero** (nota decisa via API alle spalle → 409 → messaggio esplicito). Zero pageerror.

**Difetto trovato dal GATE, della famiglia che la spec vietava di ampliare:** l'errore dell'azione veniva scritto in `loadError` e **cancellato un istante dopo** dal refetch (`load()` azzera `loadError`) → il rifiuto BE spariva prima di essere letto. Il `try/catch` c'era: **nessun grep l'avrebbe trovato**. Stato `azioneError` separato. → `TD-fe-errori-silenziati` va inteso più largo: include gli errori *sovrascritti da un reload*, non solo i catch vuoti.

**Debito di metodo:** il primo GATE stava per dare un falso segnale — processi `accountant-api` **orfani** servivano codice antecedente a PR-5a mentre il server nuovo non riusciva a bindare. Contromisura: verificare un **marcatore della modifica più recente** nel server in esecuzione prima di fidarsi di un GATE runtime. Stessa famiglia di `TD-db-dist-stale-runtime`.

**Impatto altro verticale: N.A. verificato.**

**Note Spese v1 è completa**: schema (#176) + CRUD/storage (#177) + state machine (#178) + allegati read (#179) + UI operatore (#180) + autore read (#181) + approvazione. Residui del blocco: **deployment-drift** (migrazione + re-seed + tag rollback al prossimo deploy), `TD-fe-errori-silenziati`, `TD-state-machine-read-then-write`, deferral Client Portal/OCR con trigger invariati.

- Commit: `feat(accountant-api)`(PR-5a) · `feat(accountant-web)`×2 (pannello, azioni) · `docs`(ADR-0078).

---

## [2026-07-24] PR-A preflight deploy S19 — storage persistente + provenienza immagini ([ADR-0079](docs/architecture/ADR-0079-storage-persistente-provenienza-immagini.md))

Primo dei prerequisiti alla finestra di deploy S19. **Nessuna migrazione, nessun seed, nessun build verso produzione**: chiude due difetti infrastrutturali emersi dal preflight, entrambi indipendenti dal codice applicativo.

**Difetto 1 — gli allegati non sopravvivevano al recreate.** `STORAGE_LOCAL_ROOT` non era valorizzata da nessuna parte e nessun servizio dichiarava `volumes:` → root effettiva `/app/apps/accountant-api/var/storage`, cioè il layer scrivibile del container. **Perdita già avvenuta**: 1 riga `documenti` + 3 `comunicazioni` su prod puntano a blob inesistenti dal recreate del 10/07. Note Spese portava il difetto da latente a strutturale (il giustificativo è dato fiscale non ricostruibile). Chiuso con `mkdir` nel Dockerfile + `STORAGE_LOCAL_ROOT` letterale nel compose di prod + named volume `gestionale_storage_data`. Solo `accountant-api`: `restaurant-api` non usa `StorageModule` (verificato).

**Difetto 2 — nessuna immagine dichiarava il commit di origine.** `docker inspect` mostrava solo le label `com.docker.compose.*`; l'unica provenienza era una convenzione di tagging manuale mai applicata alle immagini accountant. Chiuso con `ARG GIT_SHA` + label OCI sui quattro Dockerfile e `${GIT_SHA:?…}` nel compose di prod: **un build di produzione senza SHA aborta prima del primo layer**.

**Decisione emendata in corsa (D3).** Il piano prevedeva `chown -R <user>:<group>` prima della direttiva `USER`. La verifica ha smentito la premessa: **nessuno dei quattro runner stage ha `USER`**, tutti girano come root (`uid=0`), benché `node:22-alpine` fornisca `node` uid 1000. Il `chown` sarebbe stato un no-op che comunica un de-privilegio inesistente → rimosso, debito registrato.

**GATE — il verde statico qui non prova nulla** (compose e Dockerfile non sono coperti da test). Tutto contro il **DB dev isolato** `:55432`, stack effimero con project name dedicato, mai il compose di prod né il tag `latest`:
- **G1**: upload → `--force-recreate` (container ID cambiato) → download **HTTP 200, byte-identico** (`cmp` pulito).
- **Controllo negativo** — perché G1 da solo direbbe solo "funziona", non "è il fix a farlo funzionare": stessa immagine configurata come la prod attuale → download **200 prima** del recreate, **500 dopo**, con la **riga DB ancora presente**. Riproduzione esatta della condizione delle 4 righe orfane in produzione.
- **G2**: volume montato, blob presente, probe di scrittura reale con l'uid effettivo. **G3**: label = SHA di HEAD. **G4**: build senza `GIT_SHA` aborta con il messaggio previsto. **G5**: 16/16 typecheck, lint pulito, 15/15 test (196 unit).

**Impatto altro verticale: verificato.** Il PR tocca i Dockerfile di **entrambi** i verticali, quindi la dichiarazione non poteva essere `N.A.`: i tre non-accountant sono stati costruiti con le modifiche applicate. `restaurant-api` resta senza volume perché non usa lo storage. Nessuna modifica a schema, migrazioni, seed o permessi.

**Fuori dal PR, emerso durante la ricognizione:** due processi dev **orfani** sull'host di produzione, spenti in questa sessione dopo forensics read-only — `turbo run dev` da 21 giorni (4× `tsup --watch`; ipotizzato come reperto del quasi-incidente S18, **smentito**: nessuna `DATABASE_URL` in ambiente, nessun listener, nessuna connessione al DB) e `restaurant-api` dev da 26 ore in ascolto su `*:3000` (puntava correttamente al DB dev `:55432`). Registrato come `TD-dev-processes-orphaned-on-prod-host`, **quinta failure-mode strutturale** della famiglia S18. Verifica firewall sulla 3000 in carico a Nicolò (richiede `sudo`).

**Debiti**: `TD-container-runs-as-root` (nuovo) · `TD-storage-backup-blob` (nuovo — il `pg_dump` non copre i blob, e oggi **non esiste alcun backup**, nemmeno del DB) · `TD-storage-gc` (esteso col caso inverso: righe che puntano a blob assenti, lasciate in essere di proposito) · `TD-dev-processes-orphaned-on-prod-host` (nuovo).

- Commit: `fix(infra)`(storage) · `chore(infra)`(label OCI) · `docs(adr)`(ADR-0079).

---

## [2026-07-24] PR-B preflight deploy S19 — seed fail-closed su `NODE_ENV` ([ADR-0080](docs/architecture/ADR-0080-seed-fail-closed-node-env.md))

Secondo prerequisito alla finestra, dopo lo storage di PR-A. Preceduto dall'**OPS backup**: primo dump di produzione mai esistito (`pg_dump -Fc`, 265K, 0,2s) **con ripristino verificato** in container effimero isolato — diff dei conteggi vuoto su 46 tabelle / 1776 righe, RLS 37 tabelle con `FORCE` e 37 policy identiche fra prod e copia, `GRANT` a `gestionale_app` su 46/46 tabelle. Blocco ① sciolto.

**Il difetto.** Il seed decideva su `NODE_ENV !== 'production'`. `NODE_ENV` è assente da `.env` e lo script non la forzava → con la variabile non impostata il seed entra nel ramo **dev** e fa upsert dei tenant `demo`/`acme` con password note (`Admin123!`, `Manager123!`). Quei tenant **esistono già su produzione**: una riesecuzione avrebbe riportato le password ai default.

**Il fix**: `assertValidNodeEnv`, funzione pura, **set chiuso** `{production, development, test}`, **nessun default** — l'assenza aborta, e il confronto è esatto (`prod` e `Production` sono errori, non sinonimi). Il ramo dev è ora espresso in **positivo** (`allowsDevData`): era proprio il `!== 'production'` a lasciar passare la variabile assente.

**La parte non ovvia (D3).** L'abort deve precedere l'istanziazione del client Prisma, che in `packages/db` (ESM) è **eager** all'import di `../src/index`. Gli import sono hoisted, quindi una statement in cima a `seed.ts` girerebbe *dopo*. I moduli importati sono invece valutati nell'ordine di dichiarazione → `seed-preflight.ts` come **primo import**, che importa il modulo guard e non il barrel. **L'ordine di quell'import è il presidio**, ed è il punto fragile della soluzione (annotato).

**Sub-DP risolto empiricamente**: `db:seed` **ha** un consumatore (`ci.yml:241`) → non rinominato. `db:seed` resta con `NODE_ENV=development`, si aggiunge `db:seed:prod`. Verificato leggendo `ci.yml` che togliere `ALLOW_PROD_DB_ACCESS` non rompe la CI (target `postgres:5432/gestionale_test`: host e nome DB entrambi diversi da quelli protetti). **Conseguenza voluta**: `db:seed` non può più colpire il DB di produzione.

**GATE (solo DB dev `:55432`, mai `5432`)**: G1 11 test unitari · **G2** seed senza `NODE_ENV` → `exit=1`, abort in `seed-preflight.ts:31`, e sul DB i contatori **cumulativi** `tup_inserted`/`tup_updated` a **delta 0** — prova che nessuna query è stata eseguita, non solo nessuna scrittura (uno snapshot di `pg_stat_activity` avrebbe potuto mancarla) · **G4 controllo negativo**: pre-fix la stessa invocazione usciva `exit=0` entrando nel ramo dev · G3 `devdb:seed` verde e idempotente · G5 16/16 typecheck, 15/15 test.

**Impatto altro verticale: verificato.** `packages/db` è condiviso, ma il guard vive su un percorso che solo il seed attraversa (`assertValidNodeEnv` ← `seed-preflight.ts` ← `seed.ts`): nessun runtime applicativo lo tocca. Suite verde su entrambi.

**Debito aperto**: `README.md` documenta ancora `db:seed` come setup locale — va allineato al flusso `devdb:*` nel PR docs di chiusura.

- Commit: `feat(db)`(guard) · `chore(db)`(script) · `docs(adr)`(ADR-0080).

---

## [2026-07-25] Deploy S19 ESEGUITO in produzione (Option 2) — runbook [`docs/runbook-deploy-infrastrutturale.md`](docs/runbook-deploy-infrastrutturale.md)

**La finestra di deploy è avvenuta.** Base `main` @ `f7b5d19`. Forma Option 2: infrastruttura + migrazione + permessi, **propagazione ai ruoli esclusa e differita** (ADR-0066). Preceduta da: backup con restore provato (blocco ①), PR-A #184 (`8becc84`), PR-B #185 (`f7b5d19`).

**Sei passi P0–P7, zero scostamenti, zero STOP incontrati:**
- **P0** preflight: 32 migrazioni (gate: non già 33), 0 utenti a dominio reale (gate premessa Option 2), baseline 60/249/245.
- **P1** backup fresco `pre-migrate33_f7b5d19` (`PGDMP`, sha `3d87cd85…`).
- **P2** tag `rollback-pre-s19` sulle 4 immagini, digest verificati coincidenti con le immagini **in esercizio** (non con ciò che `:latest` puntava).
- **P3** `migrate deploy` dall'host (Prisma 6.19.3, `DIRECT_URL` postgres@127.0.0.1:5432) → **→33**, exit 0. Punto di non ritorno.
- **P4 gate schema** (riuscita vs sicura): `FORCE RLS` `t|t` su entrambe le tabelle + `GRANT` `gestionale_app` ereditati. È il controllo che distingue "applicata" da "applicata e sicura" — `relforcerowsecurity` senza cui l'isolamento fra tenant sarebbe apparente.
- **P5** build+rollout con provenienza: 4 label `revision=f7b5d19`, immagini nuove in esercizio (per digest), entrambi i verticali health 200 end-to-end via Caddy. Impatto altro verticale verificato: `tenants`/`users` intatti dopo i lock FK, dati food integri.
- **P6** `db:seed:prod`: 60→63 / 249→262 / **role_perms 245 INVARIATO** + `Dev data: SKIPPED (NODE_ENV=production)` + tenant fermi al 30/06. Firma Option 2 confermata dai due lati.

**I due presidi della sessione hanno tenuto sul vivo nella prima finestra reale.** PR-A (`GIT_SHA`) e PR-B (`NODE_ENV`), nati come risposta a due failure-mode di STOP 0, le hanno chiuse alla prima occasione. La **quarta failure-mode di S18** (deployment drift invisibile) è chiusa sulle 4 label OCI.

**Riconferma ADR-0066**: caratterizzazione tenant (C1–C5, read-only) — nessun cliente reale, propagazione permessi differita. Trigger invariato (primo tenant non well-known via API).

**Resta aperto e differito**: propagazione `notespese.*` ai ruoli → UI Note Spese nascosta (stato voluto). **TD nuovi**: `TD-backup-automation`, `TD-storage-backup-blob`, `TD-container-runs-as-root`, `TD-dev-processes-orphaned-on-prod-host`.

- Docs (questo PR): runbook versionato · HANDOFF (deploy registrato + 4 TD) · README allineato su `db:seed`.

---

## [2026-07-27] Cassa pre-fiscale PR1 — schema + BE ([ADR-0081](docs/architecture/ADR-0081-cassa-pre-fiscale-pr1-pagamenti.md))

**Terzo blocco della sequenza food** Comande → KDS → **Cassa pre-fiscale** → RT differito. PR1 = schema + BE; la cassa FE è PR2, speccata dopo che PR1 è verde. Sblocca lo scorporo che [ADR-0070](docs/architecture/ADR-0070-prezzi-lordi-snapshot-aliquota-riga.md) aveva differito congelando `vatPercent` sulla riga.

**Cosa non esisteva** (STOP 0 read-only): zero concetto di pagamento (nessun importo-pagato/metodo/resto/stato-pagamento), zero scorporo imponibile/IVA, zero movimento cassa. I 4 permessi `cassa.*` erano **seedati e orfani** (0 `@RequirePermissions('cassa.*')` in tutto il codice). `chiudi` era una **pura transizione di stato**: chiudeva un conto da 200 € senza aver incassato nulla.

**Decisioni.** **D1** pagamento = *child table* (1 conto → N pagamenti): lo **split payment è il caso nativo**, il pagamento singolo il degenere N=1 — campi sulla testata avrebbero reso lo split un'eccezione da rimodellare su dati già scritti. Overpay non modellato (`E_PAGAMENTO_EXCEEDS_RESIDUO`), resto contanti concern FE. **D2** nessuno stato-pagamento persistito: `da_pagare/parziale/saldato` derivato — un enum scritto sarebbe un secondo posto dove la verità diverge, e divergerebbe al primo storno. **D4** scorporo derivato + riepilogo IVA **congelato sul `Conto`** alla chiusura (`riepilogoIvaSnapshot`, scritto una volta): l'IVA è proprietà di *cosa* è stato venduto, non di *come* è stato pagato — sul singolo `Pagamento` sarebbe duplicata N volte con l'ambiguità di quale sia quella buona. Invariante `imponibile + iva == lordo` **esatto** per gruppo (`iva` come differenza, non secondo arrotondamento).

**D3 — cambio di contratto deliberato su path live.** `chiudi` ammesso solo se `residuo == 0` **oppure** `totale == 0`, altrimenti `E_CONTO_NOT_SETTLED`; `annulla` resta la via senza incasso. Il permesso **non** si sposta (`comande.modifica`) → l'unica cosa che cambia per un chiamante è la guardia. La seconda clausola **non è ridondante**: lo storno di una riga già pagata manda il residuo in negativo, e con una riga sola il totale torna a 0. **Limite dichiarato** (con test): storno *parziale* di un conto già saldato → `totale > 0`, `residuo < 0` → chiusura bloccata; via d'uscita = storna il pagamento e ri-registra, oppure `annulla`. Non allargato a `residuo <= 0` perché renderebbe chiudibile un conto pagato in eccesso — la condizione che D1 ha deciso di non modellare.

**Blast radius D3 misurato, non stimato.** Baseline pre-modifica catturata (16 file, 147 passed | 5 skipped, exit 0). Degli 11 punti che chiudono un conto, **9 chiudono a totale 0** → invariati; **2 rotti by design** aggiornati con pagamento a saldo (helper `pagaSaldo`) — dove il commento "conto chiuso (pagato)" è ora letterale. **Terzo consumer fuori dalla suite BE**: lo smoke Playwright `comande-flow.spec.ts` chiudeva un conto con totale > 0 dalla UI → passa a `annulla` (l'altra transizione terminale, libera il tavolo = ciò che quello smoke verifica); la variante paga-poi-chiudi diventa uno spec FE in PR2.

**Permessi 63 → 64** (via **lunghezza array**, non `grep -c`): nuovo `cassa.pagamento.registra` su Direzione (32→33) e Cassiere (11→12). **3 dei 5 `cassa.*` non più orfani** (`pagamento.registra`, `storno.esegui`, `visualizza`); `scontrino.emetti` (RT) e `chiusura.giornaliera` (D6) restano orfani **dichiarati con trigger**. Verificato sul DB dev: `SELECT count(*) FROM permissions` → **64**.

**Discovery — TD-BS Sub-2 è più ampio del documentato.** Nel harness E2E **nemmeno i DTO `@Body`** vengono validati (la `ValidationPipe` non riceve `design:paramtypes`): dimostrato sul DTO **pre-esistente** `AddRigaDto` (`quantita: 0` → 201 invece di 400) → limitazione del harness, non regressione di questa PR. Constraint spostati su 11 casi unit (`registra-pagamento.dto.spec.ts`), assert e2e `it.skip` col marker — stesso pattern di `list-conti.query.dto.spec.ts`.

**GATE**: migration applicata su dev DB `:55432` (mai `5432`) e in container fresco; `pagamenti` con `relrowsecurity|relforcerowsecurity = t|t` e policy `pagamenti_tenant_isolation` verificate via `pg_class`/`\d`; typecheck + lint verdi; `nest build --builder swc` 64 file; **e2e 17 file, 175 passed | 6 skipped** (da 16/147/5 → **+28 test**, +1 skip documentato); unit 11 file / 95 test. RLS su `pagamenti` esercitata come `gestionale_app` non-superuser (3 test read/write/WITH-CHECK) — come superuser la policy sarebbe bypassata e non proverebbe nulla.

**Impatto altro verticale: verificato.** `Pagamento`/`MetodoPagamentoConto`/`riepilogoIvaSnapshot` sotto il confine **DOMINIO**; `AuditLog` (CORE) **non toccato** (`action` String libera → le 2 nuove action non richiedono modifiche allo schema); grep a **zero** occorrenze in `apps/accountant-api` e `apps/accountant-web` (soli hit = re-export del barrel). Nessun riuso di `MetodoPagamentoNotaSpesa`: scelta esplicita, domini diversi.

**TD nuovi**: 🆕 `TD-cassa-resto-drawer` (resto contanti / riconciliazione cassetto non persistiti — **trigger:** il cliente chiede la riconciliazione cassetto/fondo cassa) · 🆕 `TD-cassa-chiusura-giornaliera` (sessione cassa / Z-report / fondo cassa, D6 — **trigger:** il pilota chiede il riepilogo di fine giornata).

**Forward**: **PR2 cassa FE** (pannello pagamento, split, storno, riepilogo IVA) — da speccare ora che PR1 è verde. RT/certificazione fiscale differita fino a cliente reale (`cassa.scontrino.emetti` è il segnaposto).

- Commit: `feat(db)`(schema+migration) · `feat(restaurant-api)`(BE+seed+test) · `docs(adr)`(ADR-0081).

---

## [2026-07-27] Cassa pre-fiscale PR2 — FE + contratto `chiudibile` ([ADR-0082](docs/architecture/ADR-0082-cassa-pre-fiscale-pr2-fe-chiudibile.md))

**Chiude il blocco Cassa pre-fiscale**: PR1 aveva schema e BE, la UI era una `PlaceholderPage` di 4 righe e i 3 permessi `cassa.*` enforced non avevano **nessun consumer FE**.

**Cosa mancava** (STOP 0 read-only): il tipo FE `ContoWithRighe` si fermava a `righe`+`totale` → `pagamenti`/`residuo`/`statoPagamento`/`riepilogoIva` arrivavano dal BE ma **non tipizzati e non normalizzati** (`residuo` restava la stringa raw del Decimal); zero funzioni FE per le 3 rotte cassa; **8 error code senza messaggio IT**, fra cui `E_CONTO_NOT_SETTLED` — già raggiungibile dal "Chiudi" di `comande/[contoId]` **dalla PR1**, dove il cambio di contratto D3 arrivava in UI come "Si è verificato un errore. Riprova.".

**D2 — il predicato di chiusura diventa contratto.** `GET /conti/:id` espone `chiudibile`, calcolato da `isChiudibile(totale, pagato)`, la **stessa funzione** che `assertSettled` usa per emettere `E_CONTO_NOT_SETTLED`. Il FE ci lega il bottone e **non lo ricalcola**. L'alternativa (derivare `residuo === 0` in UI) sarebbe stata sbagliata proprio nel caso non ovvio: il conto **sovra-pagato** è `statoPagamento: 'saldato'` ma **non** chiudibile. ⚠️ La divergenza fra `computeStatoPagamento` (`residuo <= 0`) e `isChiudibile` (`isZero()` **stretto**) è **voluta**: unificarli rimetterebbe il sovra-pagato fra i chiudibili, cioè la condizione che ADR-0081 D1 ha deciso di non modellare. Divieto scritto nel docstring, coperto da unit dedicato e da un e2e che verifica **campo ed esito reale di `chiudi` nella stessa prova**. Additivo puro: **nessuna migration, nessun permesso nuovo** (restano 64), throw invariato.

**D1 vista dedicata** (`/cassa` index + `/cassa/[contoId]`), non un pannello dentro comande: sono due mestieri e spesso due persone, ed è la stessa separazione che il BE ha già fatto tenendo `cassa.*` distinti da `comande.*`. `comande/[contoId]` guadagna solo il bottone "Incassa". **D3 il residuo negativo si dice**: tre stati tutti parlanti, **nessun bottone disabilitato in silenzio** — chiudibile → Chiudi; `residuo > 0` → "Restano € X da incassare" (la CTA è il blocco pagamento); `residuo < 0` → riquadro **sovra-pagato** con causa e via d'uscita. Il limite D3 di ADR-0081 **resta**: questa PR lo rende comprensibile dove capita, non lo rimuove. **D4** metodo segmentato (3 Button, non `<select>`: la cassa è touch), importo pre-compilato col residuo, split = lista di pagamenti con storno per riga; cap sull'importo **solo UX**, l'autorità resta il BE. **D5** index **senza importi** (`GET /conti` è flat: mostrarli = N fetch) → 🆕 `TD-conti-list-amounts`.

**Isolamento smoke dai tavoli seedati.** `cassa-flow.spec.ts` **crea ed elimina un proprio tavolo**: DP-2 "un tavolo, un conto aperto" rende il tavolo risorsa **esclusiva** e il pool di 2 era già conteso (`coperti-warning` ne occupa uno in modo permanente, `comande-flow` prende il primo libero). In `fullyParallel` le due spec flow finivano sullo **stesso** conto e si annullavano a vicenda — **osservato, non ipotizzato**. Nessuna modifica alle spec esistenti né al seed.

**GATE**: unit **12 file / 102 test** (+7, il predicato); e2e BE **17 file, 179 passed | 6 skipped** (+4, `chiudibile`) con gli assert `E_CONTO_NOT_SETTLED` pre-esistenti verdi = refactor a comportamento invariato; typecheck + lint + prettier verdi; **Playwright chromium 19 passed | 1 skipped | 0 failed** con le impostazioni CI (`workers=1`, `THROTTLE_AUTH_LIMIT=100`, fixture conti pulita).

**Verifica manuale runtime** (ruolo **non-superuser** `direzione@demo.local`): index cassa · conto `da_pagare` · parziale (nessun bottone chiudi) · importo oltre residuo (submit disabilitato + messaggio) · split carta+contanti a saldo (compare Chiudi) · **sovra-pagato** dopo storno di una riga pagata (riquadro + via d'uscita, chiusura bloccata) · storno pagamenti · ri-paga il totale corretto · chiusura con **riepilogo IVA congelato** a schermo.

**Impatto altro verticale: verificato.** `chiudibile` è derivato in memoria dentro `apps/restaurant-api` → **nessun tocco a `packages/db`/schema/seed**: migration **N.A.**, propagazione permessi **N.A.** `packages/api-client` (condiviso) **non toccato** — le 3 funzioni nuove stanno nel layer di dominio di restaurant-web. Grep a **zero** occorrenze di `chiudibile`/`Pagamento`/`cassa.` in `apps/accountant-api` e `apps/accountant-web`.

**TD nuovi**: 🆕 `TD-conti-list-amounts` (l'index cassa non mostra totale/residuo — **trigger:** il cassiere deve prioritizzare i conti per importo a colpo d'occhio dall'index).

**Forward**: RT/certificazione fiscale differita fino a cliente reale (`cassa.scontrino.emetti`); chiusura giornaliera/Z-report su trigger del pilota (`TD-cassa-chiusura-giornaliera`); resto contanti su trigger riconciliazione cassetto (`TD-cassa-resto-drawer`).

- Commit: `feat(restaurant-api)`(chiudibile+test) · `feat(restaurant-web)`(plumbing) · `feat(restaurant-web)`(viste+smoke) · `docs(adr)`(ADR-0082).

---

## [2026-07-27] Design system PR1 — seam a token per-verticale ([ADR-0083](docs/architecture/ADR-0083-design-system-token-seam.md))

**Prima PR dell'iniziativa di restyling** (multi-PR, UI **condivisa** fra i due verticali). Costruisce **solo il meccanismo**: nessun redesign, nessun ritocco alle 12 primitive, nessuna primitiva nuova. L'estetica si applica in P2–P4 *attraverso* questo seam.

**Cosa esisteva prima** (STOP 0 read-only): due `tailwind.config.ts` **byte-identiche** (`TD-tailwind-config-dup`) e due `globals.css` che divergevano per 3 variabili — senza che nulla nel codice dicesse quali fossero divergenza **voluta** e quali copia da riallineare a mano. ⚠️ **Correzione allo STOP 1**: la spec dava il blocco `.dark` per "identico nei due globals". **Non lo era**: `--primary`, `--primary-foreground` e `--ring` divergono **in entrambi i temi**. Il seam reale è quindi 3 variabili × 2 temi, non 3 in totale.

**Struttura**: `packages/ui/src/tokens.css` (base condivisa: neutri, superfici, tipografia, radii, regole base `*`/`body`) + `packages/ui/tailwind-preset.ts` (mapping nome-Tailwind → token, una volta sola). Le app tengono la propria `tailwind.config.ts` solo per `content` e `plugins`, e nei `globals.css` resta il **blocco seam** per-verticale: 5 coppie di token (`--primary`, `--ring`, `--accent-soft`, `--brand` + i rispettivi `-foreground`). Token additivi non adottati (`--font-display`, `--warn`, `--warn-soft`) → zero impatto sul rendering.

**Il seam per-tenant è previsto e volutamente VUOTO** (YAGNI): la legge "zero letterali nei componenti" lo rende raggiungibile come swap di valori, senza toccare un solo componente. Trigger: un tenant chiede branding proprio.

**Due fix atomici inclusi.** (1) **Drift tipografico**: restaurant ereditava il font di sistema mentre accountant caricava Inter — era un drift mai notato, non una decisione; chiuso caricando Inter anche su restaurant. **Unica modifica visiva della PR**, sul verticale che stiamo per ridisegnare. (2) **Violazione token**: `bg-blue-100 … dark:bg-blue-900/30` hardcoded in `accountant-web` `Sidebar.tsx` passa dalla coppia `--accent-soft`.

⚠️ **Scostamento dallo STOP 1, motivato.** La spec diceva che la Sidebar dovesse passare da `--primary`/`--accent`, ma imponeva anche di dimostrare il rendering accountant **invariato**: `--accent` è un grigio quasi-bianco, lo swap si sarebbe **visto**. Risolto usando `--accent-soft`, token che la PR già introduce, con valori = esattamente blue-100/blue-900. Serve la controparte `--accent-soft-foreground`, aggiunta oltre l'elenco della spec (stessa convenzione `X`/`X-foreground` di tutti gli altri token).

**Verifica dell'invarianza — senza rete di visual regression.** Diff del **CSS emesso da `next build`** (non solo dalla CLI), baseline `bc36e7d` vs PR, su entrambe le app: estratto il valore finale di ogni custom property dopo la cascata in `:root` e `.dark`. Risultato **puramente additivo**: **zero dichiarazioni modificate, zero rimosse** (accountant +13 token, restaurant +14 di cui `--font-sans`). Nessuna regola CSS del baseline è sparita → il purge di `packages/ui` è intatto. **Colori computati a runtime** su stato attivo Sidebar: light `rgb(219,234,254)`/`rgb(30,58,138)`, dark `rgba(30,58,138,0.3)`/`rgb(219,234,254)` = **identici al pixel** ai letterali sostituiti (conversione hex→HSL esatta al roundtrip).

**`postcss-import` aggiunto a entrambe le app** — non cosmetico: Next processa un `@import` di CSS da package come **modulo separato** e Tailwind vi gira sopra senza `@tailwind base`, facendo **fallire il build**. La CLI invece inlinea. Il plugin allinea i due comportamenti. Costo: 6 righe di lockfile, nessun pacchetto nuovo nello store. **Sul lockfile**: `tailwindcss` in `packages/ui` per un solo import di tipo trascinava `jiti` e ~230 righe di churn nel peer graph → scartato, il preset resta non typecheckato come i `tailwind.config.ts` per-app (già oggi fuori dai rispettivi `include`).

**GATE**: typecheck 16/16 · lint · prettier · unit 15/15 · `next build` verde su entrambe le app. **Verifica manuale runtime** (stack dev su DB dev `:55432`, ruolo **non-superuser** `collaboratore@studio.local`): sidebar accountant light **e** dark, tipografia restaurant su login e dashboard, nessun danno di layout.

**Impatto altro verticale: verificato = INVARIATO.** È il punto della PR: tocca `packages/ui` (condiviso), e la prova che accountant non cambia è quella sopra — valori identici, unico edit il token-swap a resa identica. `packages/db`/schema/seed **non toccati** → migration e propagazione permessi **N.A.**

**TD**: 🆕 `TD-visual-regression-net` (baseline Playwright su `page-manifest` × light/dark — **trigger:** prima di P4, il ritocco delle primitive condivise; nasce come **strumento di iterazione, NON gate**, dato lo stato pre-lancio senza clienti reali). ✅ `TD-tailwind-config-dup` risolto.

**Forward**: P2 primitive additive + rebuild dashboard restaurant (oggi stampa i permessi) · P3 estetica A su shell/pagine restaurant · P4 ritocco delle 12 primitive (79 file, 2 app: unica fase non isolabile → ultima). Restano ~13 letterali colore in note-spese/preventivi/mandati/KDS: si estinguono in P3/P4 con la primitiva `badge`.

- Commit: `feat(ui)`(tokens+preset) · `refactor(web)`(app sul seam) · `fix(web)`(Inter restaurant + token Sidebar) · `docs(adr)`(ADR-0083).

---

## 📝 Prompt operativo prossimo task — da definire

> B2a completato (email notification security + login-pin per-tenant rate-limit + TD-B verify empirico, [ADR-0014](docs/architecture/ADR-0014-auth-e2e-hardening-b2a.md)). Prossimo macro-task da concordare nella prossima sessione (candidate priorizzate in sezione "🚧 In corso", con B2b in cima).

---

## 📚 Riferimenti

- `PROJECT_BRIEF.md` — fonte di verità del progetto target
- `STARTER_PROMPT.md` — protocollo operativo Claude Code
- `PROGRESS.md` — questo file, stato corrente
