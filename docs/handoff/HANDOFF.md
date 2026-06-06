# HANDOFF — Gestionale ("One Platform")

> Documento di ripartenza sessione. Sostituito **in blocco** a fine sessione ("finito per oggi").
> Gerarchia: se questo file e `PROGRESS.md` divergono sullo stato, vince `PROGRESS.md`.
> Lo stato volatile (hash, conteggi test) va sempre **riletto dai file/CI**, mai dalla memoria.

---

## PARTE A — Metodo (stabile)

### Sistema a tre ruoli

- **Claude strategico** (chat): architettura, ADR, STOP-gate, pre-merge review, artefatti handoff/backup.
- **Claude Code** (VS Code Remote-SSH): file ops, git, esecuzione test, terminale.
- **Nicolò**: orchestratore, paste-relay, decisioni di scope.

### STOP gate chain

- **STOP 0** preflight read-only: legge la fonte autorevole (BRIEF, ADR, pattern esistenti) **e** verifica empiricamente path/firma/struttura prima di impegnare scope. Mai dedurre da "intuizione senior".
- **STOP 1** spec: file-list esatta, ordine operazioni, gate. Per touch su shared-config (vitest/turbo/tsconfig/build/CJS-ESM): (1) baseline pre-fix, (2) gate full-suite prima di ADR/PR, (3) verifica shape/comportamento reale. Se interop rompe → STOP + evidenza + fallback, mai forzare.
- **STOP 2** pre-merge spot-check: il diff si verifica sul **testo/output reale**, mai sulla parola di Code (verifica-non-fiducia).
- **STOP 3** commit + PR.
- Eval output di Code: ogni self-correction / punto attenzione → verdetto Accept / Reject / TD, check collisioni naming ID, cattura in commit + ADR + PROGRESS.

### Merge flow (terminale, NON UI)

- Squash merge fatto da **Claude Code via terminale**: `gh pr merge <N> --squash --delete-branch`. NON da Nicolò via GitHub UI.
- Mai `gh pr checks` e `gh pr merge` nello stesso comando/paste. Prima `gh pr checks --watch` **da solo** → conferma verde di Nicolò → `gh pr merge` in comando **separato**.
- `gh pr merge --squash` allinea già il local main (nessun `git branch -D` forzato). Post-merge: `git checkout main && git pull --prune && git log --oneline -1`.
- Branch protection server-side **assente** (GitHub Free privato): il guard-rail è **procedurale**.
- Pre-push hook (ADR-0004) blocca il push diretto su main → ogni cambiamento passa da PR, anche solo-doc. CI gira su tutte le PR (no path filter). commitlint: header ≤ 100 char.

### Doc versionati / anchor-stability

- HANDOFF a `docs/handoff/HANDOFF.md`, versionato, portato a main via PR `docs/` dedicata (`docs(handoff): ...` su branch `docs/...`).
- Anchor-stability: titoli/heading dei doc versionati NON cambiano se ci sono cross-link; si estende il corpo, si preserva il titolo.
- prettier: `PROJECT_BRIEF.md`, `PROGRESS.md`, `STARTER_PROMPT.md`, `docs/studiodesk/` **esclusi** (`.prettierignore`). `apps/README.md` e `docs/architecture/ADR-*` **NON esclusi** → devono restare prettier-clean (gate `format:check`).
- Convenzione snapshot: in Parte B scrivere `Main @ <ultimo commit di contenuto> (+1 commit docs(handoff) in arrivo via PR)`. L'HANDOFF non può citare lo SHA del commit che lo merge (riferimento circolare).

### Disciplina scope / debito

