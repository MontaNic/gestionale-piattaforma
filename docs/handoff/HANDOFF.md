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

- ADR: `docs/architecture/` (0025 scope, 0026 data layer, 0027 composizione core, + nuovi)
- Stato dettagliato: `PROGRESS.md` (FONTE PRINCIPALE — incollala sempre insieme a questo file)
- Scope: `PROJECT_BRIEF.md`
- Metodo sessioni Code: `STARTER_PROMPT.md`
- Gerarchia: se questo file e PROGRESS divergono, **vince PROGRESS**.

## Metodo di lavoro (triangolo)

- Claude chat = strategia + verifica delle conclusioni di Code (verifica, non fidarti)
- Claude Code = esecuzione (VS Code Remote-SSH)
- Nicolò = arbitro / decisioni finali, paste-relay tra gli agenti
- Ciclo task: Decidere → Preparare → Attuare → Verificare → Registrare (commit + PROGRESS aggiornato)
- Estrazione core: un package per PR, gate test verdi costanti, ordine da ADR-0027 §D5.

## Catena STOP (come si conduce un passo)

- **STOP 0** = preflight empirico read-only (leggi BRIEF/ADR + grep/find/cat il codebase; non dedurre da "foundation pulita").
- **STOP 0.5** = probe mirata quando un meccanismo non è deducibile (es. build) — verifica empirica prima di impegnare lo scope.
- **STOP 1** = spec di implementazione con assunzioni Ax dichiarate + confini espliciti. Apri con micro-verifiche inline sui punti non certi (non assumere).
- **STOP 2** = spot-check pre-merge (comando singolo). I check `grep -i` su stringa vanno SEMPRE disambiguati (pescano commenti) — mai dedurre dal primo esito.
- **STOP 3** = edit doc (se chiude un passo) + commit + push + PR + `gh pr checks --watch` da solo.
- Decisioni multi-opzione: A/B/C con raccomandazione motivata (★). Push-back UNA volta se rischioso, poi rispettare l'arbitro.
- Scomposizione: se un passo mescola refactor ed estrazione (o rischioso e meccanico), spezzalo in sotto-PR (es. 7a refactor + 7b estrazione; 8a prereq + 8b estrazione).

## Regole di ingaggio (come Claude chat lavora con Nicolò)

**Tono:** feedback diretto e onesto, MAI elogi/lodi gratuite, niente celebrazioni. Rispondere in italiano. Messaggi brevi di Nicolò ("ok", "A", "procedi", "tua raccomandazione") = approvazioni/comandi; "tua raccomandazione"/"decidi tu" = delega esplicita (procedi senza ulteriore push-back).

**Assicurazione:** meglio lento e verificato che veloce e fragile, mai scorciatoie. UN PASSO ALLA VOLTA, aspettare il via. Per git/merge/server: comandi esatti da incollare + aspettare l'esito.

**Merge e CI — REGOLA FERMA:** branch protection server-side NON disponibile (GitHub Free privato), `--auto` NON è un guard-rail. Il guard-rail è procedurale:

- MAI dare `gh pr checks` e `gh pr merge` insieme.
- Prima, da solo: `gh pr checks <N> --watch` (o senza N, infersce dal branch).
- Solo DOPO conferma "verde" di Nicolò, in comando SEPARATO: `gh pr merge <N> --squash --delete-branch`.
- Dopo il merge: `git checkout main && git pull --prune && git log --oneline -1`.

**Verifica, non fiducia (verso Code):** le CONCLUSIONI di Code vanno verificate, non archiviate. Code esegue bene; stime/diagnosi possono essere imprecise. Quando un'assunzione load-bearing risulta falsa al Passo 0, Code si ferma e segnala (comportamento corretto).

**Artifact:** produrre drop-in copy-paste (file via create_file + present_files) per i prompt a Code, senza meta-spiegazioni. Eccezione: spiegazioni in chat quando ci sono decisioni/Sub-DP. Dopo verdetto + GO: file diretto + max 1-2 righe.

**Chiusura sessione:** l'HANDOFF (questo file) si dà SOLO quando Nicolò dice "finito per oggi", sempre completo (Parte A + B) da sostituire in toto. NON produrre handoff narrativo per Code; al suo posto un messaggio di VERIFICA FINALE per Code (working tree pulito, main allineato, nessun pendente, PROGRESS aggiornato). L'HANDOFF è versionato in docs/handoff/HANDOFF.md: dopo averlo sostituito a fine sessione, committarlo con docs(handoff): … diretto su main. La verifica finale di Code lo include nel working tree pulito.

**Sicurezza — cosa Claude NON fa:** non maneggiare token/password/credenziali (auth la fa Nicolò); non delegare a Code installazioni di sistema o credenziali; se Nicolò incolla dati sensibili (IP/host/segreti), segnalarli e redarli dopo.

## Packaging package (regola appresa)

