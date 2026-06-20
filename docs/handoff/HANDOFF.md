# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ 263e252 (+1 commit docs(handoff) in arrivo via PR). Sessione produttiva: 3 PR mergiate (#97 infra+resolver, #98 Comunicazioni, #99 Documenti) + graduazione StorageService.
> **Data:** 2026-06-19.

---

## PARTE A — Stato del progetto

### Natura di questa sessione

Sessione **di feature-code intensa**, 3 macro-task chiusi end-to-end. Partita da working tree con debito infra non committato (ADR-0042 bozza + 3 file Caddy), chiusa con livello 1 operatore-studio a un passo dal completamento. Tutto mergiato, main pulito, nessun pendente nel working tree.

### Dove siamo

Monorepo pnpm + Turbo, 2 verticali-core su base condivisa `packages/` (`@gestionale/db`, `db/nest`, `auth`, `auth-web`, `platform`, `shared`, `ui`, `api-client`, `i18n`):

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): completo F1 (Menu CRUD + UI). Invariato.
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): **livello 1 quasi completo**. End-to-end: skeleton → aziende → referenti → RLS anagrafica → preventivi + RLS → dashboard → scadenze + categorie custom → **Comunicazioni (ADR-0043)** → **Documenti (ADR-0044)**. Manca solo **Circolari** per chiudere il livello 1. Catalogo permessi: **41**.

### NOVITÀ sessione 2026-06-19

