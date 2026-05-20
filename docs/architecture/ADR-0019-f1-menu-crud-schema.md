# ADR-0019 — F1 Menu CRUD schema + backend base

- **Status:** Accepted
- **Date:** 2026-05-21 (sessione 17)
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0005](./ADR-0005-data-layer-prisma.md) (schema conventions UUID v7 + soft-delete), [ADR-0009](./ADR-0009-rls-tenant-isolation.md) (RLS PostgreSQL + helper context), [ADR-0010](./ADR-0010-tenant-bootstrap.md) (atomic tx pattern `withSystemContextAtomicTx`), [ADR-0017](./ADR-0017-rbac-permissions-guard.md) (RBAC Guard + audit `entityType`/`action` convention), [ADR-0012 §TD-7](./ADR-0012-frontend-auth-flow.md) (TenantConsistencyGuard sessione 16)

## ✅ Status finale

**F1 Menu domain — schema dati + backend CRUD base completati sessione 17.**

- Schema Prisma: 5 modelli business (`Menu`, `MenuCategory`, `Article`, `PriceList`, `ArticlePrice`) + 2 placeholder PRE F2 (`Recipe`, `PricingRule`) + 5 enum (`Allergen` 14 UE, `DietaryTag` 4, `PrintDepartment` 3, `ArticleAvailability` 3, `Channel` 4)
- Migration `20260520000939_add_menu_models_f1_schema`: 7 CREATE TABLE + 5 CREATE TYPE + 16 indici + 11 FK + 7 RLS policy `<table>_tenant_isolation` (pattern reference `20260513003613`, USING-only)
- Backend NestJS: 4 module (`menus`, `menu-categories`, `articles`, `price-lists`) → 5 endpoint group REST
- Seed dimostrativo: menu "Pranzo" + 3 categorie + 5 articoli + PriceList "Base" per tenant `demo` + `acme` (idempotente upsert)
- E2E Testcontainers: 5 spec, 36 test (32 verdi + 4 `.skip` TD-BS) — CRUD + RBAC permission + tenant isolation cross-tenant

**Out of scope (carving S18-S20):** UI scaffold Menu, listini multipli UI, foto upload pipeline + WebP, varianti/modificatori.

## Context

BRIEF §B3 (L290-358) "Menu, articoli, comande, cucina `[F1]`": struttura menu a 3 livelli (Menu → Categorie → Articoli), più menu attivi per canale/fascia/sede, listini multipli, caratteristiche articolo (allergeni UE, tag dietetici, reparto stampa, IVA per articolo, CO2 `[F2]`, ingredienti `[F2]`, pricing rules `[F2]`).

Gate accettazione F1 §D:

- **D5**: "Menu 3 livelli + listini multipli + comande da smartphone offline-first"
- **D29**: "Schema dati `[PRE]` completi per tutte le feature F2/F3 (pricing rules, CO2, ...)"

Verifica empirica preliminare (STOP 0) ha rilevato:

1. **Permission `menu.*` già seedate** (`packages/db/prisma/seed.ts`): `menu.categoria.gestisci`, `menu.piatto.crea`, `menu.piatto.modifica`, `menu.prezzo.modifica`, `menu.visualizza` → nessuna estensione seed necessaria
2. **Pattern CRUD reference** `tenants/` (controller `{data}` wrapper + `@RequirePermissions` + service `@Inject(DbService)` + `withSystemContextAtomicTx` + audit inline)
3. **Soft-delete extension** auto-detect campi `deletedAt` → `delete()` diventa `update deletedAt`, read auto-filtrate
4. **Migration RLS reference** `20260513003613`: `CREATE POLICY` esplicito + `USING` only (no `WITH CHECK`, no `DO` block, no `::uuid` cast — `tenant_id` è TEXT)
5. **`Decimal` + enum array**: prima introduzione nel progetto (Prisma 6 + Postgres native)

## Decisions

### Schema F1 — 5 business + 2 placeholder PRE

