# ADR-0064 — Seed utente per-ruolo food (Direzione) + copertura FE-5 drag-persist

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Tier:** BASSO ([ADR-0063](./ADR-0063-tiering-stop-gate.md) — additivo, idempotente, coperto da CI, nessuna superficie live)
- **Predecessor:** [ADR-0058](./ADR-0058-tavoli-mappa-sala-f2.md) (F2 mappa sala), [ADR-0059](./ADR-0059-smoke-funzionale-per-verticale-per-ruolo.md) (smoke per-ruolo), [ADR-0037](./ADR-0037-preventivi-ui.md) (seedDevCollaboratore, stesso pattern)
- **Branch:** `feat/fe5-drag-persist-direzione-seed`

## Context

Il drag-drop della mappa sala (F2, ADR-0058) persiste `posX/posY` via `PATCH /tables/:id`, gated su `tavoli.gestisci`. La contract **API** è coperta (restaurant-api `tables-crud #4` persist + `tables-rbac` viewer→403), ma il drag **reale nel browser** (pointer-event → PATCH) non era mai stato esercitato: buco storico **FE-5**, deferito in #138 per il working tree condiviso.

Radice del buco di copertura: il seed dev assegnava a **ogni** utente dei tenant food solo il ruolo **Super Admin** (`seedDevTenant`). Non esisteva un utente food **non-superuser** con `tavoli.gestisci` con cui esercitare — e provare — il gating runtime `canManage`. Gli unici non-super seedati (`collaboratore@studio.local`, `cliente@studio-demo.local`) sono sul verticale studio, senza permessi `tavoli.*`.

## Decision

1. **Utente per-ruolo food nel seed principale.** `seedDevDirezione(demo)` aggiunge `direzione@demo.local` (ruolo `Direzione`, food — possiede `tavoli.visualizza` + `tavoli.gestisci`) sul tenant `demo`, clonando il template `Direzione` in un ruolo tenant-wide. Stesso impianto idempotente di `seedDevCollaboratore` (ADR-0037): find-then-create su email+tenant, ruolo, mappings, assignment. `seedDevTenant` e i ruoli Super Admin **non** vengono toccati: l'utente è aggiunto esplicitamente accanto ad `admin@demo.local`.

   L'utente è **riusabile**: oltre a FE-5, è il soggetto naturale per lo smoke per-ruolo food (ADR-0059) e per ogni futuro test di gating `tavoli.*` runtime.

2. **Tavoli demo.** `seedDevTavoli(demo)` semina 1–2 tavoli (idempotente su `numero`+tenant) come target draggabile stabile — la mappa richiede ≥1 tavolo.

3. **Copertura FE-5 eseguibile.** `apps/restaurant-web/e2e/mappa-drag-persist.spec.ts` (Playwright): login come `direzione@demo.local` (non-super) → assert controlli gestione visibili (`canManage===true`) → drag reale via `page.mouse` → `PATCH /tables/:id` **200** → reload → posizione persistita. Handle di test: `data-testid="mappa-canvas"` + `data-testid={`tavolo-${id}`}` (solo attributi di test, nessuna stringa user-visible, nessun cambio logica/layout).

   Coerente col principio ADR-0063: il moltiplicatore di sicurezza è la **copertura eseguibile**, non un nuovo STOP.

## Consequences

- FE-5 non è più scoperta: una regressione del drag→persist (path fetch errato, cookie/token, gating rotto) fa fallire la CI.
- Un utente food non-super esiste stabilmente nel seed, sbloccando smoke/e2e per-ruolo futuri.
- Nessuna modifica di dominio/schema: solo dati seed additivi idempotenti + test + `data-testid`.

## Tech debt registrato (TD candidate — fuori scope, da schedulare)

- **TD-seedDevTenant-solo-superadmin.** `seedDevTenant` assegna strutturalmente **solo** il ruolo Super Admin. Ogni utente per-ruolo (Collaboratore, Cliente, ora Direzione) è aggiunto a mano con una funzione dedicata. Il buco strutturale resta: un tenant dev nasce senza copertura di ruoli non-super. Fix candidato: parametrizzare `seedDevTenant` con una lista di ruoli/utenti, o un helper generico `seedDevUserWithRole(tenant, roleName, user)`.

- **TD-dev-env-punta-prod.** Su questo host `.env` `DATABASE_URL` → `127.0.0.1:5432` = container `gestionale_postgres` che serve la **prod** `food.studiodesk.cloud`. Qualsiasi `db:seed` / dev-run locale eseguito senza override colpisce la produzione (annullerebbe il purge #143). Mitigazione usata in questo task: DB Postgres **isolato** throwaway (porta 55432, volume effimero) con `DATABASE_URL`/`DIRECT_URL` passati inline; prod mai toccata. **Rischio sistemico**, fix fuori scope: separare l'ambiente dev dal DB prod (es. `.env.dev` dedicato / compose dev con volume distinto / guard che rifiuta `db:seed` se l'host DB risolve al container prod).

- **TD-smoke-rls-conteggi-seedcoupled.** Le smoke RLS (`smoke-rls-core.ts` S1/S2, `smoke-rls-e2e.ts`) asseriscono l'isolamento tenant tramite **conteggi esatti** hard-coded del seed (es. `demo.users === 2`). Ogni utente/ruolo aggiunto al seed di un tenant coperto rompe l'asserzione, che va aggiornata a mano (è successo qui: S1 da `=1` a `=2`). Il conteggio esatto resta un rilevatore di leak valido, ma **accoppia una smoke di security al seed** in modo invisibile allo scope-lock (una modifica seed apparente tier-basso tocca una superficie tier-alto). Fix candidato: asserzioni **no-leak indipendenti dai conteggi esatti** — verificare direttamente che in demo-ctx le righe possedute da acme NON siano visibili (per id/slug specifici), scorrelando la rilevazione di leak dalla cardinalità del seed.
