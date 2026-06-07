# ADR-0029 — Walking skeleton `accountant-api` (2° verticale)

**Status:** Accepted
**Data:** 2026-06-07
**Contesto:** STOP-b1 dell'avvio del 2° verticale (commercialisti). Cfr. ADR-0025, ADR-0027 §D5, ADR-0028.

## Context

Dopo il rename TD-CC (`apps/restaurant-*`) e l'estrazione di `DbService` in `@gestionale/db/nest` (ADR-0028), parte il 2° verticale. Primo passo: un **walking skeleton** backend `accountant-api` che boota e autentica (login + `me`) consumando il core condiviso, con **ZERO dominio** (no menu, modello dati `aziende` rinviato a STOP-c). Lo skeleton è decomposto in STOP separati per isolare i rischi (composizione vs modellazione).

STOP 0 (preflight read-only) ha confermato: nessun accoppiamento dominio nei moduli core di `restaurant-api` (i 4 moduli menu compaiono solo in `imports[]`); `health` → `@Public` + `db/nest`, `me` → `UsersService`, nessuno tocca il dominio; nessuno scaffold `accountant-*` preesistente.

## Decision

1. **Nuovo workspace `apps/accountant-api` (`@gestionale/accountant-api`), replica core-only di `restaurant-api`.** `app.module.ts` e `main.ts` derivati tale-quale; rimossi i 4 moduli dominio (`Menus`/`MenuCategories`/`Articles`/`PriceLists`) dagli `imports[]`. Tutto il resto (catena dei 4 APP_GUARD, `TenantContextInterceptor`, `TenantMiddleware.forRoutes`) **byte-identico** (Discovery #36 / ADR-0017): unico delta in `app.module.ts` = una riga di commento.
2. **`DbService` dal sub-entry `@gestionale/db/nest`** (ADR-0028) — singolo pool condiviso.
3. **`health` + `me` + `app.controller` duplicati** (~thin, import `@gestionale/*` assoluti → nessun adattamento). Coerente col piano (§D5/ADR-0028): `health` resta app-level (tira `@gestionale/auth`, tenerlo in-app evita di accoppiare `db/nest` ad `auth`); `me` non tocca `db`. Duplicazione accettata, isolata, non cresce.
4. **Tenant dedicato `studio-demo`** via `seedDevTenant` esistente (`admin@studio.local`), **senza** `seedDevMenu` → lo skeleton accountant è isolato dalla ristorazione. Il catalogo permessi `PERMISSIONS` è globale/condiviso: il Super Admin del tenant lo eredita tale-quale (i permessi propri del verticale arriveranno a STOP-c).
5. **Porte/CORS env-driven, default dedicati:** `accountant-api` su `:3002` (CORS `:3003` per il futuro `accountant-web`). Lo script `dev` forza `PORT`/`CORS_ORIGIN` via `dotenv-cli -v` per evitare collisioni col `.env` condiviso (sia restaurant che accountant leggerebbero lo stesso file).
6. **ESLint root glob → `apps/\*-api/**/\*.ts`** (future-proof: copre restaurant-api, accountant-api e futuri verticali BE), `...base` preservato.
7. **Gate skeleton = build/typecheck/lint + boot DI + smoke HTTP locale** (no e2e Testcontainers). Razionale: la logica auth/RLS/guard è identica al core, già coperta da test di package + e2e di `restaurant-api`; duplicare la suite e2e per uno skeleton zero-dominio è over-engineering (§F1 / YAGNI). **Confine esplicito:** la e2e dedicata di `accountant-api` nasce con STOP-c (primo dominio reale, `aziende`).

## Consequences

- `accountant-api` boota e autentica contro il core condiviso; nessun codice di dominio.
- DevDeps trimmate vs `restaurant-api` (omesse le dep solo-test): coerente con "nessuno script `test`" nello skeleton; rientreranno a STOP-c con la e2e.
- `ci.yml` non toccato: il workspace entra nei job Turbo `typecheck`/`lint`/`build`; il job `e2e-playwright` (restaurant-api + restaurant-web) non lo riguarda.
- `accountant-web` (STOP-b2) consumerà questa API; `@gestionale/db` resta dead-dep nel FE (non va portata — conferma ADR-0028).

## Empirical evidence

- Boot DI pulito: `AppModule dependencies initialized`, `DbService` → Prisma connesso, Redis PONG, SMTP verificato, `listening :3002` — **zero** `Nest can't resolve dependencies`/`UnknownDependencies`.
- Smoke HTTP `:3002`: `GET /api/v1/` 200; `GET /api/v1/health` 200 `{status:"ok", db:"connected"}`; `POST /api/v1/auth/login` (`X-Tenant-Slug: studio-demo`) 200 + access/refresh; `GET /api/v1/me` 200 + `admin@studio.local` + Super Admin + 32 permessi. Comportamento identico a `restaurant-api`.
- Gate: `typecheck` 15/15 (+`@gestionale/accountant-api`), `lint`/`format:check` clean; seed `studio-demo` idempotente (2° run 0 created).
- `app.module.ts` diff vs `restaurant-api` = solo riga di commento (guard order intatto).

## Considered alternatives

- **e2e Testcontainers minimale in CI fin da subito** — più rigoroso, ma aggiunge estensione CI per testare un wiring già coperto altrove. Rinviata a STOP-c (decisione 2a).
- **Riuso dei tenant esistenti (demo/acme) per lo smoke** — zero seed, ma "ristorazione" e non isola il verticale. Scartata in favore di `studio-demo` (decisione 1b).

## Reversibility

Skeleton additivo. Rollback = rimozione di `apps/accountant-api/`, della call `seedDevTenant('studio-demo')` dal seed, e ripristino del glob ESLint a `apps/restaurant-api/**/*.ts`. Nessuna migrazione dati, nessun cambio di contratto API.
