# HANDOFF — file unico di ripartenza

> **Come ripartire in una chat nuova con Claude (strategico):**
> incolla **questo intero file** + il contenuto aggiornato di **`PROGRESS.md`**.
> Questi due bastano. Claude non porta la cronologia tra le chat: la verità sta nei file.
>
> Il file ha 2 parti: **PARTE A — stabile** (come si lavora, cambia raramente) e **PARTE B — stato corrente** (dove siamo, da aggiornare a fine di OGNI macro-sessione).
> Aggiornando lo stato, modifica SOLO la Parte B. Non toccare la Parte A se non per cambiare davvero il metodo.

═══════════════════════════════════════════════════════════════

# PARTE A — STABILE (metodo e regole di ingaggio)

═══════════════════════════════════════════════════════════════

## Fonti di verità (nel repo)

- ADR: `docs/architecture/` (0025 scope/SVOLTA, 0026 data layer database-per-tenant, 0027 composizione core, + tutti i precedenti)
- Stato dettagliato: `PROGRESS.md` (FONTE PRINCIPALE — incollala sempre insieme a questo file)
- Scope: `PROJECT_BRIEF.md`
- Metodo sessioni Code: `STARTER_PROMPT.md`
- Gerarchia: se questo file e PROGRESS divergono, **vince PROGRESS**.

## Metodo di lavoro (triangolo)

- Claude chat = strategia + verifica delle conclusioni di Code (verifica, non fidarti)
- Claude Code = esecuzione (VS Code Remote-SSH)
- Nicolò = arbitro / decisioni finali, paste-relay tra gli agenti
- Ciclo task: Decidere → Preparare → Attuare → Verificare → Registrare (commit + PROGRESS aggiornato)
- Estrazione core: un package per PR, gate test verdi costanti, ordine da ADR-0027 §D5. **(estrazione core COMPLETA — vedi Parte B)**

## Catena STOP (come si conduce un passo)

- **STOP 0** = preflight empirico read-only (leggi BRIEF/ADR + grep/find/cat il codebase; non dedurre da "foundation pulita").
- **STOP 0.5** = probe mirata quando un meccanismo non è deducibile (es. build) — verifica empirica prima di impegnare lo scope.
- **STOP 1** = spec di implementazione con assunzioni Ax dichiarate + confini espliciti. Apri con micro-verifiche inline sui punti non certi (non assumere).
- **STOP 2** = spot-check pre-merge (comando singolo). I check `grep -i` su stringa vanno SEMPRE disambiguati (pescano commenti) — mai dedurre dal primo esito. **Pre-commit usa `git diff main` (working tree vs main), NON `main...HEAD` (range commit, vuoto finché non committi).**
- **STOP 3** = edit doc (se chiude un passo) + commit + push + PR + `gh pr checks --watch` da solo.
- Decisioni multi-opzione: A/B/C con raccomandazione motivata (★). Push-back UNA volta se rischioso, poi rispettare l'arbitro.
- Scomposizione: se un passo mescola refactor ed estrazione (o rischioso e meccanico), spezzalo in sotto-PR (es. 8b-1 seed + 8b-2 indirezione).

## Regole di ingaggio (come Claude chat lavora con Nicolò)

**Tono:** feedback diretto e onesto, MAI elogi/lodi gratuite, niente celebrazioni. Rispondere in italiano. Messaggi brevi di Nicolò ("ok", "A", "procedi", "tua raccomandazione", "confermo") = approvazioni/comandi; "tua raccomandazione"/"decidi tu" = delega esplicita (procedi senza ulteriore push-back).

**Assicurazione:** meglio lento e verificato che veloce e fragile, mai scorciatoie. UN PASSO ALLA VOLTA, aspettare il via. Per git/merge/server: comandi esatti da incollare + aspettare l'esito.

**Merge e CI — REGOLA FERMA:** branch protection server-side NON disponibile (GitHub Free privato), `--auto` NON è un guard-rail. Il guard-rail è procedurale:

- MAI dare `gh pr checks` e `gh pr merge` insieme.
- Prima, da solo: `gh pr checks <N> --watch` (o senza N, infersce dal branch). NB: se la CI non è ancora partita può rispondere "no checks reported" → ri-eseguire finché riporta i check reali.
- Solo DOPO conferma "verde" di Nicolò, in comando SEPARATO: `gh pr merge <N> --squash --delete-branch`.
- Dopo il merge: `git checkout main && git pull --prune && git log --oneline -1`.
- `gh pr merge --squash` fa fast-forward e allinea già il local main (nessun residuo da pulire).

