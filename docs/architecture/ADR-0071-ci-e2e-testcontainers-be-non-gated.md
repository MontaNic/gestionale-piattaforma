# ADR-0071 — La e2e testcontainers del BE non è CI-gated (TD-ci-e2e-testcontainers-be)

- **Status:** Accepted (registra il debito; il fix è deferito)
- **Date:** 2026-07-12
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0019](./ADR-0019-f1-menu-crud-schema.md) (§TD-BS, harness e2e SWC), [ADR-0068](./ADR-0068-operativita-comande.md) / [ADR-0069](./ADR-0069-kds-layer-comanda.md) (comande/conti — la superficie non coperta)

## Context

Scoperta durante la PR storno riga inviata (#163): la **e2e testcontainers di `restaurant-api`** (`test/e2e/*.e2e-spec.ts`, in particolare `comande.e2e-spec.ts`) **non gira in CI**. Verificato su `.github/workflows/ci.yml`:

- Job **Lint · Typecheck · Format · Test** → `pnpm test` = `turbo run test` → per restaurant-api esegue `vitest run --project=unit` (script `test`). **La e2e (`--project=e2e`) non è invocata.**
- Job **E2E tests (Playwright Chromium)** → `pnpm test:e2e:ci` = `playwright test --project=chromium` (solo `restaurant-web` FE). **Non lancia la vitest testcontainers del BE.**
- Nessuno step CI invoca `test:e2e` di `restaurant-api` (`vitest run --project=e2e`).

**Conseguenza:** il **comportamento** di comande/conti (pricing resolver, RBAC per-rotta, state machine, storno, feed KDS, isolamento tenant, audit) è validato **solo in locale** da chi implementa. Una regressione comportamentale **non verrebbe colta dalla CI** — che resta verde su typecheck/lint/unit/migration-applica/boot-API/Playwright-FE. Vale retroattivamente per le PR #158 (note), #161 (vatPercent), #163 (storno): i loro test e2e BE sono stati eseguiti solo in locale.

Questo **svaluta silenziosamente ogni "CI verde" futuro su `restaurant-api`**: verde non significa "il comportamento è testato".

## Decision

Registrare il debito. **Non** fixare ora (fix ≠ una riga: richiede infrastruttura CI).

**TD-ci-e2e-testcontainers-be** (collision-checked: 0 occorrenze pre-esistenti):

- **Cosa:** agganciare `apps/restaurant-api` `test:e2e` (`vitest run --project=e2e`, testcontainers) alla CI.
- **Severità: ALTA** — è sicurezza-di-regressione su superficie **live** (restaurant-api è deployato). Un difetto comportamentale su comande/conti raggiungerebbe la produzione senza che la CI lo segnali.
- **Trigger: prossima sessione dedicata** (non "quando capita"): è un buco che degrada ogni CI-verde futuro sul verticale.
- **Requisito del fix:** un **Postgres nel runner** per testcontainers. Il job Playwright **ne ha già uno** (service `postgres:16-alpine`, seedato per gli e2e FE) → la strada è (a) agganciare la e2e BE a quel job, oppure (b) darle un job/servizio Postgres dedicato. **STOP 0 a sé** quando il TD si attiva (valutare riuso vs job dedicato, tempi CI, isolamento DB tra e2e BE e Playwright).

## Confini

- Fino al fix, chi tocca comande/conti **deve** eseguire la e2e BE **in locale** (`pnpm --filter @gestionale/restaurant-api test:e2e`) e dichiararlo nello STOP 2 come "validato in locale, non in CI".
- Non confondere con **TD-BS** (ADR-0019): quello è "la ValidationPipe non gira nell'harness e2e SWC"; questo è "l'harness e2e BE non gira affatto in CI". Problemi distinti.

## Consequences

- ✅ Il debito è tracciato e la sua severità (ALTA) esplicitata: "CI verde su restaurant-api" ≠ "comportamento testato".
- ⚠️ Finché non fixato, la rete di sicurezza sul comportamento comande/conti è la disciplina di chi implementa (validazione locale), non la CI.
- ⚠️ Ogni nuova feature su restaurant-api eredita lo stesso onere di validazione-locale dichiarata.

## Update 2026-07-23 — Fase 1 fatta (fedeltà RLS dominio in CI)

Il TD ha due componenti (STOP 0): **(a) copertura comportamentale** (16 file, ~159 test solo in locale) e **(b) fedeltà RLS DB-level** (l'isolamento tenant sul dominio non provato in CI). La **Fase 1** chiude **(b)**.

- **Nuovo job CI `e2e-rls-domain`** (ubuntu-latest, Docker host — NON dentro il container Playwright, per evitare Docker-in-Docker): esegue **solo** i 3 spec che asseriscono l'isolamento tenant **DB-level come `gestionale_app`** (NOBYPASSRLS) — `conti-rls-isolation`, `comande-rls-isolation`, `soft-delete-rls` — via Testcontainers dedicati (Postgres+Redis propri, **DP-2**: no riuso del service-DB Playwright). Selezione esplicita nello script `test:e2e:rls` (verificato: esattamente 3 file, 23 test).
- **Decisione strutturale (tracciata, non effetto collaterale):** i due nuovi job (`e2e-rls-domain`, `e2e-accountant-web-blob`) sono **paralleli** con `needs: [checks]`, come `e2e-playwright`. Non sono step in serie: il wall-clock del workflow è dominato dal ramo più lento (`e2e-playwright` ~4m) → l'incremento è **marginale** (i job RLS ~1m40s e blob ~1m50s girano in parallelo, non in coda). Trade-off consapevole: più runner concorrenti vs tempo-di-attesa PR invariato.
- **Nessun refactoring fixture** (§3 STOP 0): il pattern "setup via superuser + assert come `gestionale_app`" esisteva già; le fixture **restano** superuser (TRUNCATE non concesso all'app-role; INSERT cross-tenant respinti da WITH CHECK).
- **DP-3 hardening**: `APP_ROLE_PASSWORD` da env `TEST_APP_ROLE_PASSWORD` (default = placeholder), così il pattern non si rompe se il substrato ruota la pw.
- **Discovery**: `conti-rls-isolation` era **bit-rotted** (`seedContoFor` senza `vatPercent`, reso required dal #161) → 8/8 rossi, **mai intercettato perché la e2e BE non gira in CI** — la tesi del TD materializzata. Fixato (1 riga). È l'argomento più forte a favore del gate.
- **Prova di efficacia** (non teatro): forzato bypass RLS (`is_super_admin=true`) → `comande`+`conti-rls-isolation` **rossi** (cross-tenant leak); ripristinato → 23/23 verdi.

### Fase 2 — RESIDUA (non in questo PR), trigger = `globalSetup`

La **copertura comportamentale completa** (i restanti 13 spec restaurant-api: comande CRUD 64, menu/articles/tables/rbac/auth…) resta fuori dalla CI. **Prerequisito/trigger**: un **`globalSetup` Vitest con container Postgres+Redis condiviso** tra spec. Oggi il pattern è **per-file** (16 coppie di container): portare l'intera suite senza container condiviso raddoppierebbe il tempo CI di ogni PR. Trigger = implementare `globalSetup` condiviso, poi agganciare `test:e2e` completo.

### Boundary — `TD-ci-e2e-accountant-api` (tier MEDIO) — porzione RLS ora GATATA (2026-07-23)

Anche la **e2e di `accountant-api`** (20 spec, inclusi i path documenti/comunicazioni/portale verificati in Sub-2) è **fuori dalla CI**, stessa classe. Registrato come **`TD-ci-e2e-accountant-api`** (tier MEDIO, **stesso trigger `globalSetup`** della Fase 2).

**Update 2026-07-23 (PR-0 di Note Spese):** la porzione **RLS DB-level** è ora **gatata**. Nuovo job **`e2e-rls-domain-accountant`** (gemello di `e2e-rls-domain`): esegue `rls-isolation.e2e-spec.ts` (10 test, anagrafica ADR-0035) come `gestionale_app` via Testcontainers dedicati. Selettore `test:e2e:rls` accountant (esattamente 1 file). `APP_ROLE_PASSWORD` allineato al pattern env+default (DP-3). **Prova di efficacia:** rotta la policy `preventivi_voci` → S-prev-4 rosso (leak cross-tenant 4 vs 2) → ripristino verde. **Motivo di Note Spese:** i suoi modelli avranno `tenant_id` + RLS FORCE e il loro spec di isolamento nascerà **dentro** questo gate (aggiunto al selettore), non accanto.

**Nuance sul vettore di efficacia (accountant vs restaurant):** su restaurant il break efficace era l'extension (`rls.ts`, `is_super_admin=true`); su accountant è la **policy** (migration), perché i test HTTP di `rls-isolation` sono **anche** app-filter-protected (`where:{tenantId}`, defense-in-depth) e restano verdi sotto RLS bypassata — solo il raw-query DB-level **S-prev-4** esercita puramente la policy. Il gate è comunque efficace: una regressione di policy accountant rompe la CI.

**Residuo:** le ~17 spec **comportamentali** accountant (CRUD, report, portale, IDOR `documenti-download-isolation`) restano fuori CI sotto lo stesso TD, trigger `globalSetup` invariato. **Bit-rot trovata (fuori scope PR-0, comportamentale):** `report-margine.e2e-spec.ts` — 2 test falliscono (200 vs 201, guard <2 mandati); non RLS, non fixato qui, tracciato sotto `TD-ci-e2e-accountant-api`.

### Adiacente FE — chiuso

**`TD-ci-e2e-accountant-web-fe`** chiuso: nuovo job additivo `e2e-accountant-web-blob` esegue `blob-auth-refresh.spec.ts` (route-mocked, `next dev` :3013, no BE/DB). Escluso `page-tour.spec.ts` (richiede infra full-stack accountant).
