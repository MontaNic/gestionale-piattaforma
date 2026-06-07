# ADR-0028 — Estrazione `DbService` in sub-entry `@gestionale/db/nest`

**Status:** Accepted
**Data:** 2026-06-07
**Contesto:** STOP-a dell'avvio del 2° verticale (commercialisti). Cfr. ADR-0027 §D5, ADR-0025, ADR-0007.

## Context

`DbService` (wrapper lifecycle Prisma — `$connect`/`$disconnect` sul singleton `prisma`, con `@Global` `DbModule`) viveva app-level in `apps/restaurant-api/src/db/`. Lo scaffold del 2° verticale (`accountant-api`) richiede di condividerlo senza duplicarlo, ma senza estrarre core di dominio (anti-astrazione, BRIEF §F1).

STOP 0 (preflight read-only) ha confermato empiricamente la decisione **C**: 6/7 assunzioni confermate (DbService importa solo `@nestjs/common` + `@gestionale/db`; 6 consumer + `app.module.ts`; `me` non consumer; grafo aciclico; entry `.` single-entry; consumo CJS via `dist`). L'unica divergenza è la #7 — il `tsconfig` di `db` non eredita i decorator flags dal base.

## Decision

1. **Sub-entry additivo, non package nuovo.** `DbService`/`DbModule` spostati con `git mv` in `packages/db/src/nest/`, esposti via `@gestionale/db/nest`. L'entry `.` resta il data layer agnostico.
2. **Singolo pool via self-reference.** `db.service.ts` importa `prisma` da `'@gestionale/db'` (mai relativo). `@gestionale/db` è in `external` di tsup → `dist/nest/index.cjs` fa `require('@gestionale/db')` e risolve all'entry `.` = una sola istanza del pool. Probe STOP 0.5: `same prisma reference: true`.
3. **Entry `.` agnostico.** `DbService`/`DbModule` vivono **solo** in `./nest`; `src/index.ts` non li ri-esporta e non tocca `@nestjs/*`.
4. **Build NestJS-dual (pattern `platform`).** Il `tsconfig` di `db` dichiara `experimentalDecorators` + `emitDecoratorMetadata` (il base non li eredita — divergenza #7). `external` di tsup esteso a `@nestjs/common` + `reflect-metadata`.
5. **NestJS come optional peer, non dependency hard** (divergenza motivata dal pattern `platform`). `@nestjs/common`/`reflect-metadata` in `peerDependencies` + `peerDependenciesMeta.optional` + `devDependencies` (queste ultime per il DTS rollup di tsup). Così l'entry `.` resta agnostico nel dependency graph: i consumer non-NestJS (`restaurant-web`, futuri verticali FE) non ereditano NestJS né ricevono unmet-peer.
6. **`typesVersions` bridge.** `restaurant-api` usa `moduleResolution: node` (scelta deliberata per NestJS + ts-node-dev): node10 risolve i subpath di `exports` a runtime ma li ignora per la type-resolution → `typesVersions.*.nest → dist/nest/index.d.ts` evita TS2307. Il `moduleResolution` dell'app **non** è toccato (ripple evitato).

## Consequences

- `@gestionale/db` acquisisce un accoppiamento NestJS **opzionale** via sub-entry; l'entry `.` resta agnostico.
- `health` consuma `@gestionale/db/nest` ma **resta app-level** in `restaurant-api`: tira `@gestionale/auth` (`@Public`), e tenerlo in-app evita di accoppiare `db/nest` ad `auth`. `me` non tocca `db`.
- 7 consumer ripuntati (6 service — `articles`, `article-prices`, `menu-categories`, `price-lists`, `health`, `menus` — + `app.module.ts`); `apps/restaurant-api/src/db/` rimossa.
- Divergenza dal pattern `platform` (peer-optional vs dep-hard): giustificata dalla natura di `db` (core agnostico, consumato anche dal FE).

## Empirical evidence

- Probe STOP 0.5: `require("@gestionale/db")` presente nel bundle `nest`, 0 occorrenze di `rls`/`soft-delete`/istanziazione client (singleton non inlinato); `same prisma reference: true`.
- Gate full-suite invariato baseline→post: `typecheck` 14/14, unit invariati, e2e **56 pass / 4 skip** (full `AppModule` bootstrap = gate DI reale, zero `Nest can't resolve dependencies`), `smoke:rls-core` 9/9.
- DTS del sub-entry generati (`dist/nest/index.d.ts` + `.d.cts`) con NestJS in devDep → fallback opzione A (dep hard) non necessario.

## Discovery #57

Su un package multi-entry (`exports` con subpath) consumato da un'app con `moduleResolution: node` (node10/classic): il subpath è risolto a **runtime** (require) ma **ignorato da TS per i tipi** → serve `typesVersions` come bridge (TS2307 altrimenti). Inoltre il **DTS rollup di tsup** richiede le dipendenze dei tipi (qui `@nestjs/common`) risolvibili nel workspace del package, ma una **devDependency basta** — non serve una dependency hard. Generalizzabile a ogni futuro sub-entry su un package del core consumato da app node10.

## Considered alternatives

- **Package nuovo `@gestionale/db-nest`** — scartato: overhead di un workspace in più; `db-nest → db` diventerebbe freccia cross-package per un wrapper di ~17 righe (§F1).
- **NestJS in `dependencies` hard (opzione A)** — funzionante (gate verdi) ma rompe l'agnosticità di `db`: ogni consumer dell'entry `.` (incluso il FE) erediterebbe NestJS nel graph. Scartata in STOP 2.
- **`moduleResolution: bundler`/`node16` su `restaurant-api`** — risolverebbe i subpath dei tipi nativamente, ma con ripple sull'intera app (NestJS + ts-node-dev). Scartata: troppo ampia per il beneficio.

## Reversibility

Il sub-entry è additivo. Rollback = `git mv` inverso `src/nest/` → `apps/restaurant-api/src/db/`, rimozione di `exports["./nest"]`, `typesVersions`, peer/devDep e dei decorator flags dal `tsconfig`. Nessuna migrazione dati, nessun cambio di contratto API.
