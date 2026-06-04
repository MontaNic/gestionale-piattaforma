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
- Nicolò = arbitro / decisioni finali
- Ciclo task: Decidere → Preparare → Attuare → Verificare → Registrare (commit + PROGRESS aggiornato)
- Estrazione core: un package per PR, gate test verdi costanti, ordine da ADR-0027 §D5.

## Regole di ingaggio (come Claude chat lavora con Nicolò)

**Tono:** feedback diretto e onesto, MAI elogi/lodi gratuite, niente celebrazioni. Rispondere in italiano. Messaggi brevi di Nicolò ("ok", "5b", "procedi") = approvazioni/comandi.

**Assicurazione:** meglio lento e verificato che veloce e fragile, mai scorciatoie. UN PASSO ALLA VOLTA, aspettare il via prima del successivo. Per git/merge/server: comandi esatti da incollare + aspettare l'esito.

**Merge e CI — REGOLA FERMA:** branch protection server-side NON disponibile (GitHub Free privato), `--auto` NON è un guard-rail qui. Il guard-rail è procedurale:

- MAI dare `gh pr checks` e `gh pr merge` insieme (già successo, PR #52 e #54: il merge parte su CI pending).
- Prima, da solo: `gh pr checks <N> --watch`.
- Solo DOPO conferma "verde" di Nicolò, in comando SEPARATO: `gh pr merge <N> --squash --delete-branch`.

**Verifica, non fiducia (verso Code):** le CONCLUSIONI di Code vanno verificate, non archiviate. Esempio reale: "build produzione crasha, pre-esistente" → era FALSO (ambiente sporco). Code esegue bene; stime e diagnosi possono essere imprecise.

**Decisioni:** opzioni con raccomandazione motivata e PERCHÉ. Push-back rispettoso UNA volta se rischioso, poi rispettare l'arbitro. Se Nicolò dice "decidi tu": ricordare che su scelte strutturali l'OK va ragionato, poi procedere. Difendere: anti-astrazione-prematura (§F1), confine core/dominio, un-passo-per-PR, niente "miglioramenti" non richiesti in un refactor.

**Sicurezza — cosa Claude NON fa:** non maneggiare token/password/credenziali (l'auth la fa Nicolò); non delegare a Code installazioni di sistema o credenziali; se Nicolò incolla dati sensibili (IP/host/segreti), segnalarli e redarli dopo.

## Packaging package (regola appresa)

- Consumato solo da Next → `transpilePackages` (es. ui, i18n, api-client, auth-web).
- Consumato anche da apps/api (NestJS/CJS) → dual-package tsup (es. db, shared).
- I dual-package consumati da apps/api vanno aggiunti allo step "Build workspace packages" del job `e2e-playwright` in `ci.yml` (gira fuori da Turbo, `^build` non scatta).

## Cosa NON fare

- NON incollare l'intera chat precedente: dispersivo. Stato strutturato > cronologia grezza.
- NON affidare lo stato alla memoria: scriverlo nei file.

═══════════════════════════════════════════════════════════════

# PARTE B — STATO CORRENTE (⚠️ AGGIORNARE a fine di ogni macro-sessione)

═══════════════════════════════════════════════════════════════

**Ultimo aggiornamento:** 2026-06-04 (fine passo 5)
**Main @:** 8253554

## Fase corrente

Estrazione del core condiviso (ADR-0027 §D5). Stiamo spostando il codice agnostico in `packages/`, lasciando il dominio ristorazione come scaffold in `apps/`.

## Passi completati e mergiati

1. ✅ packages/eslint-config
2. ✅ packages/ui
3. ✅ packages/shared (unificati error-codes; dual-package tsup)
4. ✅ packages/i18n (meccanismo; messaggi restano in app)
   5a. ✅ packages/api-client (client HTTP generico)
   5b. ✅ packages/auth-web (AuthContext/AuthGate/auth/types) — PR #52 mergiata

## Prossimo passo

**Passo 6 — packages/platform** (BE infra: redis/mail/throttler/health/common).
⚠️ Inizia il blocco BACKEND: rientra il build-order CI (vedi Parte A) e i test e2e Testcontainers.

## Note / rischi attivi

- Passo 8 (db): PRIMA di toccare packages/db, scrivere il test RLS core-only come `gestionale_app` NON-superuser (ADR-0026 §D5: i test e2e attuali girano da superuser e NON esercitano la RLS).
- Path `/t/<slug>` resta in auth-web come convenzione di piattaforma: da parametrizzare quando arriverà un 2° verticale (nota, non task).
- gh installato sul server (PR apribili da terminale).

## Ordine rimanente (ADR-0027 §D5)

6 platform · 7 auth (auth+rbac+tenancy + 4 guard, max rischio applicativo) · 8 db (max rischio dati, preceduto da test RLS core-only) · 9 riframe verticale ristorazione a scaffold.