**1. Infra formalizzata → ADR-0042 mergiato (PR #97, commit 4d859e5).**

- Modello domini/sottodomini/resolver/superfici (`{ vertical, tenant, surface }`).
- `game`/lumimondo fuori dal resolver (progetto co-locato).
- **Pattern host co-locati → snippet `import colocated.*.caddy` gitignored** (glob tollerante: no-op su host pulito). Il Caddyfile committato porta solo gestionale + import + fallback; i vhost di terzi (adventure/superpang/music) vivono in `infra/caddy/conf/colocated.adventure.caddy`, NON versionato, NON backuppato (scelta esplicita, ADR-0042).
- Mount-stale `gestionale_caddy`: runbook `--force-recreate` + caveat fallimento silenzioso del glob (`caddy validate` resta Valid con snippet assente → serve probe HTTP sui 3 host, atteso 401 non 200).

**2. StorageService graduato a `packages/platform` (commit 6e5f0aa, dentro PR #99).** Era locale ad `accountant-api`; con Documenti come 2° consumer è stato spostato (TD-storage-platform risolto). Move pulito, nessun ciclo (`platform` dipende già da `@gestionale/db`, non viceversa). Comunicazioni aggiornato al nuovo import, GATE anti-regressione verde (12/12 unit non rotti). Sanitizzazione anti-traversal invariata (key-shape guard + resolve/startsWith), 5 test di path-safety verdi dal nuovo path.

**3. Modulo Comunicazioni (ADR-0043, PR #98, commit 4abbd49).** Thread 1:1 studio↔cliente. 3 tabelle (`Comunicazione`, `ComMessaggio`, `ComAllegato`) + `com_counter`, `tenantId` denormalizzato su tutte per RLS flat USING-only + FORCE. Codice seriale per-tenant via counter-row con `SELECT FOR UPDATE` nella stessa tx dell'insert (atomico/seriale per-tenant). Allegati via StorageService (filesystem, 20MB, anti-traversal testato). UI operatore: inbox + thread + invio + allegati + nota interna (`lato=interno`) + assegnazione/presa-in-carico. `origine` enum nasce con solo `portale`, estendibile. +2 permessi.

**4. Modulo Documenti (ADR-0044, PR #99, commit 263e252).** Archivio documenti studio→cliente. 2 tabelle (`DocumentoTipo` no-RLS scoping applicativo come ScadenzaCategoria, `Documento` RLS+FORCE flat). Tipi platform (tenantId NULL) + custom per-tenant, partial-unique solo sulle custom. Download **load-then-authorize** (endpoint prende id, mai storageKey; `findFirst({id, tenantId})` sotto RLS → 404 cross-tenant prima dello storage) — **sentinella IDOR e2e verde**. `VisibilitaDocumento` = `tutti | azienda` (`utente` differito al portale). Seed 16 tipi platform. +2 permessi (→41). UI operatore: archivio filtrabile + upload + download + soft-delete.

### Visione del verticale — tre livelli StudioDesk (roadmap)

1. **Operatore-studio** — staff (`/admin`). **Quasi completo**: aziende, referenti, preventivi, scadenze, dashboard, Comunicazioni, Documenti. Manca solo Circolari. Frontend `accountant-web`.
2. **Cliente-dello-studio** — l'azienda-cliente (`/` public, `[slug].studiodesk.cloud`). Secondo frontend, non esiste ancora. Auth email+password+2FA+passkey, no auto-registrazione (solo invito/creazione studio). **Sblocca le superfici già modellate ma dormienti**: `documenti_letture`, thread `lato=cliente`/`letto_cliente`, `VisibilitaDocumento.utente`. Nota sicurezza (ADR-0042 §5): operatore e cliente condividono l'origin → separazione a livello auth/guard.
3. **Super-admin** — `oneplatform` (observability infra) + `sa.<verticale>` (tenant + billing FIC, parcheggiato).

### Prossimo task — da concordare a STOP 0

**Circolari** (chiude il livello 1). Broadcast unidirezionale studio→clienti, tabelle separate dal thread 1:1 di Comunicazioni. DDL in `docs/studiodesk/sql/07_circolari.sql` + v2/summary/telegram/tags/ab_test — **scope-creep PHP accumulato da tagliare** (sospetto: fuori summary AI, telegram, tags, A/B test nel primo taglio). Sorgente PHP completo ora disponibile in `/home/deploy/projects/betadesk` (sibling read-only, fuori repo come adventure).

### Fili aperti (da chiudere alla prossima sessione)

1. **DEPLOY DB pendente:** il merge di #98 e #99 porta migration+seed in main ma NON li applica all'host. Per rendere effettivi Comunicazioni + Documenti (tabelle, 16 tipi platform, permessi →41) serve `prisma migrate deploy` + `pnpm db:seed` sull'host. Da fare al prossimo deploy.
2. **Reload Caddy pendente (da ADR-0042):** il refactor Caddyfile vive solo nei file; la produzione serve ancora la config inline precedente. Sequenza deploy: snippet `colocated.adventure.caddy` già su disco → `caddy validate` → `caddy reload` → **probe HTTP sui 3 host (atteso 401 non 200)**. La validate NON cattura lo snippet mancante.
3. **PROGRESS.md aggiornato** con le entry [2026-06-19] di #97, #98, #99 (già mergiate).

### Tech debt aperti

Invariati: **TD-BV** (e2e gira come `postgres` superuser, blind spot RLS); **TD-CB** (e2e backend solo-locale); **TD-PATCH-null-FK**; **TD-blocklist-drift** (FORBIDDEN_SLUGS/RESERVED_SLUGS duplicati); **`web` external one-time** (`docker network create web` su host pulito).

Nuovi da questa sessione:

- **TD-documenti-tipo-codice** (ADR-0044): `DocumentoTipo` usa solo `nome` (display), niente chiave macchina stabile. Se i modelli/questionari (fase 6C) referenzieranno i tipi, servirà reintrodurre un codice macchina separato dal nome (una FK su `nome` si romperebbe a rinomina).
- **TD-utente-enum-forward** (ADR-0044): `VisibilitaDocumento.utente` omesso finché non c'è il target user-cliente (portale, livello 2). Aggiunta futura = migration additiva `ALTER TYPE ... ADD VALUE`.
- **TD-storage-gc** (ADR-0044): soft-delete del record `Documento`/`ComAllegato` non cancella il blob su disco. Il PHP aveva `cron-gc-documenti`. Garbage collection file orfani da implementare come ops futura.

### Convenzioni di processo (in vigore — invariate)

- **Gate a due corsie** (FULL se schema/RLS/tx/business-logic/auth/pattern-nuovo → ADR dedicato; LEAN se CRUD che replica → spot-check + entry PROGRESS che linka l'ADR). Routing a STOP 0.
- **Self-check report a STOP 2** prima del diff; Claude strategico reviewa giudizio + legge il diff reale (non il sommario — la review del testo reale ha catturato contraddizioni ADR e gap di test in questa sessione).
- STOP-gate: 0 (preflight read-only) → 1 (spec+DP) → 2 (spot-check/self-check) → 3 (commit/PR/ADR). **Merge SEMPRE separato**: `gh pr checks --watch` comando a sé, `gh pr merge` solo dopo via esplicito di Nicolò.
- `git add` selettivo (mai `-A`, escludi `.claude/scheduled_tasks.lock`); commitlint header ≤ 100 inglese; path con `[slug]`/`[id]` quotati; `docs/studiodesk/` + `betadesk` (host PHP) READ-ONLY.
- **Split commit per rischio:** refactor che tocca codice live (es. graduazione storage) isolato in commit a sé dal modulo nuovo, GATE anti-regressione verde prima di procedere. Stesso branch/PR, commit atomici distinti.
- **Pattern "verificato vs promesso":** i punti security-sensitive (anti-traversal, IDOR download, glob silente) richiedono un test che li eserciti, non solo codice corretto + GATE verde. Il GATE non prova la sicurezza; il test mirato sì.

### Note operative

- **Empirical-first sui path:** verificare sempre i path reali prima dei comandi (errore in questa sessione: `apps/accountant-api/src/modules` non esiste; moduli direttamente in `src/`). Schema in `packages/db/prisma/schema.prisma`, migrations in `packages/db/prisma/migrations`.
- **BRIEF non copre Documenti accountant:** lo scope MVP poggia sulla product-interview 10/06 (memoria), non sul BRIEF versionato. Cristallizzato in ADR-0044 §5 con provenienza dichiarata.
- e2e accountant: `pnpm --filter @gestionale/accountant-api test:e2e` (Testcontainers, locale).
- Migration: `add_<entity>` (`prisma migrate dev --create-only` → blocco RLS/partial-unique a mano → applica). RLS `<table>_tenant_isolation` USING-only + FORCE, forma reale repo (`current_setting('app.is_super_admin', true) = 'true' OR tenant_id = current_setting('app.tenant_id', true)` — NO `::int`, tenant_id è TEXT/uuidv7).

---

## PARTE B — Snapshot tecnico

### Git

- **Main @ 263e252** (+1 commit `docs(handoff)` in arrivo via PR). Cronologia recente:
  - `263e252` feat(accountant): documenti module (ADR-0044) (#99)
  - `4abbd49` feat(accountant): comunicazioni module (ADR-0043) (#98)
  - `4d859e5` docs(infra): domain model + co-located hosts (ADR-0042) (#97)
- **Working tree PULITO**, nessun branch feature pendente.
- ADR in repo fino a **0044**.
- Su disco (fuori git): `infra/caddy/conf/colocated.adventure.caddy` (gitignored, NON backuppato).

### Schema dominio accountant — aggiornato

`Azienda` · `Referente` · `Preventivo` + `PreventivoVoce` · `Scadenza` + `ScadenzaCategoria` (tenantId nullable, no RLS, scoping applicativo) · **`Comunicazione` + `ComMessaggio` + `ComAllegato` + `com_counter`** (tenantId denormalizzato, RLS flat, counter FOR UPDATE) · **`DocumentoTipo`** (tenantId nullable, no RLS, partial-unique custom) **+ `Documento`** (RLS+FORCE flat, download load-then-authorize). Enum nuovi: `VisibilitaDocumento` (tutti|azienda), `DirezioneDocumento`.

### Stack & ambiente

- NestJS 11, Next.js 15, Prisma 6, PostgreSQL 16 (RLS), Redis, Vitest, Testcontainers, Playwright, Tailwind, shadcn/ui.
- Server Hetzner `gestionale-test`, Docker Compose `docker-compose.dev.yml`. Ruolo runtime DB `gestionale_app` (NOSUPERUSER NOBYPASSRLS), migration via `postgres` (DIRECT_URL).
- **StorageService** ora in `packages/platform/src/storage/` (astratto + LocalFilesystemStorageService + StorageModule, dual CJS/ESM). Filesystem locale Hetzner, target swap futuro Cloudflare R2, limite 20MB, anti-traversal (key-shape guard + resolve/startsWith containment, 5 test).
- **HTTPS live (ADR-0041/0042):** Caddy custom (DNS Cloudflare) serve `studiodesk.cloud` + `*.studiodesk.cloud`, cert reali Let's Encrypt. Caddyfile committato = gestionale + `import colocated.*.caddy` + fallback. **TODO:** backup volume `caddy_data`.
- **betadesk** (`/home/deploy/projects/betadesk`, sibling fuori repo): sorgente PHP StudioDesk completo, READ-ONLY (reference, come `docs/studiodesk/` e host `portal`). Altri sibling co-locati: lumimondo, lumimondo-adventure, music, superpang.
- Tenant demo: `studio-demo` (admin Super Admin 41 permessi; collaboratore) + `studio-acme` (isolamento).

### Roadmap dominio (riferimento)

Livello 1 operatore: manca solo **Circolari**. Poi livello 2 **portale cliente** (slice grossa: nuovo frontend, auth 2FA+passkey, sblocco superfici dormienti). Pipeline ciclo cliente (futura): assessment Groq → preventivo → mandato/incarico Groq → timesheet → dashboard margine. FIC = livello 3 (`sa.<verticale>`), parcheggiato.

### Verifica finale richiesta a Code (chiusura sessione)

Working tree pulito, main @ 263e252 allineato origin, nessun branch pendente, nessun pendente nel working tree, PROGRESS.md aggiornato con le 3 entry [2026-06-19].