**Verifica, non fiducia (verso Code):** le CONCLUSIONI di Code vanno verificate, non archiviate. Code esegue bene; stime/diagnosi possono essere imprecise. Quando un'assunzione load-bearing risulta falsa al Passo 0, Code si ferma e segnala (comportamento corretto).

**Artifact:** produrre drop-in copy-paste (file via create_file + present_files) per i prompt a Code, senza meta-spiegazioni. Eccezione: spiegazioni in chat quando ci sono decisioni/Sub-DP. Dopo verdetto + GO: file diretto + max 1-2 righe.

**Chiusura sessione:** l'HANDOFF (questo file) si dà SOLO quando Nicolò dice "finito per oggi", sempre completo (Parte A + B) da sostituire in toto. NON produrre handoff narrativo per Code; al suo posto un messaggio di VERIFICA FINALE per Code (working tree pulito, main allineato, nessun pendente, PROGRESS aggiornato). L'HANDOFF è versionato in `docs/handoff/HANDOFF.md`: dopo averlo sostituito a fine sessione, va portato su main via **PR `docs/` dedicata** (commit `docs(handoff): …` su branch `docs/…`, poi PR + CI verde + squash-merge). **NO push diretto su main** (pre-push hook ADR-0004 lo vieta). La CI gira anche sulle PR solo-doc. commitlint: header ≤100 char. La verifica finale di Code = working tree pulito DOPO il merge.

**Sicurezza — cosa Claude NON fa:** non maneggiare token/password/credenziali (auth la fa Nicolò); non delegare a Code installazioni di sistema o credenziali; se Nicolò incolla dati sensibili (IP/host/segreti), segnalarli e redarli dopo.

**`git stash` — trappola nota:** mai usare `git stash` per ispezionare un diff con modifiche non committate (rischio di revert silenzioso dello stato + falsa lettura; cfr. incident `2151e4f`). Usa `git diff` non distruttivo.

## Packaging package (regola appresa)