- Consumato solo da Next → `transpilePackages` (es. ui, i18n, api-client, auth-web).
- Consumato anche da apps/api (NestJS/CJS) → dual-package tsup (es. db, shared, platform, auth).
- I dual-package consumati da apps/api vanno aggiunti allo step "Build workspace packages" del job `e2e-playwright` in `ci.yml` (gira fuori da Turbo, `^build` non scatta). Ordine topologico: db/shared prima dei package che li consumano.
- **Package NestJS dual (convenzione verificata, passo 6):** il `tsconfig.json` del package deve dichiarare ESPLICITAMENTE `experimentalDecorators: true` + `emitDecoratorMetadata: true` (il base NON li eredita); `tsup.config.ts` deve avere `external` sui runtime NestJS. Senza, la DI si rompe a runtime (invisibile in build). Con i flag, tsup emette `design:paramtypes` reali.

## Cosa NON fare

- NON incollare l'intera chat precedente: dispersivo. Stato strutturato > cronologia grezza.
- NON affidare lo stato alla memoria: scriverlo nei file.
- NON introdurre "miglioramenti" non richiesti in un refactor/estrazione (anti-astrazione-prematura §F1; confine core/dominio; un-passo-per-PR).

═══════════════════════════════════════════════════════════════

# PARTE B — STATO CORRENTE (⚠️ AGGIORNARE a fine di ogni macro-sessione)

═══════════════════════════════════════════════════════════════

**Ultimo aggiornamento:** 2026-06-04 (fine passo 8a)
**Main @:** 5731391

## Fase corrente

Estrazione del core condiviso (ADR-0027 §D5). Codice agnostico in `packages/`, dominio ristorazione come scaffold in `apps/`.

## Passi completati e mergiati

1. ✅ packages/eslint-config
2. ✅ packages/ui
3. ✅ packages/shared (dual tsup)
4. ✅ packages/i18n
   5a. ✅ packages/api-client · 5b. ✅ packages/auth-web (PR #52)
5. ✅ packages/platform (BE infra: redis/mail/throttler/common) — PR #57. Primo package NestJS; convenzione build dual verificata via probe. `health` DIFFERITO.
6. ✅ packages/auth (auth+rbac+users+tenants+tenant+context + 4 APP_GUARD) — eseguito in **7a** (#58, disaccoppia `DbService` → singleton `prisma`) + **7b** (#59, git mv 39 file). Wiring 4 APP_GUARD + interceptor + middleware resta in `app.module.ts` (ordine invariato). `health` DIFFERITO (DP-A: importa `@Public` da `@gestionale/auth`, resta scaffold per back-ref `DbService`).
   8a. ✅ Prerequisito RLS (ADR-0026 §D5) — PR #60. `smoke:rls-core` (9 scenari core-only come `gestionale_app` non-superuser, S0 auto-diagnostico) in CI nel job `e2e-playwright` dopo `db:seed`. RLS DB-level core ora esercitata in CI. Additivo, non-distruttivo.

## Prossimo passo

**Passo 8b — packages/db** (max rischio dati). Prerequisito RLS già soddisfatto (8a).
Contenuto: (1) separazione enum/seed **core vs dominio** dentro lo schema; (2) indirezione **additiva** `getClientForTenant(ctx)` che per ora ritorna sempre il client condiviso (ADR-0026 §D3 fase 1).
⚠️ Prerequisito di confine da definire PRIMA: **interfaccia tenancy↔db** — chi possiede la mappa routing-key (ADR-0026 §D4). È la decisione architetturale del passo.
Nota: `packages/db` è di fatto già popolato (schema, 9 migrazioni, seed, API RLS): 8b NON è spostamento file ma separazione + indirezione additiva.

## Note / rischi attivi

- **TD-CB (aperto):** gli e2e api Vitest+testcontainers (56) NON girano in CI (solo unit + Playwright web + `smoke:rls-core`). I 3 test "isolation" applicativi in CI girerebbero da superuser → validano isolamento applicativo, non DB-level. Migration path: portare la suite e2e api in CI come `gestionale_app` (Docker-in-CI o riuso service container). Mitigazione attuale: `smoke:rls-core` copre l'enforcement DB-level core in CI. Passo dedicato, non in 8b.
- `health` resta scaffold in `apps/api/src/health/` (importa `@Public` da `@gestionale/auth`; back-ref `DbService` locale fino al passo 8). Rientro pieno valutabile al passo 8/9.
- `DbService` (wrapper NestJS ~12 righe, `apps/api/src/db/`): ancora iniettato da `health` + 5 service di dominio (dipendenza `apps/api → apps/api` valida). Decisione sul suo destino: al passo 8b/9.
- RLS: `FORCE ROW LEVEL SECURITY` attivo su tabelle core + dominio; contesto via `SET LOCAL app.tenant_id`/`app.is_super_admin` dentro `runInTenantContext`/`withSystemContext`/`withSuperAdminContext`. Fuori contesto → `RlsNoContextError`. Ruolo app: `gestionale_app` (NOSUPERUSER, NOBYPASSRLS).
- gh installato sul server (PR apribili da terminale).

## Ordine rimanente (ADR-0027 §D5)

8b db (separazione core/dominio + `getClientForTenant`, confine tenancy↔db §D4) · 9 riframe verticale ristorazione a scaffold.
