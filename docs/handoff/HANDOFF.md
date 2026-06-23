# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ b43aeb1 (+1 commit docs(handoff) in arrivo via PR).
> **Data:** 2026-06-23.

---

## PARTE A — Stato del progetto

### Natura di questa sessione

Sessione di **feature delivery completa**. Partita da livello 1 chiuso (main @ `1a1350a`), chiusa con **livello 2 portale cliente interamente consegnato** (5 PR mergiati: #103→#107) + ricognizione infra deploy applicativo.

### Dove siamo

Monorepo pnpm + Turbo, 2 verticali-core su base condivisa `packages/` (`@gestionale/db`, `db/nest`, `auth`, `auth-web`, `platform`, `shared`, `ui`, `api-client`, `i18n`):

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): completo F1 (Menu CRUD + UI). Invariato.
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): **livello 1 + livello 2 COMPLETI**. Catalogo permessi: **49**.

### NOVITÀ sessione 2026-06-23

**1. Livello 2 — Portale cliente (route-group in accountant-web, ADR-0046/0047/0048)**

Decisioni architetturali fissate in questa sessione:

- **Identità cliente**: single-table `User` con discriminatore `UserTipo` (operatore/cliente) + `aziendaId NOT NULL` (CHECK constraint DB) + `clienteRuolo` (admin/utente). Migration non distruttiva — esistenti restano `operatore`.
- **Superficie web**: route-group `(portale)/` in `accountant-web` (path-based `/t/[slug]/portale/`). App separata `client-web` + subdomain `[slug].studiodesk.cloud` = task infra futuro.
- **Login unico** `/t/[slug]/login` con redirect per `tipo` (operatore→dashboard, cliente→portale).
- **Invito cliente**: deferito (token 32char, 7gg, auto-promote). Seed dev: `cliente@studio-demo.local / Cliente123!`.
- **BRIEF ristorazione non autoritativo** per questo verticale — autorità di design = `docs/studiodesk/` + ADR-0043/0044/0045.

