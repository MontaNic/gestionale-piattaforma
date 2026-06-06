# `apps/` — Verticali

Questa cartella contiene i **verticali**: applicazioni costruite sopra il core tecnico condiviso in
[`../packages/`](../packages/). Il core estrae tutto ciò che funziona **senza sapere cosa sia un
"articolo di menu"**; i verticali consumano quel core e contengono il dominio.

> **Stato (SVOLTA [ADR-0025](../docs/architecture/ADR-0025-piattaforma-core-condiviso-verticali.md), 2026-06-01):**
> oggi esiste **un solo** verticale, la **ristorazione**, ora **congelata allo stato di scaffold** —
> serve da riferimento boilerplate, **non è sviluppo attivo**. Il primo verticale reale sarà quello
> per **studi commercialisti**, costruito sulla stessa base condivisa. L'estrazione del core è
> completa: vedi [ADR-0027 §D5](../docs/architecture/ADR-0027-composizione-core-condiviso.md) (Addendum passo 9).

## Core vs dominio dentro i verticali

I verticali NON sono puro dominio: contengono un sottile **residuo app-level** (bootstrap, glue) che
resta qui per design, più il **dominio** congelato. Il **core agnostico** è invece nei `packages/`.

### `apps/restaurant-api` — backend NestJS (verticale ristorazione)

- **Dominio ristorazione** (scaffold congelato): `menus`, `menu-categories`, `articles`,
  `price-lists`.
- **Core-residuo app-level** (resta qui, non estratto — cfr. ADR-0027 Addendum passo 9):
  - `health` — healthcheck che compone auth+db+redis (endpoint terminale).
  - `db` (`DbService`) — wrapper ~12 righe sul client Prisma condiviso.
  - `me` — endpoint `/me` (profilo), thin controller su `@gestionale/auth`.
- **Bootstrap**: `app.module.ts` (incl. wiring deterministico dei 4 `APP_GUARD` + interceptor +
  middleware, Discovery #36), `app.controller.ts`, `main.ts`.

### `apps/restaurant-web` — frontend Next.js (verticale ristorazione)

- **Dominio ristorazione**: `components/menu/*` + route `(authenticated)/menu`, `menu/[menuId]`,
  `menu/listini` (UI reale, costruita in F1 pre-SVOLTA). Le sezioni `cassa`, `comande`, `kds`,
  `mappa`, `report` sono placeholder (`<PlaceholderPage>`).
- **Core**: shell, auth, layout e design system arrivano dai package `@gestionale/*`
  (`ui`, `auth-web`, `api-client`, `shared`, `i18n`).

## Core condiviso (`../packages/`)

`eslint-config`, `ui`, `shared`, `i18n`, `auth-web`, `api-client` (FE) · `platform`, `auth`, `db` (BE).
I verticali riusano i singleton condivisi (BRIEF §F1: nessuna astrazione prematura).

## Naming

I verticali usano nomi verticale-specifici: la ristorazione è `apps/restaurant-api` /
`apps/restaurant-web`. Il rename da `apps/api`/`apps/web` è stato eseguito all'avvio del **2° verticale**
(commercialisti), per disambiguare da `apps/accountant-*`. Storia e razionale: ADR-0027 Addendum passo 9
(decisione A → rename) + **TD-CC (risolto)**.