| Modello        | Scope          | Note                                                  |
| -------------- | -------------- | ----------------------------------------------------- |
| `Menu`         | F1             | livello root struttura 3 livelli                      |
| `MenuCategory` | F1             | livello intermedio, FK `menuId`                       |
| `Article`      | F1             | livello foglia, FK `categoryId`                       |
| `PriceList`    | F1             | listini multipli (Gate D5)                            |
| `ArticlePrice` | F1             | join M:N `Article` ↔ `PriceList` con `price` override |
| `Recipe`       | `[PRE F2 B5]`  | skeleton minimal — popolato macro-task Magazzino      |
| `PricingRule`  | `[PRE F2 B10]` | skeleton minimal — popolato macro-task Pricing        |

### 6 Sub-DP design risolti

| #   | Sub-DP                             | Decisione                                                                                                                | Razionale evidence                                                                                         |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | Listini multipli — tabella vs JSON | **Tabella `PriceList` + `ArticlePrice`**                                                                                 | BRIEF L317-319 filtra per 4 dimensioni (canale/fascia/giorno/sede) → query indicizzata impossibile su JSON |
| 2   | Allergeni — enum vs M:N            | **Enum `Allergen[]`** (14 UE Reg. 1169/2011)                                                                             | Lista chiusa stabile; convention schema usa `enum` per liste chiuse (`DeviceType`). M:N overengineering F1 |
| 3   | Tag dietetici — enum vs tabella    | **Enum `DietaryTag[]`** (4 valori)                                                                                       | BRIEF L307 elenco chiuso esplicito                                                                         |
| 4   | Reparto stampa — enum vs FK        | **Enum `PrintDepartment`** (cucina/pizzeria/bar)                                                                         | BRIEF L310 3 valori espliciti; migrazione a tabella in F2 KDS se serve customizzazione (TD-BM)             |
| 5   | Recipe + PricingRule               | **Skeleton minimal** (`id, tenantId, timestamps, deletedAt?`) + FK nullable `Article.recipeId`/`pricingRuleId` `SetNull` | Gate D29 + KISS S17                                                                                        |
| 6   | Varianti/Modificatori              | **DEFERRED S18+**                                                                                                        | Gate D5 non le richiede in Menu; BRIEF le menziona nel workflow Comande                                    |

### 6 refinement applicati

| ID  | Decisione                                                            | Razionale                                                    |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| R1  | `ArticlePrice` ha solo `price`, NO `vatPercent`                      | IVA è proprietà articolo (BRIEF L304), non varia per listino |
| R2  | `PriceList.priority Int @default(0)`                                 | tie-break futuro multi-match, costo zero                     |
| R3  | Permission seed `menu.*` già presenti → nessuna estensione           | verifica empirica STOP 1.0                                   |
| R4  | Enum `Channel` su `PriceList.channels` + `Article.channelVisibility` | BRIEF L313 visibilità per canale                             |
| R5  | `PricingRule` placeholder parallelo a `Recipe`                       | coerenza pattern                                             |
| R6  | `Article.photoUrl String?` lean (no pipeline upload)                 | upload + WebP → TD-BO S18-S20                                |

### 6 Sub-DP architetturali risolte inline (STOP 1.4)

| #   | Sub-DP                                       | Decisione                                                                                                                                                |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Soft-delete cascade Menu→Category→Article    | **KISS: solo target** — `deletedAt` sull'entità target; children restano (FK RESTRICT previene hard cascade); read auto-filtrate. UX cascade → TD-BQ S18 |
| 2   | `POST /articles/:articleId/prices` semantica | **Upsert** su `(articleId, priceListId)` — audit `article_price.set`, idempotente                                                                        |
| 3   | VAT validation                               | `@IsIn([4, 10, 22])` — BRIEF L305 elenco chiuso IT                                                                                                       |
| 4   | Array enum default vs required               | allergens/dietaryTags/channelVisibility default `[]`; `PriceList.channels` required min 1                                                                |
| 5   | Cambio categoria via `PATCH /articles/:id`   | consentito + verifica esistenza nuova categoria + conflict check `(tenantId, categoryId, name)` destinazione                                             |
| 6   | Re-export tipi Prisma da `@gestionale/db`    | 18 model type + 6 enum re-exportati (apps non hanno `@prisma/client` direct dep)                                                                         |

### Convention applicate