**Task 1 — Identity + Auth + Portale Shell (PR #103, `1afeb17`, ADR-0046)**

- `enum UserTipo` / `enum ClienteRuolo` + `User.tipo/aziendaId/clienteRuolo` + relation `User↔Azienda` + CHECK constraint `chk_cliente_azienda_id`.
- `AuthenticatedUser` / `JwtStrategy` espongono `tipo`/`aziendaId`/`clienteRuolo` (fresh, JWT minimal invariato).
- Route-group `(portale)/` con `PortaleShell` + `RequireTipo` gate.
- Seed: role template "Cliente" + permesso `portale.documenti.visualizza` (→ 46 permessi). Cliente demo.
- 58 unit + 83 e2e, runtime UI 4/4.

**Task 2 — Documenti read-only lato cliente (PR #104, `281e0c4`, ADR-0046)**

- `PortaleDocumentiController` (`GET /portale/documenti`, `GET /portale/documenti/:id/download`).
- ACL: `visibilita=tutti` → tutti utenti azienda; `visibilita=azienda` → solo `clienteRuolo=admin`. In-query, 404 no-leak.
- `ClienteDocumentoView` senza `storageKey`/`createdBy`/`tenantId`.
- Pagina FE lista/download + nav PortaleShell. Chore: `var/` aggiunto a `.gitignore`.

**Task 3 — Comunicazioni reply-only lato cliente (PR #105, `f963510`, ADR-0047)**

- 2 permessi: `portale.comunicazioni.visualizza` + `portale.comunicazioni.rispondi` (→ 48 permessi).
- `listForCliente` / `getForCliente` / `replyCliente` (lato=cliente, autoreUserId valorizzato) / `markLettoCliente`.
- `PortaleComunicazioniController` 4 rotte. Note interne escluse in-query. Reply text-only (TD-portale-com-allegati).
- Pagina FE lista/dettaglio/reply + timeline Studio sx / "Tu" dx. markLetta on-open.
- ADR-0047: 7 decisioni (reply-only, no apertura thread, DTO dedicato, viste denormalizzate).

**Task 4 — Circolari letture + conferma (PR #106, `7687e06`, ADR-0048)**

- Migration `add_circolari_letture`: `Circolare.richiedeConferma Boolean @default(false)` + `model CircolareLettura` (RLS flat appesa a mano).
- `portale.circolari.visualizza` (→ 49 permessi). ACL: `tutti`→tutti clienti tenant, `azienda`→clienti azienda. Solo `stato=pubblicata` visibile.
- `PortaleCircolariController`: list / get (markLetta on-open) / conferma (422 se `!richiedeConferma`, idempotente).
- Checkbox `richiedeConferma` nel form studio (loop end-to-end chiuso).
- FE lista/dettaglio con badge "Conferma richiesta" + bottone conferma.

**2. read_report studio (PR #107, `b43aeb1`, ADR-0048 §1)**

`GET /circolari/:id/report` gated `circolari.read_report` (permesso già seedato da ADR-0045, ora con consumer reale):

- Risoluzione destinatari: `tutti`→tutti i clienti tenant, `azienda`→clienti delle aziende destinatarie, dedup in-query.
- Left-join `circolari_letture`: summary (attesi/letti/confermati) + per-recipient breakdown.
- Bozza → 422 `E_CIRCOLARE_NOT_REPORTABLE`. Colonna "Confermata" condizionale a `richiedeConferma`.
- Pannello FE nel dettaglio circolare studio, gated su permesso + stato.
- `TD-circolari-read-report` CHIUSO.

**3. Ricognizione infra deploy applicativo**

⚠️ **Il tier applicativo NON è in esecuzione su `gestionale-test`** — Caddy serve un placeholder statico (`respond "Gestionale — HTTPS it works!" 200`) per qualsiasi path. `/api/health` 200 è **falso positivo**: non prova che l'app sia up. Come distinguerlo: body identico per path random.

Stack live reale: `docker-compose.dev.yml` + override `docker-compose.prod.yml` (solo Caddy). Solo 4 container infra (postgres/redis/caddy/mailpit). Nessun servizio app definito nei compose.

**Cosa manca per il deploy applicativo reale** (task infra dedicato, non questa sessione):

- Dockerfile multi-stage per `accountant-api` e `accountant-web` (non esistono).
- Servizi api/web in compose su `gestionale_network`.
- Sostituzione placeholder Caddy con `reverse_proxy` + `header_up X-Tenant-Slug {labels.2}` (da subdomain).
- Divergenza env: `DATABASE_URL` host usa `127.0.0.1:5432`, container deve usare `postgres:5432`.
- Global prefix reale: `/api/v1/...` (non `/api/health` — quel path non esiste nell'app).
- **Decisione chiave già presa**: Caddy inietta `X-Tenant-Slug` dal subdomain via `header_up` — l'app non cambia.

### Visione del verticale — tre livelli StudioDesk (roadmap)

1. **Operatore-studio** — staff. ✅ **COMPLETO**: aziende, referenti, preventivi, scadenze, dashboard, Comunicazioni, Documenti, Circolari (incl. read_report). Frontend `accountant-web`.
2. **Cliente-dello-studio** — portale. ✅ **COMPLETO** (livello 2): identity+auth, documenti read-only, comunicazioni reply-only, circolari letture+conferma. Route-group in `accountant-web`. Subdomain reale = task infra futuro.
3. **Super-admin** — `oneplatform` + `sa.<verticale>` (parcheggiato).

### Prossimo task

**Deploy applicativo reale** (`gestionale-test`): Dockerfile api/web → servizi compose → Caddy `reverse_proxy` → cutover. Task infra con STOP 0 dedicato. Le 4 decisioni aperte sono già identificate (vedi §3 sopra).

In parallelo / dopo deploy: **API pubbliche** (versioning `/v1/`, API key per-tenant, Swagger/OpenAPI) — post-livello-2, stack domini ora stabile.

### Fili aperti

- **Deploy applicativo**: non fatto, tier app spento, task dedicato.
- **Invito cliente**: differito (token, registrati.php pattern). Per ora solo seed dev.
- **`TD-circolari-utente-forward`**: enum `DestinatarioTipo.utente` presente, nessuna logica. Attiva con targeting singolo utente (futuro).

### Tech debt aperti

Invariati: **TD-BV** · **TD-CB** · **TD-PATCH-null-FK** · **TD-blocklist-drift** · **`web` external one-time** · **TD-documenti-tipo-codice** · **TD-utente-enum-forward** · **TD-storage-gc** · **TD-moduleResolution-node10** · **TD-circolari-utente-forward**.

Nuovi da questa sessione:

- **TD-portale-com-allegati**: download/upload allegati lato cliente nelle comunicazioni (backlog ADR-0047).
- **TD-portale-com-apertura**: apertura nuovi thread da cliente admin-azienda (backlog ADR-0047).
- **TD-portale-circolari-html**: render HTML sanitizzato del body circolare (backlog ADR-0048).

Chiusi in questa sessione:

- **TD-circolari-letture**: `circolari_letture` + `richiede_conferma` → chiuso con PR #106.
- **TD-circolari-read-report**: `read_report` endpoint → chiuso con PR #107.

### Convenzioni di processo (invariate)

- **Gate a due corsie** (FULL se schema/RLS/tx/business-logic/auth/pattern-nuovo → ADR dedicato; LEAN se CRUD che replica → spot-check + entry PROGRESS).
- **Self-check report a STOP 2** prima del diff; Claude strategico legge il diff reale.
- STOP-gate: 0 → 1 → 2 → 3. **Merge SEMPRE separato** dopo `gh pr checks --watch` + via esplicito di Nicolò.
- `git add` selettivo (mai `-A`); commitlint header ≤ 100 inglese; `docs/studiodesk/` + `betadesk` READ-ONLY.
- **Split commit per rischio:** refactor che tocca codice live isolato dal modulo nuovo.
- **Pattern "verificato vs promesso":** punti security-sensitive richiedono test dedicati.
- **Empirical-first:** mai asserire scope/fix da deduzione narrativa — sempre `find`/`grep`/`cat` prima.
- **Verifica runtime manuale** (ruolo non-superuser) prima di ogni commit — pattern consolidato da questa sessione.

### Note operative host (aggiornate)

- Repo: `/home/deploy/projects/gestionale`
- Caddyfile: `infra/caddy/conf/Caddyfile`
- Caddy: container `gestionale_caddy` (immagine custom `infra/caddy/Dockerfile` — caddy 2.11 + DNS Cloudflare)
- Postgres: container `gestionale_postgres`
- Prisma: via script wrapper dotenv (`pnpm --filter @gestionale/db prisma:migrate:status`)
- Seed: `pnpm --filter @gestionale/db db:seed` (non `prisma:seed`)
- DB name: `gestionale` (non `gestionale_dev`)
- Tabelle `@@map` snake_case: `documenti_tipi`, `permissions`
- Verifica RLS: via `pg_class` (`relrowsecurity`/`relforcerowsecurity`), NON `pg_tables`
- `docker compose exec` con `-T` in non-interattivo; container diretti (non `-f docker-compose.dev.yml`)
- SSH tunnel per browser locale: `LocalForward 3003 localhost:3003` + `LocalForward 3002 localhost:3002`
- ⚠️ `/api/health` 200 = **falso positivo** (placeholder Caddy) — non prova che l'app sia up

---

## PARTE B — Snapshot tecnico

### Git

- **Main @ b43aeb1** (+1 commit `docs(handoff)` in arrivo via PR). Cronologia recente:
  - `b43aeb1` feat(accountant): circolari report letture lato studio — read_report (ADR-0048) (#107)
  - `7687e06` feat(accountant): circolari portale cliente — letture + conferma (ADR-0048) (#106)
  - `f963510` feat(accountant): portale comunicazioni cliente — reply-only (ADR-0047) (#105)
  - `281e0c4` feat(accountant): portale documenti read-only (ADR-0046) (#104)
  - `1afeb17` feat(accountant): portale cliente foundation — identity, auth routing, portale shell (ADR-0046) (#103)
- **Working tree PULITO**, nessun branch feature pendente.
- ADR in repo fino a **0048**.

### Schema dominio accountant — aggiornato

`Azienda` · `Referente` · `Preventivo` + `PreventivoVoce` · `Scadenza` + `ScadenzaCategoria` · `Comunicazione` + `ComMessaggio` + `ComAllegato` + `com_counter` · `DocumentoTipo` + `Documento` · `Circolare` + `CircolareDestinatario` + **`CircolareLettura`** (RLS flat, per-user letta/confermata). Enum: `CircolareStato`, `DestinatarioTipo`, **`UserTipo`**, **`ClienteRuolo`**. CHECK constraint `chk_cliente_azienda_id` su `users`.

### Permessi (49 totali)

Namespace studio: `aziende.*` · `referenti.*` · `preventivi.*` · `scadenze.*` · `comunicazioni.*` · `documenti.*` · `circolari.{create,publish,archive,read_report}`.
Namespace portale (isPortale, esclusi dai template studio): `portale.documenti.visualizza` · `portale.comunicazioni.{visualizza,rispondi}` · `portale.circolari.visualizza`.
Role template "Cliente" → 4 permessi portale.

### Stack & ambiente

- NestJS 11, Next.js 15, Prisma 6, PostgreSQL 16 (RLS), Redis, Vitest, Testcontainers, Playwright, Tailwind, shadcn/ui.
- Server Hetzner `gestionale-test`, Docker Compose (`docker-compose.dev.yml` + `docker-compose.prod.yml` per Caddy prod).
- **StorageService** in `packages/platform/src/storage/`.
- **MailService** in `packages/platform/src/mail/` — solo security. Non usato da accountant-api.
- **HTTPS live (ADR-0041/0042):** Caddy wildcard cert `*.studiodesk.cloud`, DNS-01 Cloudflare.
- **betadesk** (`/home/deploy/projects/betadesk`, sibling fuori repo): READ-ONLY.
- Tenant demo: `studio-demo` (Super Admin 49 permessi; Collaboratore; **Cliente demo** `cliente@studio-demo.local / Cliente123!` legato ad AZ001) + `studio-acme` (isolamento).

### Roadmap dominio (riferimento)

- ✅ Livello 1 operatore: **COMPLETO**
- ✅ Livello 2 **portale cliente**: **COMPLETO** (route-group path-based; subdomain reale = task infra)
- 🔜 **Deploy applicativo reale** (Dockerfile + compose + Caddy reverse_proxy)
- 🔜 **API pubbliche** (post-deploy: versioning `/v1/`, API key per-tenant, Swagger/OpenAPI)
- Pipeline ciclo cliente (futura): assessment Groq → preventivo → mandato/incarico → timesheet → dashboard margine
- FIC = livello 3 (`sa.<verticale>`), parcheggiato

### Verifica finale richiesta a Code (chiusura sessione)

Working tree pulito, main @ `b43aeb1` allineato origin, nessun branch pendente, PROGRESS.md aggiornato con entry [2026-06-23] per PRs #103–#107 (Livello 2 portale cliente + read_report).