- Consumato solo da Next → `transpilePackages` (es. ui, i18n, api-client, auth-web).
- Consumato anche da apps/api (NestJS/CJS) → dual-package tsup (es. db, shared, platform, auth).
- I dual-package consumati da apps/api vanno aggiunti allo step "Build workspace packages" del job `e2e-playwright` in `ci.yml` (gira fuori da Turbo, `^build` non scatta). Ordine topologico: db/shared prima dei package che li consumano.
- **Package NestJS dual (convenzione verificata):** il `tsconfig.json` del package deve dichiarare ESPLICITAMENTE `experimentalDecorators: true` + `emitDecoratorMetadata: true` (il base NON li eredita); `tsup.config.ts` deve avere `external` sui runtime NestJS. Senza, la DI si rompe a runtime (invisibile in build).
- **Turbo task che esegue codice dipendente dal `dist/` di un workspace interno** deve dichiarare `dependsOn: ["^build"]` (Discovery #53: senza, `dist/` stale → named export `undefined` silenzioso). Vale per `test`, `test:e2e`, `typecheck`.

## Cosa NON fare

- NON incollare l'intera chat precedente: dispersivo. Stato strutturato > cronologia grezza.
- NON affidare lo stato alla memoria: scriverlo nei file.
- NON introdurre "miglioramenti" non richiesti in un refactor/estrazione (anti-astrazione-prematura §F1; confine core/dominio; un-passo-per-PR).

═══════════════════════════════════════════════════════════════

# PARTE B — STATO CORRENTE (⚠️ AGGIORNARE a fine di ogni macro-sessione)

═══════════════════════════════════════════════════════════════

**Ultimo aggiornamento:** 2026-06-05 (passo 9 — chiusura estrazione core ADR-0027 §D5)
**Main @:** `c483908`
**Test:** 142 unit (13 task turbo: 43 api + 39 auth + 13 platform + 12 auth-web + 10 api-client + 9 ui + 8 i18n + 5 shared + 3 db) · 56 E2E pass / 4 skip · 14 Playwright chromium

## Fase corrente

**Estrazione del core condiviso (ADR-0027 §D5): COMPLETA.** I passi 1→9 sono chiusi. Il core tecnico agnostico vive interamente nei `packages/*`. `apps/api` + `apps/web` = verticale ristorazione, **scaffold congelato** (ADR-0025). La SVOLTA 2026-06-01 (da gestionale-ristorazione a piattaforma-a-verticali con core condiviso) è ora strutturalmente realizzata.

## Passi estrazione completati e mergiati (ADR-0027 §D5)

1. ✅ packages/eslint-config
2. ✅ packages/ui (+ smoke test render)
3. ✅ packages/shared (dual tsup — error-codes unificati)
4. ✅ packages/i18n (meccanismo; messaggi restano per-app)
5. ✅ 5a packages/api-client + 5b packages/auth-web (PR #52)
6. ✅ packages/platform (primo NestJS dual; redis/mail/throttler/common; `health` differito) — PR #57
7. ✅ packages/auth — 7a disaccoppia `DbService`→singleton `prisma` (#58) + 7b git mv 39 file (#59). Wiring 4 APP_GUARD+interceptor+middleware resta in `app.module.ts`, byte-identico (Discovery #36)
   8a. ✅ Prerequisito RLS — `smoke:rls-core` (9 scenari core-only come `gestionale_app` non-superuser) in CI job `e2e-playwright` — PR #60
   8b-1. ✅ Separazione seed core/dominio (`seedDevMenu` estratto da `seedDevTenant` a fase top-level) + convention confine schema (no split file) — PR #62 (`57c392a`). Behavior-neutral, idempotenza verificata sotto non-superuser
   8b-2. ✅ Indirezione `getClientForTenant(ctx: TenantContext): ExtendedPrismaClient` (fase 1: ritorna sempre il singleton, ctx ignorato) + addendum ADR-0026 §D4 (ownership routing-key) — PR #63 (`3264902`)
8. ✅ Riframe verticale a scaffold (documentale) — PR #64 (`c483908`). Naming A (mantieni `apps/api`/`apps/web`), differiti chiusi, `apps/README.md` di confine creato

## Decisioni architetturali chiave dell'estrazione (riferimento)

- **§D4 ownership routing-key (ADR-0026 addendum 8b-2):** la mappa routing-key (slug→tenant, futuro tenant→{mode,connString}) vive nel **layer tenancy** (oggi i 3 lookup `slug→tenantId` in `@gestionale/auth`: `tenant-consistency.guard.ts`, `tenant.middleware.ts`, `tenants.service.ts`; futuro `packages/tenancy`). `packages/db` espone solo il **consumer** `getClientForTenant`, riceve un ctx già risolto. **Evidenza dirimente:** la mappa cached dipende da Redis (`@gestionale/platform`), e `platform` dipende già da `db` → farla scendere in `db` creerebbe il ciclo `db↔platform`.
- **Fase 1 vs fase 2 (ADR-0026 §D3/§D6):** fase 1 = solo l'indirezione additiva (fatta). Deferito a **fase 2** (estrazione `packages/tenancy` + arrivo 2° `mode` dedicated-DB): `RoutingKey` tipizzato, catalogo control-plane (`tenant→{mode,connString,server}`), evoluzione `DbService.clientFor(ctx)`. Inventarli ora = build-ahead risk (YAGNI, come TD-BY).
- **Differiti chiusi al passo 9 (restano app-level/scaffold, nessun rientro a packages):** `health` (concern applicativo, comporrebbe ciclo se estratto), `DbService` (wrapper 12 righe, 6 consumer scaffold/app, dipendenza `apps/api→apps/api` definitiva), `me` (thin controller core-residuo).
- **Convention confine schema (8b-1):** schema Prisma unico (NO split file — ADR-0026 D1/D6); modelli/enum core sopra, dominio sotto, banner di confine. `DeviceType` resta core (usato da Session).
- **Wiring APP_GUARD centralizzato in `app.module.ts`** (Discovery #36, ordine deterministico: AppThrottlerGuard → JwtAuthGuard → TenantConsistencyGuard → PermissionsGuard + TenantContextInterceptor + TenantMiddleware.forRoutes). Mai toccato dall'estrazione.

## Prossimo passo (da concordare con Nicolò a inizio sessione)

L'estrazione core è chiusa: si apre una fase nuova. Candidate (in ordine non vincolante):

1. **Primo verticale reale: commercialisti** (TS sulla base condivisa, riusando il modello dati del vecchio portale PHP StudioDesk). È il trigger naturale di diverse cose deferite (rename apps/\*, estrazione core di dominio col 2° verticale, fase 2 tenancy). Macro-direzione, va scopata con cura (STOP 0 su BRIEF + StudioDesk).
2. **Cleanup PROGRESS** — la riga "Fase corrente" nell'header di PROGRESS.md è **stale** (cita ancora target pre-estrazione) e va allineata alla realtà post-estrazione. Anche il root `README.md` ha una sezione "Struttura monorepo" stale (cita `fiscal-drivers`/`plugin-sdk`/`ai-tools`/`apps/kds` inesistenti). Micro-PR docs dedicata, oppure assorbito a inizio prossima sessione.
3. **TD backend residui:** TD-BV (suite E2E gira come superuser → blind spot RLS strutturale; convertire a `gestionale_app`), TD-BW (refactor tx-safe interceptor soft-delete), TD-BS Sub-2 (E2E integration `ValidationPipe→400`, bloccata da harness SWC `design:paramtypes`).
4. **Fase 2 tenancy** (solo quando arriva il 2° verticale o un 2° `mode` DB): estrazione `packages/tenancy`, `RoutingKey` tipizzato, `DbService.clientFor`.

## Note / rischi attivi

- **TD-CC (nuovo, sessione passo 9, BASSA):** rename `apps/api`/`apps/web` → `apps/restaurant-*` al **2° verticale**. Naming mantenuto oggi (decisione A); rename quando arriva commercialisti, per disambiguare. Strutturale-ma-meccanico (directory + `package.json` name + path-alias + CI build-order + import). Finché non fatto, `apps/api`/`apps/web` denotano implicitamente il verticale ristorazione. Stima ~1-2h.
- **TD-BY (defer S23):** pricing resolution backend (`override ?? basePrice` per canale, multi-match channel/priority/finestra-date). Zero consumer attuali → requisiti li definirà il primo consumer (Cassa). Build-ahead risk se anticipato.
- **TD-BV (aperto):** la suite E2E api Vitest+testcontainers si connette come `postgres` superuser → bypassa RLS → blind spot strutturale (il fix soft-delete RLS S19 ne è la prova: invisibile alla suite). Mitigazione attuale: `smoke:rls-core` copre l'enforcement DB-level core in CI. Conversione suite a `gestionale_app` = passo dedicato.
- **TD-BW (aperto):** interceptor `soft-delete.ts` riscrive `delete`→`update` sul client catturato (non-tx) → dentro atomic tx escapa il context RLS. Convention attuale: soft-delete dentro tx via `tx.<model>.update({deletedAt})` esplicito. Refactor tx-safe dell'interceptor renderebbe la convention superflua.
- **TD-BS Sub-2 (deferred, MEDIA):** E2E integration `ValidationPipe→controller→400` bloccata dal harness (vitest 3.x non eredita i `plugins` root nei `test.projects` → no `emitDecoratorMetadata` → `design:paramtypes` non emesso). Validation coperta da 44 unit class-validator (Sub-1) + garantita in prod da toolchain `tsc`. 4 `.skip` E2E in attesa.
- **TD-CB (aperto):** gli E2E api Vitest+testcontainers (56) NON girano in CI (solo unit + Playwright web + `smoke:rls-core`). Mitigazione: `smoke:rls-core`.
- **PROGRESS "Fase corrente" + root README struttura: stale** (vedi prossimo passo #2). Non bloccanti, da allineare in un cleanup docs.
- RLS: `FORCE ROW LEVEL SECURITY` su core + dominio; contesto via `SET LOCAL` dentro `runInTenantContext`/`withSystemContext`/`withSuperAdminContext`. Ruolo app `gestionale_app` (NOSUPERUSER, NOBYPASSRLS). Fuori contesto → `RlsNoContextError`.
- `gh` installato sul server (PR apribili da terminale).

## Stato pulito di chiusura

Main `c483908`, working tree pulito, tutti i branch di sessione eliminati (locale+remoto). Nessun pendente. Estrazione core chiusa: nessun passo §D5 residuo.