- Empirical-first: niente claim "fuori scope / non impatta / caso minimo" senza verifica grep/cat (Errore #25). Evidenza visiva/narrativa non sostituisce grep/cat (Errori #18, #23). Sweep "atteso vuoto" vale sui **path vivi**, non sulle citazioni storiche.
- YAGNI / no astrazione prematura (BRIEF §F1): si estrae il core quando emerge il bisogno reale (2°+ consumer), non si indovina.
- Rabbit-hole → Sub-1 (ora) / Sub-2 (differito, confine esplicito). Fix scope-adjacent < 5 min: atomici nel commit principale.

### Comunicazione

- Nicolò scrive corto ("a", "procedi", "ok tua raccomandazione"/"consigliami tu" = delega → pushback rispettoso UNA volta con opzioni esplicite, poi si procede; ripetizione = accettata).
- Artefatti per Code: solo drop-in (artifact + present_files), no meta. Spiegazioni in chat solo quando ci sono decisioni.
- Opzioni A/B/C con raccomandazione motivata.

### Chiusura sessione

- HANDOFF (Parte A + Parte B completo) SOLO a "finito per oggi". Sostituzione in toto.
- Messaggio a Code di chiusura = richiesta VERIFICA FINALE (tree pulito, main allineato, nessun pendente, PROGRESS aggiornato), NON handoff narrativo.

### Ambiente

- Hetzner CPX32, Ubuntu 22.04, host SSH `gestionale-test`, repo a `/home/deploy/projects/gestionale`. VS Code Remote-SSH da Mac (shortcut Cmd).
- ⚠️ **Esiste un SECONDO host SSH `portal`** = server StudioDesk PHP in **produzione** (`/var/www/portal`). NON è il repo Gestionale: non scriverci (permessi negati by design). Verificare `hostname`/`pwd` se in dubbio.
- Repo `MontaNic/gestionale-piattaforma` (privato). GitHub web fetch fallisce su repo privato → Nicolò incolla file raw.
- pnpm workspaces (`apps/*`, `packages/*`, `plugins/*`) + Turborepo + tsup/esbuild. Node 20.18.1.
- `docker-compose.dev.yml` (flag `-f`). `redis-cli` assente di default (`sudo apt install -y redis-tools`). Porte: `sudo ss -tlnp | grep -E "3000|3001"`.
- tsup decorator metadata: `design:paramtypes` emesso solo se `experimentalDecorators`+`emitDecoratorMetadata` dichiarati nel tsconfig del package (base inheritance insufficiente) → probe STOP 0.5 prima di committare la build strategy.
- PII: se Nicolò incolla IP/host/secret/token/email private/path-username → flag + oscura negli output successivi (`xxx.xxx.xxx.xxx`). Mai PII nei backup memoria.

---

## PARTE B — Stato (volatile)

### Dove siamo

- **Main @ `c6fb5c6`** (ultimo commit di contenuto; questo HANDOFF arriva su main con un ulteriore commit `docs(handoff)` via PR dedicata).
- Working tree pulito, nessun branch di sessione, nessun pendente.
- Test: **142 unit / 13 task turbo · e2e api 56 pass / 4 skip · Playwright 14**. (Rileggere da PROGRESS/CI, non dalla memoria.)
- Estrazione core ADR-0027 §D5 **completa**. Verticale ristorazione = scaffold congelato. TD-CC **risolto**.

### Fatto questa sessione (4 PR)

- **#66** cleanup README/PROGRESS post-estrazione core.
- **#67** import StudioDesk → `docs/studiodesk/`: dev guide (`STUDIO_DESK.md`, 4447 righe) + 67 file SQL DDL (`sql/00_master` control-plane + `01_studio_template` per-tenant + migration). Database-per-tenant. Zero PII (solo DDL + seed/config; scan email/CF/secret negativo). Esclusi da prettier.
- **#68** **TD-CC: rename verticale ristorazione** `apps/api,web` → `apps/restaurant-api,restaurant-web` + package `@gestionale/restaurant-*`. Diff meccanico simmetrico 96/96, storia preservata via `git mv`, gate verde = baseline. Convenzione naming stabilita per `apps/accountant-*`.
- **#69** allineamento doc post-rename (`apps/README`, BRIEF, ADR-0027 §240) + nota brand "One Platform" (BRIEF §F7, **differita**) + PROGRESS bookkeeping TD-CC risolto.

### Prossimo passo — avvio 2° verticale = commercialisti

Vincoli (ADR-0025/0027): app separata `apps/<verticale>` che consuma i `packages/`; riusa il **modello dati** di StudioDesk (NON il codice PHP); **core di dominio NON estratto ora** (no astrazione prematura, BRIEF §F1).

**Arco scelto (opzione A):** rename TD-CC [FATTO] → walking skeleton `accountant-*` → prima slice dominio (`aziende`) → incrementi. Lo skeleton è decomposto in STOP separati (isolamento rischi: composizione vs modellazione vs package-refactor).

**STOP-a (IL PROSSIMO) — estrazione `DbService` → `@gestionale/db/nest`.** Decisione **C**, verificata empiricamente sul grafo:

- `DbService` = wrapper lifecycle (`$connect`/`$disconnect`) di ~30 righe sul singleton `prisma`. Importa SOLO `@nestjs/common` + `@gestionale/db`. Grafo **aciclico**: `@gestionale/db` non importa alcun `@gestionale/*` (verificato), quindi `db/nest → db` è freccia sola. Il ciclo `platform → apps/api/db` di ADR-0027 §222 **non esiste più post-§D5** (verificato).
- Estrazione = **sub-entry NestJS** in `@gestionale/db` (`@gestionale/db/nest`), additivo. NON un package nuovo. Oggi `exports` è single-entry (`.`): va aggiunto multi-entry + dual build.
- Ri-cablare `restaurant-api`: cancellare `src/db/` locale, ripuntare i **6 consumer** (`articles`, `article-prices`, `menu-categories`, `price-lists`, `menus`, `health`) + `app.module.ts` al sub-entry. Gate full-suite: `restaurant-api` DEVE restare verde (baseline pre-fix obbligatoria).
- `health` e `me` **restano app-level** (thin; `health` tira `@gestionale/auth`, tenerlo in-app evita di accoppiare `db/nest` ad `auth`). Si duplicheranno (~45 righe) nello skeleton — accettabile, isolato, non cresce.
- **⚠️ Preflight residuo (fare a STOP 0 PRIMA di blindare la spec):** leggere il build config di `packages/db` (tsup? come si configura un dual sub-entry export CJS+ESM), il pattern `exports` multi-entry, e come `restaurant-api` consuma oggi (CJS). Probe STOP 0.5 sui decorator metadata del sub-entry NestJS prima di committare la build strategy.

**STOP-b — walking skeleton `accountant-api` + `accountant-web`** (boot + auth/login + `me`, ZERO dominio):

- Backend: replica `main.ts` + `app.module.ts` **core-only** (Config, Db via `@gestionale/db/nest`, Redis, Mail, Throttler, Tenant, Users, Auth, Me, Health, Tenants, Rbac + i 4 APP_GUARD in ordine deterministico Throttler→Jwt→TenantConsistency→Permissions + `TenantContextInterceptor` + `TenantMiddleware` su `login`/`login-pin`) + `health` + `me` + `app.controller`. **NO** `menus`/`menu-categories`/`articles`/`price-lists`. Deps: `@gestionale/{auth,db,platform,shared}`.
- Frontend: **anatomia `restaurant-web` (shell/auth riusabile vs route dominio menu da scartare) ANCORA DA LEGGERE** — preflight non completato in questa sessione. Primo blocco di STOP 0 per `accountant-web`.

**STOP-c — prima slice dominio = anagrafica `aziende`** (da StudioDesk):

- DDL `aziende`: FK posticipate (workaround MySQL dipendenze circolari), soft-delete (`eliminato`/`eliminata_il`), unicità naturale `codice` → convenzione partial-unique-index `WHERE deleted_at IS NULL` (Pattern 42), policy RLS dedicata, modulo NestJS + DTO, UI lista/form, e2e isolamento tenant. STOP 0 dedicato sul DDL.

### Note / parcheggi

- **"One Platform"** (BRIEF §F7): rebrand futuro, 3 livelli (brand → repo `gestionale-piattaforma`→`one-platform` → scope `@gestionale/*`→`@oneplatform/*`). Se mai fatto, il livello 3 va **prima** di aggiungere altri verticali (churn scala coi package). NON deciso.
- **StudioDesk control-plane** (`portal_master.studios`: slug→{db_host,db_name,db_user,db_pass}) = esattamente il control plane `tenant→{mode,connString}` di ADR-0026 §D4. Allineamento confermato a livello schema (fase 2 tenancy resta deferita).

### Differiti / TD aperti

- **Fase 2 tenancy** (ADR-0026 §D4: RoutingKey, connString per-tenant) — trigger = bisogno multi-DB reale.
- **TD-BV**: e2e api girano come superuser Postgres → blind spot RLS strutturale. Convertire a ruolo non-superuser (`gestionale_app`). Mitigato da `smoke:rls-core` in CI.
- **TD-BY** backend pricing resolution (multi-match channel/priority) — differito al primo consumer (Cassa), YAGNI.
- **TD docs futuro**: se arriva il **3° verticale**, `health`/`me` diventano candidati estrazione reali (3 copie = bisogno dimostrato).
- **`health` module**: resta app-level (concern applicativo, comporrebbe accoppiamento se estratto in package condiviso).
