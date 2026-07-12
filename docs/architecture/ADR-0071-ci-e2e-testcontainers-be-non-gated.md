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
