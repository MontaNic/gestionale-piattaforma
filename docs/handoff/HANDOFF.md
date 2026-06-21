# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ 1a1350a (+1 commit docs(handoff) in arrivo via PR). Sessione produttiva: deploy allineato + Circolari MVP chiuso (PR #101) + smoke test browser confermato.
> **Data:** 2026-06-21.

---

## PARTE A — Stato del progetto

### Natura di questa sessione

Sessione di **consolidamento + feature closure**. Partita da livello 1 quasi completo (mancavano solo Circolari), chiusa con livello 1 operatore-studio **completamente chiuso**. Deploy host allineato, smoke test browser confermato via SSH tunnel, tunnel SSH configurato su `~/.ssh/config` locale.

### Dove siamo

Monorepo pnpm + Turbo, 2 verticali-core su base condivisa `packages/` (`@gestionale/db`, `db/nest`, `auth`, `auth-web`, `platform`, `shared`, `ui`, `api-client`, `i18n`):

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): completo F1 (Menu CRUD + UI). Invariato.
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): **livello 1 COMPLETO**. End-to-end: skeleton → aziende → referenti → RLS anagrafica → preventivi + RLS → dashboard → scadenze + categorie custom → Comunicazioni (ADR-0043) → Documenti (ADR-0044) → **Circolari (ADR-0045)**. Catalogo permessi: **45**.

### NOVITÀ sessione 2026-06-21

**1. Deploy host allineato (pre-Circolari).**

- Migration `add_comunicazioni` + `add_documenti` già applicate (erano state applicate durante implementazione sessione precedente).
- Seed 41 permessi confermato, RLS Comunicazioni + Documenti verificata.
- Caddy reload graceful eseguito, 3 probe co-locati 401 ✓.
- Correzione script deploy: verifica RLS via `pg_class` (non `pg_tables`); `docker compose exec` con `-T` in non-interattivo.

