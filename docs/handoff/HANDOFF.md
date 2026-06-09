# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ 55c7f8a (+1 commit docs(handoff) in arrivo via PR).
> **Data:** 2026-06-09.

---

## PARTE A — Stato del progetto

### Dove siamo

Monorepo pnpm + Turbo, 2 verticali sulla base condivisa `packages/` (`@gestionale/db`, `db/nest`, `auth`, `auth-web`, `platform`, `shared`, `ui`, `api-client`, `i18n`):

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): completo (F1 Menu CRUD + UI).
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): in costruzione attiva. Stato end-to-end:
  - **skeleton** (ADR-0029/0030)
  - **`aziende`** anagrafica clienti — backend (ADR-0031) + UI (ADR-0032): CRUD, 15 campi, RLS, partial-unique, seed demo
  - **`referenti`** satellite 1:N di aziende — backend (ADR-0033) + UI (ADR-0034): CRUD nested `/aziende/:aziendaId/referenti`, detail `clienti/[id]` (primo segmento dinamico del verticale), seed demo, fix Sidebar active-state per prefisso
  - **RLS isolation anagrafica testata DB-level** (ADR-0035): spec `rls-isolation.e2e-spec.ts` boota l'app come `gestionale_app` (NOSUPERUSER NOBYPASSRLS) → policy `aziende`/`referenti` esercitate davvero
  - **`preventivi`** — backend (ADR-0036): testata + voci, figli di aziende, **prima business logic** (ricalcolo totali server-side) + **prima tx atomica** del verticale + **pattern replace-collezione-in-tx** (riusabile per fatture). e2e 39/39 locale.

Catalogo permessi: **35** (aggiunti `preventivi.{visualizza,gestisci}` in STOP-e1).

### Prossimo task — STOP-e2: UI preventivi

UI del backend preventivi (ADR-0036): lista + detail + **editor voci con totali live** (il pezzo dove la business logic si vede a schermo). Slice **FULL**. Da impostare con STOP 0 sull'anatomia FE reale (riuso pattern detail `clienti/[id]` + form-in-Card + come restaurant-web fa editor con righe). Decisione aperta da prendere a STOP 0: dove agganciare la UI preventivi — sotto `clienti/[id]` (sezione, come referenti) oppure nav/route dedicata. L'editor voci (array dinamico righe + ricalcolo totali client-side mirror del server) è la parte non banale.

### Orizzonte (dopo e2)

- **TD candidate — RLS preventivi**: estendere `rls-isolation.e2e-spec.ts` ai preventivi (policy `preventivi_*` installata ma non esercitata DB-level; gli e2e CRUD girano superuser). Coerente col TD-RLS anagrafica già chiuso. Sub-slice o STOP dedicato.
- **`fatture` / FIC**: lo slot nav "fatture" NON ha tabella StudioDesk diretta — esiste `fic_billing` (integrazione Fatture in Cloud, 4 tabelle, integration-heavy) come opzione. Decisione di prodotto rimandata.
- **Catalogo servizi** (`servizi_catalogo`/`servizi_categorie`): deferito da preventivi MVP; slice futura se serve riuso voci ricorrenti.
- **Versioning/workflow preventivi** (versione, accettazione self-service cliente, stati `scaduto`/`revisione_richiesta`): deferiti, richiedono anche portale cliente.
- **Brand "One Platform"**: rename deferito a 3 livelli (display-only / repo / scope `@gestionale/*`). Nota: durante questa sessione è stato tentato e **scartato** un edit al titolo di `PROJECT_BRIEF.md` (rimozione "Ristorazione") — il rename va affrontato come decisione completa, non edit di passaggio.

### Tech debt aperti

- **TD-BV** — l'intera suite e2e gira come `postgres` superuser (bypassa RLS). Mitigato per il dominio anagrafica da `rls-isolation.e2e-spec.ts` (Sub-1, ADR-0035); la **conversione dell'intera suite** a non-superuser resta deferita (Sub-2), da valutare dopo fatture.
- **TD candidate RLS preventivi** — vedi sopra (estensione dello spec rls-isolation).
- **TD-BS Sub-2** — copertura e2e `ValidationPipe→400` bloccata dal harness (vitest 3.x non eredita i plugin SWC nei `test.projects` → no `design:paramtypes` runtime per i DTO). Validation 400 coperta da unit DTO; integrazione garantita in prod da `tsc`. Valore incrementale basso.
- **TD-CB** — la suite e2e backend (accountant + restaurant) è **solo-locale**, non gira in CI. Su CI: unit + Playwright FE. Le garanzie "N/N e2e" sono locali.
- **TD-BY** — pricing resolution, defer S23 (verticale ristorazione).