- **Naming**: tabelle `@@map` snake_case plurale (`menus`, `menu_categories`, `articles`, `price_lists`, `article_prices`, `recipes`, `pricing_rules`); module directory kebab-case (`menu-categories/`, `price-lists/`)
- **FK behavior**: `CASCADE` su `tenantId → Tenant`; `RESTRICT` su FK business (Menu↔Category, Category↔Article, Article↔ArticlePrice, PriceList↔ArticlePrice); `SetNull` su placeholder FK (`recipeId`, `pricingRuleId`)
- **Soft-delete**: `deletedAt?` su `Menu`, `MenuCategory`, `Article`, `PriceList`, `Recipe`, `PricingRule`. **NO** su `ArticlePrice` (join puro, eredita lifecycle parent)
- **Unique constraints**: `@@unique([tenantId, name])` su Menu + PriceList; `@@unique([tenantId, menuId, name])` su MenuCategory; `@@unique([tenantId, categoryId, name])` su Article (Sub-DP residua opzione A — consente upsert idempotente seed + vincolo business); `@@unique([articleId, priceListId])` su ArticlePrice
- **Decimal**: `Decimal(10,2)` su importi monetari (`basePrice`, `ArticlePrice.price`); `Decimal(10,4)` su `co2KgEq` (precision finer per kgCO2eq)
- **Module exports**: ogni module espone `exports: [<Service>]` per composability futura (divergenza da `TenantsModule` che non esporta → TD-BR backfill)
- **RLS policy**: uniforme `USING` only, `<table>_tenant_isolation` (`current_setting('app.is_super_admin') = 'true' OR tenant_id = current_setting('app.tenant_id')`), `FORCE ROW LEVEL SECURITY`
- **Routing REST**: `/menus`, `/menus/:menuId/categories`, `/articles` (top-level con filtri `?categoryId=`/`?menuId=`), `/articles/:articleId/prices`, `/price-lists`

## Consequences

- **Carving S18-S20**: UI scaffold Menu, listini multipli UI, foto upload pipeline + WebP multi-resolution, varianti/modificatori
- **TenantConsistencyGuard** (sessione 16, ADR-0012 §TD-7) → tutti i 5 endpoint group protetti by default, nessun opt-in. Verificato E2E: header `X-Tenant-Slug` spoof → 401 `E_AUTH_TENANT_MISMATCH`; header coerente → RLS isola → 404
- **TD candidate sessione 17**:
  - **TD-BP** — tsconfig `declaration:true` + return type Prisma → TS2742 su leaf consumer. RESOLVED in-PR via override `declaration:false` su `apps/api/tsconfig.json`; convention per futuri leaf consumer `apps/*`
  - **TD-BQ** — soft-delete cascade UX behavior (Menu soft-deleted con categorie/articoli figli) → definire UX in S18 UI
  - **TD-BR** — backfill `TenantsModule` con `exports: [TenantsService]` per coerenza convention module (low priority)
  - **TD-BS** — harness E2E SWC non emette `design:paramtypes` runtime → `ValidationPipe` inattiva in E2E. **Priority ALTA, task #1 sessione 18** (pre-UI o hotfix standalone)
  - **TD-BL** — `DietaryTag` customization tenant-side (kosher, halal) → enum→tabella (F2)
  - **TD-BM** — `PrintDepartment` customization tenant-side KDS → enum→tabella (F2 KDS)
  - **TD-BN** — Allergeni regionali extra-UE → enum→tabella (low priority)
  - **TD-BO** — foto upload pipeline + WebP multi-resolution (S18-S20)

## Notes

### Discovery candidate #52 — tsconfig `declaration:true` + tipi Prisma opachi su leaf consumer

`tsconfig.base.json` ha `declaration: true` (workspace package emettono `.d.ts`). I service che ritornano modelli Prisma con `Decimal` (`Article.basePrice`, `ArticlePrice.price`) o enum array triggerano `TS2742: inferred type cannot be named without a reference to '@prisma/client/runtime/library'` — il path interno non è raggiungibile dal leaf consumer.

**Fix**: override `declaration: false` + `declarationMap: false` su `apps/api/tsconfig.json`. Razionale: `apps/*` sono leaf consumer, non librerie pubblicate → niente `.d.ts` da emettere. **Generalizzabile**: ogni leaf consumer `apps/*` che ritorna tipi Prisma opachi (NON `packages/*` che emettono types per i consumer).

### Nota informativa — harness E2E SWC `design:paramtypes` gap (→ TD-BS)

