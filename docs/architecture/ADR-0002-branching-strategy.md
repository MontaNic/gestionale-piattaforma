# ADR-0002 — Branching strategy: GitHub Flow semplificato + squash merge

- **Status:** Accepted
- **Date:** 2026-05-11
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** `PROJECT_BRIEF.md` §C12 (convenzioni codice/Git), `PROGRESS.md` (workflow operativo)

## Context

Il brief §C12 prescrive uno schema di branching ispirato a GitFlow:

> Branch: `main`, `develop`, `feature/*`, `fix/*`, `release/*`

GitFlow è disegnato per team con release calendarizzate, code freeze su `develop`,
hotfix paralleli su `main`. Il progetto Gestionale ha, alla data odierna, un profilo
operativo diverso:

- **Single developer** (Nicolò) con assistenza AI
- **Nessuna release pubblica** prevista — non è un prodotto distribuito
- **Nessun ambiente staging persistente** ancora attivato — solo dev locale + un
  futuro deploy su singolo server
- L'obiettivo dichiarato del progetto è "imparare facendo", non gestire un ciclo
  di release multi-stream

Mantenere `develop` in queste condizioni significa pagare overhead (branch
protection doppia, doppio merge per ogni cambio, sincronizzazioni manuali) senza
controparte di valore.

## Decision

**Adottiamo GitHub Flow semplificato:**

- `main` è la sola long-lived branch, sempre stabile, sempre fonte di verità
- ogni macro-task nasce su una branch `feature/<topic>` (o `fix/<topic>` per bug)
- ogni branch confluisce in `main` via **Pull Request** soggetta a CI verde
- la PR viene chiusa con strategia **Squash and merge** dalla UI GitHub (history
  lineare di `main`: 1 PR = 1 commit)
- nessun push diretto su `main` dopo il commit di setup CI, salvo deroga
  esplicita dell'owner per piccoli aggiornamenti di documentazione
- `develop` e `release/*` **non vengono usati**

## Consequences

### Positive

- **Meno cerimonia**: zero double-merge per ogni cambio. Una sola PR, un solo
  click di merge, una sola voce in history.
- **History di `main` lineare**: ogni commit su `main` corrisponde 1:1 a una PR.
  `git log --oneline main` racconta esattamente lo sviluppo del progetto, senza
  rumore di "merge develop into main".
- **Code review forzata**: anche in single-dev, ogni cambio passa per la review
  visuale di una PR. Safety net contro errori di battuta e dimenticanze.
- **Rollback semplice**: 1 PR = 1 commit → `git revert <sha>` rimuove una
  feature intera in modo atomico.
- **Allineamento con CI**: il workflow `ci.yml` triggera su `pull_request`
  verso `main` e su `push` su `main`. Niente branch extra da proteggere.

### Negative / Trade-off

- **Divergenza esplicita dal brief §C12**: ogni nuovo contributor o reviewer
  esterno potrebbe aspettarsi `develop`. Mitigato da questo ADR e dal README.
- **No staging stream**: se in futuro esisterà un ambiente di staging che
  riflette automaticamente lo stato pre-prod, mancherà una branch di
  integrazione "pronta ma non in prod". Sarà il momento giusto per rivalutare
  (vedi sezione Reversibility).
- **Squash perde history granulare** dei commit intra-PR. Mitigato dal vincolo
  "PR piccole" e dalla possibilità di consultare i commit originali sulla
  branch prima del merge.

### Neutral

- I nomi delle branch (`feature/*`, `fix/*`) restano coerenti col brief; solo
  `develop` e `release/*` sono fuori scope.
- Branch protection rules su `main` (richiedere check verdi, dismiss stale
  reviews) sono operazione manuale GitHub UI dell'owner, fuori dallo scope di
  questo ADR.

## Considered Alternatives

### 1. GitFlow completo come da brief (main + develop + feature + release + hotfix)

- ✅ Massima flessibilità per release multi-stream, hotfix paralleli.
- ❌ Overhead sproporzionato per single-dev, no release pubbliche.
- ❌ `develop` diventa un duplicato di `main` se non c'è freeze period.
- ❌ Doppio merge per ogni cambio rallenta il ritmo di iterazione.

### 2. Trunk-based development puro (commit diretti su `main`, no feature branch)

- ✅ Massima velocità, zero overhead di PR.
- ❌ Si perde la safety net della code review forzata via PR — Nicolò ha
  dichiarato esplicitamente di volerla mantenere come disciplina.
- ❌ CI fallita su `main` blocca tutti finché non si fixa.

### 3. GitHub Flow standard con merge commit (no squash)

- ✅ Preserva history granulare dei commit intra-PR.
- ❌ History di `main` rumorosa: ogni PR aggiunge N+1 commit (N commit reali +
  1 merge commit). Per progetto in fase di apprendimento è preferibile leggere
  `main` come una sequenza di feature atomiche.

## Reversibility

Se in futuro:

- il progetto diventa multi-developer, oppure
- viene attivato un ambiente di staging persistente che richiede una branch di
  integrazione, oppure
- compaiono release pubbliche con cicli di freeze

→ si rivaluta con un nuovo ADR (ADR-00xx) che eventualmente reintroduce
`develop` e/o `release/*`. La reintroduzione è meccanica: nuovo branch, nuove
regole di protezione, aggiornamento workflow CI. Nessun debito tecnico nei file
di config attuali.

## Notes

- Pattern "Squash and merge" configurabile nella UI GitHub del repo:
  _Settings → General → Pull Requests → Allow squash merging_ (e idealmente
  disabilitare gli altri due metodi per non lasciare scappatoie).
- Convenzione naming: `feature/<topic>` per nuove funzionalità,
  `fix/<topic>` per bug fix. `ci/*`, `docs/*` ammessi come prefissi per cambi
  ristretti a quei domini.
- Quando una PR è di solo refactor o solo docs, il prefisso del titolo PR
  rispecchia il Conventional Commit del merge commit risultante
  (`refactor: …`, `docs: …`).
