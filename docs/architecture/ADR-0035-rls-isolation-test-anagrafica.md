# ADR-0035 — Test RLS-isolation come `gestionale_app` (dominio anagrafica)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Relates:** ADR-0009 (RLS reali, ruolo `gestionale_app`), ADR-0021 (soft-delete RLS + spec non-superuser, pattern riusato), ADR-0031/0033 (aziende/referenti backend)

## Context

Le policy `aziende_tenant_isolation` + `referenti_tenant_isolation` sono installate con
`FORCE ROW LEVEL SECURITY`, ma l'intera suite e2e di accountant-api gira come `postgres`
**superuser**, che bypassa la RLS anche con FORCE (TD-BV). Conseguenza: l'isolamento tenant
DB-level non è mai esercitato dai test — è verificato **solo applicativamente** dai
`where: { tenantId }` nei service. Se un service dimenticasse un filtro, o una migration
droppasse una policy / rimuovesse FORCE, nessun test lo intercetterebbe. La RLS è la rete di
sicurezza sotto i filtri applicativi, ma finora non sapevamo se reggesse perché non la
esercitavamo mai. STOP 0 ha verificato che il pattern per testarla esiste già
(`soft-delete-rls.e2e-spec.ts`, ADR-0021) e che nei Testcontainers il ruolo `gestionale_app`
è disponibile con password placeholder (nessuna rotazione necessaria in test).

## Decision

### Sub-1 (questo ADR) — spec mirato sul dominio anagrafica

Nuovo spec `apps/accountant-api/test/e2e/rls-isolation.e2e-spec.ts`: boota l'app come ruolo
`gestionale_app` (NOSUPERUSER, NOBYPASSRLS) — replica del pattern ADR-0021 (`toAppRoleUrl()` +
override `databaseUrl` in `createTestApp`; setup truncate/seed via URL superuser). 5 scenari:
S0 guard (create-under-RLS funziona come ruolo app) + isolamento `aziende` (list, getById→404)

- isolamento `referenti` (list e create sotto azienda altrui → 404 via parent-check). Esercita
  le policy a livello DB: una regressione che rompesse l'isolamento (policy droppata, FORCE
  rimosso, filtro applicativo perso) verrebbe ora catturata. Riuso totale dell'infra e2e:
  **nessuna modifica a file prod o ad altri spec**.

### Sub-2 (deferita) — TD-BV: conversione intera suite a non-superuser

La conversione dell'intera suite e2e (aziende-crud, referenti-crud, e gli spec restaurant) al
ruolo non-superuser resta **fuori scope**, con boundary esplicito: la suite continua a girare
come `postgres` superuser; solo questo spec mirato (più `soft-delete-rls` in restaurant)
esercita la RLS. Da valutare dopo `fatture`, quando la superficie da coprire giustifica il
costo (toccare tutti gli spec + rischio di far emergere altri bug RLS latenti — effetto
desiderato ma destabilizzante in un unico colpo).

## Limiti onesti (S0 guard)

Il guard S0 verifica che il path create-under-RLS funzioni come `gestionale_app`, ma da solo
non distingue superuser da non-superuser (il `where` applicativo regge in entrambi i casi). La
garanzia deriva dalla **combinazione**: app bootata via `toAppRoleUrl` (NOSUPERUSER) + i 4
scenari di isolamento eseguiti sotto RLS enforced. Il valore è strutturale e anti-regressione,
non una prova formale dell'identità di connessione a ogni run.

## Files

| File                                                          | Type            |
| ------------------------------------------------------------- | --------------- |
| `apps/accountant-api/test/e2e/rls-isolation.e2e-spec.ts`      | new (5 scenari) |
| `docs/architecture/ADR-0035-rls-isolation-test-anagrafica.md` | new             |
| `PROGRESS.md`                                                 | mod             |

## Gate

- lint · format clean
- e2e accountant-api: rls-isolation **5/5** (come `gestionale_app`, RLS enforced) + aziende-crud 11/11 + referenti-crud 11/11 regression = **27/27**. Solo locale (TD-CB).

## Tech debt

- **TD-RLS-aziende+referenti** → risolto per la parte "policy esercitata a livello DB" (limitato al dominio anagrafica). La policy ora ha un test che la copre.
- **TD-BV** confermato **deferito** (Sub-2): conversione intera suite a non-superuser, da valutare dopo `fatture`.
- **TD-BS Sub-2** (ValidationPipe e2e: SWC non emette `design:paramtypes` nei `test.projects` → pipe non valida i constraint, 400 coperto da unit DTO) — invariato, problema tooling ortogonale a RLS.

## Reversibility

Spec test-only additivo: rimuovere il file riporta esattamente allo stato pre-STOP. Zero impatto
su prod, schema, o altri spec.