Verifica empirica STOP 1.6: nel harness E2E (Vitest + `unplugin-swc`) i `design:paramtypes` dei metodi controller non sono disponibili a runtime (`Reflect.getMetadata` → `undefined`). Senza, `ValidationPipe.toValidate()` riceve `metatype = undefined` → salta la validazione DTO body.

Gap **latente da sempre**: il progetto usa `@Inject(Token)` esplicito in tutti i constructor → la DI NestJS non è mai dipesa dalla reflection → l'app E2E parte regolarmente. Nessun test E2E precedente verificava una validation 400 su DTO body. La validazione **è attiva in produzione** (`main.ts` via toolchain `tsc`/`ts-node-dev`, path diverso dal SWC del harness).

Conseguenza S17: 4 test validation 400 marcati `.skip` con riferimento TD-BS. `test-app.ts` non registra `GlobalHttpExceptionFilter` (divergenza da `main.ts`) — da includere nel fix TD-BS.

### Nota informativa — skip `migrate:reset` via AI agent

STOP 1.5: `prisma migrate reset --force` bloccato dal classifier auto-mode Claude Code (constraint operativo agent, non difetto codice). Seed eseguito via `db:seed` idempotente (path funzionalmente equivalente — DB già pulito post-migration). Reset esplicito → eseguire manualmente da shell se necessario.

### First-use nel progetto

`Decimal` (`@db.Decimal`) ed enum array PostgreSQL (`Allergen[]`, `DietaryTag[]`, `Channel[]`) sono prima introduzione. `prisma validate` + migration apply + E2E confermano supporto nativo Prisma 6.19.3.

## File creati / modificati

### Creati

| Path                                                                                   | Note                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/db/prisma/migrations/20260520000939_add_menu_models_f1_schema/migration.sql` | DDL + 7 RLS policy                                   |
| `apps/api/src/menus/`                                                                  | controller + service + module + 2 DTO                |
| `apps/api/src/menu-categories/`                                                        | controller + service + module + 2 DTO                |
| `apps/api/src/articles/`                                                               | 2 controller + 2 service + module + 3 DTO            |
| `apps/api/src/price-lists/`                                                            | controller + service + module + 2 DTO                |
| `apps/api/test/e2e/helpers/menu-test-fixtures.ts`                                      | seedMenuPermissions + loginAs + flushTenantSlugCache |
| `apps/api/test/e2e/{menus,menu-categories,articles,price-lists}-crud.e2e-spec.ts`      | 4 spec CRUD                                          |
| `apps/api/test/e2e/menu-tenant-isolation.e2e-spec.ts`                                  | spec isolation                                       |
| `docs/architecture/ADR-0019-f1-menu-crud-schema.md`                                    | questo file                                          |

### Modificati

| Path                               | Cosa cambia                                          |
| ---------------------------------- | ---------------------------------------------------- |
| `packages/db/prisma/schema.prisma` | +7 modelli +5 enum + back-relation `Tenant`          |
| `packages/db/src/index.ts`         | re-export 6 enum + 18 model type                     |
| `packages/db/prisma/seed.ts`       | helper `seedDevMenu` + costanti `DEMO_ARTICLES`      |
| `apps/api/src/app.module.ts`       | register 4 module                                    |
| `apps/api/tsconfig.json`           | `declaration:false` override (TD-BP / Discovery #52) |
| `apps/web/src/lib/error-codes.ts`  | +52 key `E_*` IT mapping                             |

## Definition of Done F1 Menu CRUD schema

- [x] Schema Prisma 7 modelli + 5 enum, `prisma validate` OK
- [x] Migration `20260520000939` applicata + 7 RLS policy verificate (`docker exec psql`)
- [x] Backend 4 module / 5 endpoint group, typecheck + lint OK
- [x] Seed dimostrativo demo + acme, idempotenza verificata (count rows stabili re-run)
- [x] E2E 5 spec: 32 verdi + 4 `.skip` TD-BS; suite totale 45 pass / 4 skip
- [x] ADR-0019 scritto (6 Sub-DP + 6 refinement + 6 inline + convention + 8 TD)
- [x] PROGRESS.md aggiornato entry sessione 17
- [x] No PII / no secret nei commit