**2. Modulo Circolari MVP (ADR-0045, PR #101, commit 1a1350a).**
Broadcast unidirezionale studio→clienti. Scope lean (DDL 07 base):

- 2 tabelle: `circolari` (testata: titolo, oggetto_email, body_html, stato, priorità, pubblicata_il, scade_il, soft-delete) + `circolari_destinatari` (tipo tutti/azienda/utente, azienda_id nullable).
- Enum: `CircolareStato` (bozza/pubblicata/archiviata), `DestinatarioTipo` (tutti/azienda/utente).
- RLS flat USING-only + FORCE su entrambe le tabelle, TEXT tenant_id no-cast.
- Macchina di stato: bozza → pubblicata (`publish`) → archiviata (`archive`). Guard 422 su transizioni illegali.
- 4 permessi: `circolari.{create, publish, archive, read_report}` (→ 45 totali). `read_report` è forward: seedato ma senza endpoint nell'MVP (report letture vive al livello 2).
- Enum `utente` in `DestinatarioTipo`: presente ma nessun endpoint/service lo processa — TD-circolari-utente-forward (simmetria con TD-utente-enum-forward di Documenti).
- UI: lista + form inline + dettaglio, sidebar, i18n it/en.
- 24 test nuovi (8 unit + 16 e2e), CI verde (Lint·Typecheck·Format·Test + Playwright).
- Deferiti: `circolari_letture`, `richiede_conferma`, email notifica, AI, Telegram, versioning, solleciti, reparto, rich editor (tutto documentato in ADR-0045 backlog).

**3. Smoke test browser confermato.**

- Collaboratore (`collaboratore@studio.local / Collaboratore123!`): lista ✅, crea bozza ✅, modifica ✅, bottone Pubblica assente ✅, elimina ✅.
- Enforcement server: POST /circolari/:id/publish → 403 `E_AUTH_INSUFFICIENT_PERMISSIONS` ✅.
- Accesso tramite SSH tunnel (`LocalForward 3003/3002` in `~/.ssh/config` locale) — configurato e funzionante.

**4. API pubbliche — voce roadmap registrata.**
Non pianificate finora. Deciso di registrarle come "on the horizon": versioning route `/v1/`, API key auth per-tenant, Swagger/OpenAPI (NestJS nativo). Timing: post-livello-2 quando lo stack domini è stabile.

### Visione del verticale — tre livelli StudioDesk (roadmap)

1. **Operatore-studio** — staff (`/admin`). ✅ **COMPLETO**: aziende, referenti, preventivi, scadenze, dashboard, Comunicazioni, Documenti, Circolari. Frontend `accountant-web`.
2. **Cliente-dello-studio** — l'azienda-cliente (`/` public, `[slug].studiodesk.cloud`). Secondo frontend, non esiste ancora. Auth email+password+2FA+passkey, no auto-registrazione (solo invito/creazione studio). **Sblocca le superfici già modellate ma dormienti**: `circolari_letture` + `richiede_conferma`, thread `lato=cliente`/`letto_cliente`, `VisibilitaDocumento.utente`, `circolari.read_report` endpoint. Nota sicurezza (ADR-0042 §5): operatore e cliente condividono l'origin → separazione a livello auth/guard.
3. **Super-admin** — `oneplatform` (observability infra) + `sa.<verticale>` (tenant + billing FIC, parcheggiato).

### Prossimo task

**Livello 2 — portale cliente** (`[slug].studiodesk.cloud`). Slice grossa: nuovo frontend, auth email+password+2FA+passkey, sblocco superfici dormienti. Da pianificare a STOP 0 della prossima sessione.

### Fili aperti

Nessun deploy pendente. Host allineato a main @ `1a1350a`.

### Tech debt aperti

Invariati: **TD-BV** (e2e gira come `postgres` superuser, blind spot RLS); **TD-CB** (e2e backend solo-locale); **TD-PATCH-null-FK**; **TD-blocklist-drift**; **`web` external one-time**; **TD-documenti-tipo-codice**; **TD-utente-enum-forward**; **TD-storage-gc**; **TD-moduleResolution-node10**.

Nuovi da questa sessione:

- **TD-circolari-utente-forward**: enum `DestinatarioTipo.utente` presente ma nessuna logica. Attiva al livello 2 insieme a `circolari_letture`.

### Convenzioni di processo (invariate)

- **Gate a due corsie** (FULL se schema/RLS/tx/business-logic/auth/pattern-nuovo → ADR dedicato; LEAN se CRUD che replica → spot-check + entry PROGRESS).
- **Self-check report a STOP 2** prima del diff; Claude strategico legge il diff reale.
- STOP-gate: 0 → 1 → 2 → 3. **Merge SEMPRE separato** dopo `gh pr checks --watch` + via esplicito di Nicolò.
- `git add` selettivo (mai `-A`); commitlint header ≤ 100 inglese; `docs/studiodesk/` + `betadesk` READ-ONLY.
- **Split commit per rischio:** refactor che tocca codice live isolato dal modulo nuovo.
- **Pattern "verificato vs promesso":** punti security-sensitive richiedono test dedicati.
- **Empirical-first:** mai asserire scope/fix da deduzione narrativa — sempre `find`/`grep`/`cat` prima.

### Note operative host (aggiornate)

- Repo: `/home/deploy/projects/gestionale` (non `gestionale-piattaforma`)
- Caddyfile: `infra/caddy/conf/Caddyfile`
- Caddy: nel container `gestionale_caddy`
- Postgres: service `postgres` (container `gestionale_postgres`)
- Prisma: via script wrapper dotenv (`pnpm --filter @gestionale/db prisma:migrate:status`)
- Tabelle `@@map` snake_case: `documenti_tipi`, `permissions`
- Verifica RLS: via `pg_class` (`relrowsecurity`/`relforcerowsecurity`), NON `pg_tables`
- `docker compose exec` con `-T` in non-interattivo
- SSH tunnel per browser locale: `LocalForward 3003 localhost:3003` + `LocalForward 3002 localhost:3002` in `~/.ssh/config` — configurato e funzionante

---

## PARTE B — Snapshot tecnico

### Git

- **Main @ 1a1350a** (+1 commit `docs(handoff)` in arrivo via PR). Cronologia recente:
  - `1a1350a` feat(accountant): circolari MVP — broadcast studio→clienti (ADR-0045) (#101)
  - `ddca538` docs(handoff): aggiorna snapshot a 263e252 (Comunicazioni #98 + Documenti #99) (#100)
  - `263e252` feat(accountant): documenti module — studio document archive (ADR-0044) (#99)
- **Working tree PULITO**, nessun branch feature pendente.
- ADR in repo fino a **0045**.

### Schema dominio accountant — aggiornato

`Azienda` · `Referente` · `Preventivo` + `PreventivoVoce` · `Scadenza` + `ScadenzaCategoria` · `Comunicazione` + `ComMessaggio` + `ComAllegato` + `com_counter` · `DocumentoTipo` + `Documento` · **`Circolare` + `CircolareDestinatario`** (RLS flat, macchina di stato bozza→pubblicata→archiviata). Enum nuovi: `CircolareStato`, `DestinatarioTipo`.

### Stack & ambiente

- NestJS 11, Next.js 15, Prisma 6, PostgreSQL 16 (RLS), Redis, Vitest, Testcontainers, Playwright, Tailwind, shadcn/ui.
- Server Hetzner `gestionale-test`, Docker Compose `docker-compose.dev.yml`.
- **StorageService** in `packages/platform/src/storage/`.
- **MailService** in `packages/platform/src/mail/` — SMTP nodemailer, solo security (sendAccountLockedEmail, sendRefreshTokenTheftEmail). Non usato da accountant-api. Brevo/framework notifiche = futura task separata.
- **HTTPS live (ADR-0041/0042):** Caddy wildcard cert, `import colocated.*.caddy` gitignored.
- **betadesk** (`/home/deploy/projects/betadesk`, sibling fuori repo): READ-ONLY.
- Tenant demo: `studio-demo` (Super Admin 45 permessi; Collaboratore) + `studio-acme` (isolamento).

### Roadmap dominio (riferimento)

- ✅ Livello 1 operatore: **COMPLETO**
- 🔜 Livello 2 **portale cliente** (slice grossa: nuovo frontend, auth 2FA+passkey, sblocco superfici dormienti)
- 🔜 **API pubbliche** (post-livello-2: versioning `/v1/`, API key per-tenant, Swagger/OpenAPI)
- Pipeline ciclo cliente (futura): assessment Groq → preventivo → mandato/incarico → timesheet → dashboard margine
- FIC = livello 3 (`sa.<verticale>`), parcheggiato

### Verifica finale richiesta a Code (chiusura sessione)

Working tree pulito, main @ `1a1350a` allineato origin, nessun branch pendente, PROGRESS.md aggiornato con entry [2026-06-21] per PR #101 (Circolari MVP).