### Convenzioni di processo (in vigore)

- **Gate a due corsie** (dal 2026-06-09, in PROGRESS): STOP-gate calibrato al rischio. **FULL** se la slice tocca schema/migration/RLS/tx/business-logic/auth-permessi/pattern-nuovo (→ ADR dedicato). **LEAN** se CRUD puro che replica un pattern già in ADR, zero DP nuove (→ 1 solo spot-check, entry PROGRESS che linka l'ADR-pattern, niente ADR dedicato). Routing a STOP 0: nessuna DP sostanziale → LEAN; in dubbio → FULL.
- **Self-check report a STOP 2**: Claude Code esegue le verifiche meccaniche (status/header/RLS/file-staged/typecheck/lint/e2e/divergenze) e consegna il report PASS/FAIL **prima** del diff. Claude strategico reviewa il giudizio + legge il diff (un blocco unico salvo FULL grosso).
- **Principio guida**: test-bed ora, opzione prodotto in futuro (provarlo a studi amici → valutare vendita). Si investe in **fondamenta ready/scalabili di default**, NON in profondità di dominio o feature premature finché uno studio reale non le richiede. Barra di scope: "lo costruirei comunque per il test-bed?".
- STOP-gate: STOP 0 (preflight empirico read-only) → 1 (spec + DP) → 2 (spot-check/self-check) → 3 (commit/PR/ADR). Merge SEMPRE separato da `gh pr checks --watch`, solo dopo via esplicito di Nicolò.
- `git add` selettivo (mai `-A`); commitlint header ≤100; path con `[slug]`/`[id]` quotati; `docs/studiodesk/` READ-ONLY; host SSH `portal` = produzione, mai scrivere.

### Note operative

- Dev server (web:3003 / API:3002): **fermati** a fine sessione (porte libere). Riavvio in `pnpm dev`; al disconnect SSH i figli Turbo si orfanizzano → kill per **PGID** (parent prima dei figli) per neutralizzare `--respawn`.
- e2e accountant: `pnpm --filter @gestionale/accountant-api test:e2e` (Testcontainers, locale). Suite attuale: aziende-crud 11 + referenti-crud 11 + rls-isolation 5 + preventivi-crud 12 = **39**.
- Migration: flow `add_aziende` (`prisma migrate dev --create-only` → appendi blocco RLS/partial-unique a mano → applica). RLS policy `<table>_tenant_isolation` USING-only + FORCE.

---

## PARTE B — Snapshot tecnico

### Git

- **Main @ 55c7f8a** (+1 commit docs(handoff) in arrivo via PR) — `feat(accountant-api): preventivi backend (testata+voci, tx atomica + totali) (#81)`
- Working tree pulito, branch unico `main` allineato a `origin/main`. Nessun branch feature pendente.
- PR mergiate nella sessione: #76 (aziende UI), #77 (referenti BE), #78 (referenti UI), #79 (RLS test), #80 (convenzione gate), #81 (preventivi BE).

### ADR

Fino a **ADR-0036**. Ultimi del 2° verticale: 0029/0030 (skeleton), 0031/0032 (aziende BE/UI), 0033/0034 (referenti BE/UI), 0035 (RLS isolation anagrafica), 0036 (preventivi backend).

### Schema dominio accountant (su `aziende`)

- `Azienda` (anagrafica clienti, 15 campi, partial-unique `codice`, soft-delete, RLS)
- `Referente` (satellite 1:N, FK azienda+tenant Cascade, enum `RuoloReferente`, soft-delete, RLS)
- `Preventivo` (testata: codice partial-unique, enum `StatoPreventivo`, 3 totali Decimal(12,2), soft-delete, RLS) + `PreventivoVoce` (righe: snapshot custom, enum `UnitaMisura`, `tenantId` proprio + RLS dedicata, no soft-delete)

### Stack & ambiente

- NestJS 11, Next.js 15, Prisma 6, PostgreSQL 16 (RLS), Redis 7, Vitest 3.2.4, Testcontainers, Playwright, Tailwind 3.4, shadcn/ui, tsup/esbuild.
- Server Hetzner `gestionale-test` (Ubuntu 22.04), Docker Compose `docker-compose.dev.yml`. Ruolo runtime DB `gestionale_app` (NOSUPERUSER NOBYPASSRLS), migration via `postgres` superuser (DIRECT_URL).
- Tenant demo: `studio-demo` (`admin@studio.local` / `Studio123!`), + `studio-acme` per test isolamento.
