# HANDOFF — gestionale-piattaforma

**Snapshot**: Main @ `f7b5d19` — **deploy S19 ESEGUITO in produzione** il 2026-07-25 (Option 2)
**Sessioni**: 2026-07-24 (16 PR, #167→#182) + 2026-07-25 (preflight + PR-A #184 + PR-B #185 + finestra di deploy)

---

# S19 — Finestra di deploy eseguita (2026-07-25)

**Forma Option 2**: infrastruttura + migrazione + permessi, **propagazione ai ruoli esclusa e differita** (ADR-0066). Sei passi P0–P7, **zero scostamenti, zero STOP incontrati**. Runbook riutilizzabile versionato in [`docs/runbook-deploy-infrastrutturale.md`](../runbook-deploy-infrastrutturale.md).

**Cosa è in produzione ora**:

- Schema **→33** (`add_note_spese`), `FORCE RLS` verificato `t|t` su entrambe le tabelle + `GRANT` a `gestionale_app` ereditati dalle default privileges (nessun GRANT manuale).
- **4 immagini ribuildate** con provenienza OCI `revision=f7b5d19`, in esercizio su entrambi i verticali (health end-to-end via Caddy: `studiodesk.cloud` + `food.studiodesk.cloud` → 200 `db:connected`).
- Permessi **60→63** (`notespese.*`), template-perms **249→262**, **`role_permissions` 245 INVARIATO** — la firma di Option 2: i permessi arrivano ai template ma **non** ai ruoli esistenti. Note Spese è quindi raggiungibile a livello di codice ma **UI nascosta** finché la propagazione non avviene (comportamento atteso, non un difetto).

**I due presidi della sessione, verificati sul vivo nella prima finestra reale**:

- **PR-A `GIT_SHA`** (#184): il build è passato perché la variabile era presente; le 4 label `revision=f7b5d19` lo provano. Inoltre `${GIT_SHA:?}` blocca **ogni** comando compose contro prod, non solo `build` (Compose interpola l'intero modello al load).
- **PR-B `NODE_ENV`** (#185): il seed è passato (`NODE_ENV=production` valido) e ha **saltato il ramo dev** (`Dev data: SKIPPED` nell'output **e** `role_permissions` invariato + `tenants.max(updated_at)` fermo al 30/06 nel DB — la stessa cosa dai due lati). Le password note dei tenant fittizi **non** sono state riportate ai default: il landmine di STOP 0, neutralizzato sul vivo.

È la tesi di S18 — i presidi che dipendono dalla memoria vanno meccanizzati — verificata dal lato costruttivo: nati come risposta a due failure-mode di STOP 0, le hanno chiuse alla prima occasione reale.

**Backup con restore provato** prima della finestra: `gestionale_20260724T161844Z_pre-deploy-s19_8becc84.dump` (24/07, restore effimero completo, diff conteggi vuoto, RLS 37/37) + `gestionale_20260725T202336Z_pre-migrate33_f7b5d19.dump` (25/07, pre-`migrate deploy`, magic-bytes `PGDMP`, sha `3d87cd85…`).

**Rollback point**: tag `rollback-pre-s19` sulle 4 immagini pre-deploy (digest annotati in ADR/registrazione), verificati per digest coincidenti con le immagini che erano in esercizio.

**ADR prodotti S19**: [0079](../architecture/ADR-0079-storage-persistente-provenienza-immagini.md) (storage persistente + provenienza), [0080](../architecture/ADR-0080-seed-fail-closed-node-env.md) (seed fail-closed).

**Riconferma ADR-0066** (propagazione permessi differita): caratterizzazione tenant del 24/07 (READ-ONLY, C1–C5) — nessuno dei 4 tenant di produzione ha utenti a dominio non-`.local`. `acme`/`demo`/`oneplatform` = seed-residui (food/platform), `studio-demo` = tenant-di-lavoro incerto con dati accountant ma utenti tutti `.local`. **Nessun cliente reale da servire → propagazione differita**, stesso differimento del 01/07, riconfermato empiricamente. Trigger invariato: **primo tenant non well-known via API**. Non un nuovo ADR: riconferma di quello esistente.

**TD nuovi della sessione S19** (dettaglio in ADR-0079, tranne il primo):

| TD                                       | Trigger                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `TD-backup-automation`                   | primo cliente reale in produzione — il dump è one-shot, manuale, sullo stesso disco del volume Postgres |
| `TD-storage-backup-blob`                 | primo allegato caricato da un cliente reale — il `pg_dump` non copre i blob                             |
| `TD-container-runs-as-root`              | prossima PR sui runner stage, o primo cliente con requisiti di audit — i 4 runner girano come root      |
| `TD-dev-processes-orphaned-on-prod-host` | prossima sessione che apre un dev server sull'host, o esito verifica firewall porta 3000                |

---

# PARTE A — Stato

## A.1 Sintesi della sessione

Cinque fronti aperti a inizio giornata, tutti chiusi o portati a milestone:

| Fronte                        | Esito                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `TD-blob-download-no-refresh` | **Chiuso** e verificato end-to-end (Sub-2)                                             |
| bug `app.is_super_admin`      | **Chiuso come non-bug** (fail-closed verificato staticamente)                          |
| `TD-dev-env-punta-prod`       | **ESTINTO** (Sub-A guard + Sub-B dev env + Sub-2 verifica)                             |
| `TD-ci-e2e-testcontainers-be` | **Fase 1 chiusa** (gate RLS dominio in CI, entrambi i verticali); Fase 2 trigger-gated |
| KDS FE                        | **Fase 1 chiusa** (board operativa); Fase 2 trigger-gated                              |
| Note Spese v1                 | **Completa** (7 PR: backend + entrambe le viste FE)                                    |

**Tre delle quattro failure-mode strutturali ora hanno un meccanismo**: dev/prod confusion (guard), CI che non esercita il comportamento (gate RLS provato efficace), spec effimere (persistite in repo). Resta scoperto: **deployment drift invisibile** — vedi B.1.

## A.2 PR mergiate

| PR   | SHA       | Contenuto                                                                                                      |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------- |
| #167 | `7ffa268` | blob download/upload sopravvivono alla scadenza token (`fetchWithAuthRetry`, `apiGetBlob`, `apiPostMultipart`) |
| #168 | `28d2b81` | guard anti-prod-da-host (`assertSafeDbTarget`) — Sub-A                                                         |
| #169 | `ce30364` | docs sync Sub-A                                                                                                |
| #170 | `d355ad3` | `is_super_admin` verificato non-bug + fold TD-CB                                                               |
| #171 | `5b07790` | dev env isolato dev-by-default (55432) — Sub-B                                                                 |
| #172 | `03f2717` | Sub-2: verifica full-stack blob/multipart contro BE reale                                                      |
| #173 | `0a44dc3` | gate `E2E domain RLS` restaurant (Fase 1)                                                                      |
| #174 | `978bd99` | KDS board Fase 1 (feed + avanzamento stato)                                                                    |
| #175 | `c12e78f` | gate RLS esteso ad accountant (PR-0 Note Spese)                                                                |
| #176 | `358cf96` | Note Spese: schema + permessi 60→63                                                                            |
| #177 | `72ff995` | Note Spese: CRUD + allegati/storage                                                                            |
| #178 | `e789502` | Note Spese: state machine + gating                                                                             |
| #179 | `434b2e2` | Note Spese: allegati nei read path                                                                             |
| #180 | `002d3af` | Note Spese: UI operatore                                                                                       |
| #181 | `190ccc0` | Note Spese: autore nei read path                                                                               |
| #182 | `b8fa054` | Note Spese: pannello approvazione                                                                              |

ADR prodotti: **0071** (aggiornato, CI e2e + gate esteso), **0072** (dev env Sub-B), **0073** (KDS board), **0074**–**0078** (Note Spese PR-1..PR-5).

## A.3 Infrastruttura — stato

**Produzione**: `gestionale_postgres` intatto, Up ~3 settimane. **32 migrazioni**, cutover 15/07.
**Dev env (nuovo, Sub-B)**: `gestionale_postgres_dev` su `127.0.0.1:55432`, volume e rete dedicati, `gestionale_app` con password dev. Compose additivo standalone `docker-compose.devdb.yml` — **mai** nel merge prod. Lasciato **up** a fine sessione.
**Guard DB**: `assertSafeDbTarget` in `createPrismaClient()` — aborta se `NODE_ENV != production` **e** target `{127.0.0.1|localhost}:5432/gestionale`. Whitelist `ALLOW_PROD_DB_ACCESS=1` su 5 wrapper di manutenzione. **Verificato a runtime.**
**Dev-by-default**: gli script `dev` delle 2 API puntano al DB dev; puntare a prod richiede intenzione esplicita.

## A.4 CI — stato

**5 job**, paralleli con `needs: [checks]` (wall-clock dominato dal ramo più lento, ~4m):

1. `Lint · Typecheck · Format · Test` (unit)
2. `E2E Playwright` (restaurant-web)
3. `E2E accountant-web blob` (route-mocked)
4. `E2E domain RLS` (restaurant, testcontainers, `gestionale_app`) — 3 spec, 23 test
5. `E2E domain RLS accountant` (testcontainers, `gestionale_app`) — 2 spec

**Entrambi i gate RLS sono provati efficaci** (rottura → rosso → ripristino → verde), non solo verdi.

## A.5 Debiti tecnici

**Estinti oggi**: `TD-dev-env-punta-prod`, `TD-ci-e2e-accountant-web-fe`, `TD-blob-download-no-refresh`.

**Nuovi (con trigger)**:

| TD                                 | Tier        | Trigger                                                                                                    |
| ---------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `TD-blob-retry-duplication`        | ALTO        | prossima modifica sostanziale alla logica retry/refresh → unificare `request()` sopra `fetchWithAuthRetry` |
| `TD-db-dist-stale-runtime`         | MEDIO       | mecanizzare il rebuild (`predev` build, o risoluzione al sorgente TS, o `verify:guard-runtime` in CI)      |
| `TD-ci-e2e-accountant-api`         | MEDIO       | `globalSetup` container condiviso → portare in CI le ~17 spec comportamentali                              |
| `TD-prisma-studio-prod-unguarded`  | BASSO-MEDIO | prossimo hardening accesso host al DB                                                                      |
| `TD-fe-errori-silenziati`          | MEDIO       | primo report "ho cliccato e non è successo niente", o prossimo intervento su quei path                     |
| `TD-state-machine-read-then-write` | MEDIO       | primo stato incoerente sotto concorrenza, o prossimo intervento su comande/circolari                       |
| `TD-verifica-porte-senza-sudo`     | BASSO-MEDIO | prima del primo GATE di **regressione**                                                                    |

**Preesistenti**: `TD-ci-e2e-testcontainers-be` (Fase 2), `TD-storage-gc`, `TD-documenti-tipo-codice`, `TD-utente-enum-forward`, `TD-articles-flat-endpoint`, `TD-tavolo-stato-forward`, `TD-sala-forward`.

**Nota su `TD-fe-errori-silenziati`**: copre **tre** meccanismi — catch muto, promise non gestita (entrambi grep-abili), **errore sovrascritto dal reload** (`try/catch` regolare, difetto di _sequenza temporale_, invisibile a qualunque analisi statica). Il censimento a 6 call-site è un **limite inferiore**, non l'inventario.

## A.6 Discovery della sessione

Otto correzioni empiriche di asserzioni statiche, la maggior parte di Claude strategico:

1. **Nota network V5** — divergenza inesistente, mio errore di lettura in STOP 0. Memoria accurata, nessun claim da correggere.
2. **Init script app-role rotto** — `:'app_db_password'` non interpolato dentro `DO $$…$$`; il role finiva con password placeholder. **Bug latente di bootstrap prod**, non solo dev. Fixato + fail-loud.
3. **Guard Sub-A inerte a runtime** — attivo nel sorgente e nei test, **assente nel `dist`** che i dev server importano. Il near-incident è rimasto possibile dal merge di #168 fino al rebuild di Sub-B. → `TD-db-dist-stale-runtime`.
4. **`conti-rls-isolation` bit-rotted** — `vatPercent` reso obbligatorio da #161, spec mai aggiornata, invisibile perché fuori CI. **Tesi del TD materializzata.**
5. **Premessa "superuser in CI" errata** — la e2e BE non girava in CI _affatto_: gap di **assenza**, non di ruolo.
6. **Falso-verde sul vettore di efficacia accountant** — i test HTTP sono anche app-filter-protected (`where:{tenantId}`), restano verdi sotto RLS bypassata. Il vettore efficace è la **policy**, non l'extension.
7. **Spec "locked" non recuperabile** — viveva solo in chat. Recuperata via ricerca conversazioni e **persistita in repo**.
8. **Re-export enum non orfano** — sospetto infondato: senza, `accountant-api` non compila.

Più: la convenzione FE (zero import di `@gestionale/db`, enum replicati nei `*-types.ts`) ha superato una mia istruzione errata.

**Gli ultimi due difetti della sessione non erano nel codice ma nei metodi di verifica**: un errore invisibile al grep perché temporale, e un `sudo` che falliva in silenzio facendo leggere l'assenza di output come "porte libere".

---

# PARTE B — Operativo

## B.1 deployment drift — RISOLTO (deploy S19 eseguito 2026-07-25)

**Il divario è chiuso.** Il lavoro user-facing del 24/07 (KDS board, Note Spese v1) è ora in produzione insieme allo schema →33. Vedi la sezione **S19 — Finestra di deploy eseguita** in testa. Prod era a 32 migrazioni dal cutover del 15/07; ora è →33 con le 4 immagini `f7b5d19`.

La **quarta failure-mode strutturale** — _deployment drift invisibile_, l'unica ancora scoperta a fine 24/07 (vedi A.1) — è ora chiusa non a parole ma sulle 4 label OCI `revision`: da questo deploy ogni immagine in esercizio dichiara il commit da cui è nata, e il presidio `${GIT_SHA:?}` rende impossibile un build di produzione senza SHA.

Caddy: **nessuna modifica necessaria** al deploy (confermato in preflight) — le rotte nuove cadono sotto gli `handle` catch-all già instradati. Reload **mai** restart se mai servisse (`caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`), config reale in `infra/caddy/conf/`.

**Resta aperto e differito**: la propagazione dei permessi `notespese.*` ai ruoli esistenti (Option 2, ADR-0066). Oggi la UI Note Spese è nascosta a tutti perché `role_permissions` è invariato a 245 — è lo stato voluto, non un bug. Si sblocca al trigger "primo tenant non well-known via API".

## B.2 Residui per blocco

**Note Spese** — v1 completa. Deferral trigger-gated invariati: **Client Portal** (trigger: primo cliente che richiede accesso diretto; costo BASSO/incrementale, segue pattern `portale-*`), **OCR/pre-compilazione** (trigger: decisione su provider vision — `GroqService` è text-only).

**KDS Fase 2**: layout kiosk `(kiosk)/` route group, segnale storno sulla board, e2e KDS, SSE. SSE resta deferito, **trigger invariato** (latenza insufficiente su feedback reale, o multi-istanza).

**CI Fase 2**: suite comportamentale completa restaurant-api (13 spec) + accountant-api (~17 spec) — prerequisito `globalSetup` con container condiviso.

**Cassa pre-fiscale** (restaurant): non iniziata, **manca anche il BE**. Fronte BE+FE, sbloccata da `vatPercent` (#161). RT/certificazione fiscale deferita fino a cliente reale.

## B.3 Ambiente lasciato

- `gestionale_postgres_dev` (55432) **up** — abbatterlo con `pnpm devdb:down` (preserva dati) o `down -v` (reset).
- Nessun dev server in esecuzione.
- Prod intatto. **Attenzione**: sull'host sono visibili `next-server` root-owned che sono i container di **produzione** — non sono processi di sviluppo orfani.
- Verifica porte: usare `ss -tln` + `curl` + `/proc/<pid>/cwd`. **Mai `sudo lsof`**: richiede password, fallisce in silenzio, e l'assenza di output non è "porta libera".
- Dati dev ad-hoc del GATE PR-5: ruolo **Direzione** + utente `direzione@studio.local` seedati **solo** sul dev DB (55432), mai nel seed del repo. Restano lì; se servissero stabilmente, vanno seedati per davvero.

## B.4 Convenzioni consolidate oggi

- **Prova di efficacia obbligatoria per ogni gate**: un job verde non dimostra che il gate serva. Rompere → rosso → ripristinare. Se non diventa rosso, il gate è teatro.
- **Il vettore di efficacia differisce per verticale**: restaurant → extension `rls.ts`; accountant → policy nella migration (i test HTTP sono app-filter-protected e darebbero falso-verde).
- **Mai mergiare mai-visto-verde**: la CI va vista verde sul commit finale, non assunta.
- **Merge eseguito da Code** (`gh pr merge <n> --squash --delete-branch`), in turno **separato** da `gh pr checks --watch`, dopo "vai" esplicito. Nessuna eccezione per docs-only.
- **`select` esplicito, mai `include` nudo** su relazioni: `storageKey` e `email` non devono comparire nei payload. Assert sull'**assenza**, con chiavi esattamente quelle attese.
- **Zero `fetch()` raw** in entrambi i FE — invariante ristabilita, da non rompere.
- **Le spec vanno committate**: una spec che vive solo in chat non è locked, è effimera.

## B.5 Nota di metodo

Il frontend come **primo consumer reale** collauda la shape del backend: due micro-PR non previste (#179, #181) sono emerse dagli STOP 0 di PR-4 e PR-5, dove il FE chiedeva dati che il BE non esponeva. In entrambi i casi la scorciatoia era disponibile (UUID grezzi; agganciarsi a `/tariffe/users` gated sui costi del personale) e in entrambi ha vinto la micro-PR additiva.
