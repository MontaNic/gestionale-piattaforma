# ADR-0030 — Walking skeleton `accountant-web` (2° verticale, FE)

**Status:** Accepted
**Data:** 2026-06-07
**Contesto:** STOP-b2 dell'avvio del 2° verticale (commercialisti). Chiude lo skeleton (STOP-b). Cfr. ADR-0025, ADR-0027 §D5, ADR-0028, ADR-0029.

## Context

Dopo il backend skeleton `accountant-api` (ADR-0029), il frontend `accountant-web` completa il walking skeleton del verticale: shell + auth + dashboard (vista `me`), **ZERO dominio menu**, consumando `accountant-api` `:3002`. STOP 0 (preflight) aveva mappato la shell di `restaurant-web` come interamente riusabile (providers, middleware, i18n meccanismo, login, dashboard, Topbar/MainLayout) e il dominio (`menu/*` + 6 route placeholder ristorazione + Sidebar 8 voci + namespace `menu.*`) come scartabile/riducibile; un STOP 0 mirato ha chiuso i dettagli operativi (env API parametrizzabile, porta, redirect tenant, contenuti).

## Decision

1. **Nuovo workspace `apps/accountant-web` (`@gestionale/accountant-web`), Next.js 15, replica della shell/auth di `restaurant-web`.** 11 file shell/auth copiati **byte-identici** (tenant-agnostici, zero dominio — verificato): `layout` root (ThemeProvider), `t/[slug]/layout` (`NextIntlClientProvider` + `AuthProvider`), `(authenticated)/layout` (`AuthGate` da auth-web + `MainLayout`), `login`, `dashboard`, `Topbar`/`MainLayout`/`PlaceholderPage`, `api/set-locale`, `i18n/request`, `not-found`/`globals.css`.
2. **`middleware.ts`**: copia identica (slug-routing + `applyLocaleGuard` + RESERVED/regex), unico delta = redirect root → `/t/studio-demo/login`.
3. **Sidebar ridotta (scelta b)**: nav a 3 voci `dashboard` + `clienti` + `fatture`. `clienti`/`fatture` sono route stub che riusano `PlaceholderPage` ("in arrivo") → danno forma riconoscibile al verticale e predispongono gli slot nav per STOP-c (`aziende`), **senza alcun dominio reale** (zero logica/dati). Le route dominio/ristorazione (`menu/*`, `mappa`/`comande`/`cassa`/`kds`/`report`/`settings`) sono omesse.
4. **`error-codes.ts` potato**: tiene `messageForErrorCode` + chiavi auth/common (`E_AUTH_*`, `E_RATE_LIMITED`, `E_VALIDATION`, `E_UNKNOWN`); rimossi `messageForError` + chiavi dominio (`E_MENU_*`/`E_ARTICLE_*`/`E_PRICE_LIST_*`) — nessun consumer menu nello skeleton.
5. **i18n riscritto per il verticale**: `shell.nav` (dashboard/clienti/fatture) + `placeholder.{clienti,fatture}` + `dashboard` generico + `shell.topbar` generico; omessi `menu.*` e le 7 sezioni `placeholder.*` ristorazione.
6. **API env-driven**: `NEXT_PUBLIC_API_URL=http://localhost:3002/api/v1` in `.env.local` (gitignored) + `.env.local.example` committato. La base include `/api/v1`; `api-client` passa path relativi (verificato). FE su `:3003` (dev/start `-p 3003`).
7. **`@gestionale/db` NON in deps** (dead-dep nel FE — conferma ADR-0028): l'entry agnostico evita che il FE erediti NestJS.
8. **Gate skeleton = typecheck/lint/`next build` + boot dev + smoke SSR** (no e2e Testcontainers, no Playwright dedicato). Il flusso login interattivo è **derivazione byte-identica** da `restaurant-web` (già coperto da Playwright lì). La suite e2e dedicata nasce con STOP-c.

## Consequences

- `accountant-web` boota, autentica e mostra `me` contro `accountant-api`; nessun dominio reale.
- DevDeps trimmate vs `restaurant-web` (omessi Playwright/`dotenv`): coerente con "nessun test" nello skeleton; rientrano a STOP-c con la e2e.
- `ci.yml` non toccato: il workspace entra nei job Turbo `typecheck`/`lint`; il job `e2e-playwright` resta su `restaurant-web`.
- STOP-b (skeleton 2° verticale) **completo** (BE ADR-0029 + FE ADR-0030). Prossimo: STOP-c (prima slice dominio `aziende`).

## Empirical evidence

- `typecheck` 16/16 (+`@gestionale/accountant-web`), `lint` + `next lint` + `format:check` clean.
- `next build` OK — 7 route (`/`, `/_not-found`, `/api/set-locale`, `t/[slug]/{login,dashboard,clienti,fatture}`), zero route dominio.
- Boot dev `:3003` + smoke SSR: `/` 307 → `/t/studio-demo/login`; login/dashboard/clienti/fatture 200; slug riservato (`/t/admin/login`) 307 → `/not-found`.
- Conferme: zero residui dominio, `@gestionale/db` assente, Sidebar 3 voci, i18n senza `menu.*`, `error-codes` potato, middleware diff = solo tenant.

## Considered alternatives

- **Sidebar a sola `dashboard` (scelta a)** — skeleton minimale puro. Scartata in favore di **b** (costo ~nullo: `PlaceholderPage` riusato + 2 stub + chiavi i18n; predispone gli slot per STOP-c).
- **Playwright dedicato in CI fin da subito** — rinviato a STOP-c; il flusso login è coperto per derivazione + Playwright di `restaurant-web`.

## Reversibility

Skeleton additivo. Rollback = rimozione di `apps/accountant-web/`. Nessuna modifica a file shared esistenti (eccetto `pnpm-lock`), nessuna migrazione dati, nessun cambio di contratto API. Le 2 route stub (`clienti`/`fatture`) sono rimovibili insieme alle chiavi i18n.
