# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ 0463533 (HTTPS + wildcard `*.studiodesk.cloud`, ADR-0041, PR #94 squash-merged) — **invariato in questa sessione** (nessun commit). Sessione strategica/infra: **lumimondo live** in provvisorio + **3 file infra nel working tree non committati** + **ADR-0042 in bozza** (fuori repo). _(Code: conferma lo SHA reale con `git log --oneline -1`.)_
> **Data:** 2026-06-14.

---

## PARTE A — Stato del progetto

### Natura di questa sessione

Sessione **strategica/infra**, non di feature-code: nessun modulo di dominio toccato, nessun commit. Si è (1) definito il modello domini/sottodomini/resolver/superfici → **ADR-0042 (bozza)**, (2) analizzato e deciso il posizionamento di `game`, (3) messo **lumimondo live via HTTPS** in modo provvisorio, stanando e risolvendo un bug infra pre-esistente (mount-stale del caddy). Lo stato del codice di dominio è **identico** al HANDOFF precedente.

### Dove siamo (codice di dominio — invariato)

Monorepo pnpm + Turbo, 2 verticali-core sulla base condivisa `packages/` (`@gestionale/db`, `db/nest`, `auth`, `auth-web`, `platform`, `shared`, `ui`, `api-client`, `i18n`):

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): completo (F1 Menu CRUD + UI). Stessa anatomia tenant di accountant (`/t/[slug]`).
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): in costruzione attiva. End-to-end: skeleton (ADR-0029/0030); `aziende` BE+UI (0031/0032); `referenti` BE+UI (0033/0034); RLS isolation anagrafica (0035); `preventivi` BE+UI (0036/0037) + RLS isolation; dashboard operatore-studio (0038); `scadenze` BE (0039, pattern categorie piattaforma/custom) + UI (0040) + categorie custom UI (PR #92). Suite e2e accountant: **61/61** (locale, TD-CB). Catalogo permessi: **37**.

### NOVITÀ sessione 2026-06-14 — infra & architettura

**1. Modello domini/sottodomini/resolver/superfici → ADR-0042 (BOZZA, non in repo).** Decisioni lockate (sintesi completa in Parte B):

- Resolver unico che produce `{ vertical, tenant, surface }`; tutto il resto consuma solo il suo output. Migrazione beta→target = config del resolver, non refactor.
- Beta (dominio unico): `vertical`=label sottodominio, `tenant`=path `/t/<slug>`, `surface`=path (`/admin` operatore · `/` cliente). Target: `vertical`=dominio, `tenant`=sottodominio (`rossi.`), `surface`=path (invariata). **La `surface` sta sul path in entrambe le fasi**; solo `tenant` migra.
- Superfici amministrative su due assi: **`oneplatform`** = observability infra (read-mostly, detection-not-remediation — firewall/azioni distruttive MAI da UI); **`sa.<verticale>`** = control plane di prodotto (tenant + fatturazione servizi). Predisporre i domini ≠ costruirli (YAGNI): per infra si adottano strumenti maturi, non si scrive da zero.
- Nessuno schema change (custom-domain deferito). Blocklist `FORBIDDEN_SLUGS` da **estendere** subdomain-aware (`sa`, infra, nomi-verticale), consultata prima del lookup.

**2. `game` = progetto `lumimondo-adventure` — DECISO FUORI dal perimetro.** STOP 0 read-only: PWA vanilla JS + Phaser, server Node zero-dipendenze, **nessun DB** (salvataggi JSON), **nessun tenant/RLS**, **nessuna auth** applicativa (solo basic_auth sul proxy), **zero accoppiamento** col core (il suo `CLAUDE.md` impone isolamento assoluto). Mismatch totale col core B2B multi-tenant → **non è un verticale-core**: è un progetto co-locato che condivide solo l'infra. **Tolto dal resolver.** I verticali-core restano `accountant` + `restaurant`.

**3. lumimondo LIVE provvisorio.** Esposto su `https://adventure.studiodesk.cloud` (sotto il cert wildcard esistente, riuso senza nuova emissione), `basic_auth` utente `famiglia` (password nel password manager di Nicolò, **non su disco/handoff**). Container su rete docker `web` condivisa con `gestionale_caddy`, raggiunto per service-name `lumimondo-adventure:3000`. **Porta 3000 chiusa sull'host** (rimosso il publish → bypass auth eliminato). È accesso **provvisorio** finché lumimondo non ha dominio/auth propri; non lo trasforma in verticale.

### Visione del verticale — tre livelli StudioDesk (roadmap)

1. **Operatore-studio** — staff (`/admin`). Costruito finora (aziende, referenti, preventivi, scadenze, dashboard). Frontend `accountant-web`.
2. **Cliente-dello-studio** — l'azienda-cliente (`/` public, `[slug].studiodesk.cloud`). Secondo frontend, non esiste ancora. Auth cliente email+password+2FA+passkey; il cliente non si auto-registra (solo invito/creazione studio). Nota sicurezza (ADR-0042 §5): operatore e cliente condividono l'origin → separazione a livello auth/guard, non solo path.
3. **Super-admin** — scomposto in `oneplatform` (observability infra) + `sa.<verticale>` (tenant + billing FIC, parcheggiato).

Moduli StudioDesk ancora mancanti nel TS: Comunicazioni, Documenti & Circolari, Knowledge Base, Questionari, Agevolazioni, Team.

### Prossimo task — da concordare a STOP 0

In ordine di precedenza:

- **PR di formalizzazione infra + ADR-0042** (la più urgente): porta a main i 3 file infra del working tree + l'ADR-0042 (oggi solo bozza fuori repo). Vedi "Fili aperti".
- **Fase 1 ADR-0042**: Caddy `reverse_proxy` verso le porte locali dei verticali-core (accountant) — primo passo che rende reale il routing per host.
- Altri moduli operatore-studio (Documenti/Comunicazioni) verso il completamento livello 1.
- Portale cliente-dello-studio (livello 2) — nuovo frontend, slice grossa.

### Fili aperti (da chiudere alla prossima sessione)

1. **3 file infra nel working tree, NON committati** (intenzionale, non persi — vivono sul working tree del server):
   - `infra/caddy/conf/Caddyfile` — blocco `@adventure` (host-matcher dentro il wildcard) + `handle` + fallback.
   - `docker-compose.prod.yml` — rete `web` (external) sul servizio caddy.
   - `/home/deploy/projects/lumimondo-adventure/docker-compose.yml` — rimosso `ports:`, aggiunta rete `web` _(file fuori dal repo gestionale)_.
2. **ADR-0042 ancora in bozza fuori repo** — contenuto pronto (negli output della sessione strategica), da committare come `docs/architecture/ADR-0042-...md` nella PR di formalizzazione, **aggiornato** per: togliere `game` dal resolver, registrare il mount-stale come discovery/fix.
3. **PROGRESS.md NON aggiornato** — intenzionale: registra macro-task mergeati; oggi nessun merge. Si aggiorna con la PR ADR-0042.

### Tech debt aperti

Invariati dal precedente: **TD-BV** (suite e2e gira come `postgres` superuser); **TD-RLS-dashboard/scadenze candidate**; **`scadenze_categorie` senza RLS** (per design, scoping applicativo); **TD-PATCH-null-FK**; **TD-BS Sub-2**; **TD-CB** (e2e backend solo-locale); **TD-BY** (pricing, defer S23).

Nuovi da questa sessione:

- **Discovery/fix mount-stale `gestionale_caddy`** — il bind-mount su `/etc/caddy` era stale (dir host sostituita sotto il container → config-in-RAM ≠ file-su-disco, `validate`/`reload` rotti). **Risolto** col `--force-recreate` (riaggancio all'inode corrente); `caddy reload` ora torna a funzionare. Da formalizzare in ADR-0042: causa + fix + **prevenzione da decidere**.
- **TD-blocklist-drift** — `FORBIDDEN_SLUGS` (BE) e `RESERVED_SLUGS` (FE) duplicate, sync a mano. Centralizzazione = build-ahead, deferita; lieve divergenza odierna accettabile.
- **`web` external one-time** — la rete docker `web` è `external: true` nei due compose: esiste (creata a caldo). Su host pulito va creata una-tantum (`docker network create web`) prima del primo `up`.

### Convenzioni di processo (in vigore — invariate)

- **Gate a due corsie** (FULL se schema/RLS/tx/business-logic/auth/pattern-nuovo → ADR dedicato; LEAN se CRUD che replica pattern → spot-check + entry PROGRESS che linka l'ADR). Routing a STOP 0.
- **Routing modello**: FULL→frontier (Fable 5); LEAN→Opus 4.8/Sonnet; docs-only/HANDOFF/cleanup→Sonnet. Switch tra sessioni, non mid-conversation.
- **Self-check report a STOP 2** prima del diff; Claude strategico reviewa giudizio + legge il diff.
- STOP-gate: 0 (preflight read-only) → 1 (spec+DP) → 2 (spot-check/self-check) → 3 (commit/PR/ADR). **Merge SEMPRE separato**: `gh pr checks --watch` come comando a sé, `gh pr merge` solo dopo via esplicito di Nicolò, mai nello stesso blocco (vale anche per docs/handoff).
- `git add` selettivo (mai `-A`); commitlint header ≤ 100; path con `[slug]`/`[id]` quotati; `docs/studiodesk/` READ-ONLY; host SSH `portal` = produzione PHP, mai scrivere.
- HANDOFF a `docs/handoff/HANDOFF.md` via PR `docs/` dedicata (no push diretto a main; CI gira anche su doc-only).

### Note operative

- **lumimondo/infra**: `gestionale_caddy` è l'unico gateway pubblico (80/443), ora su rete `gestionale_network` + `web`. adventure raggiunto via `web` per service-name; **non** pubblicare la 3000 sull'host (bypass auth). Per spegnere l'accesso: rimuovi il blocco `@adventure` + `caddy reload`.
- Dev server zombie + `.next` di prod (Discovery #46): `rm -rf apps/*/.next` + kill `next-server` orfani prima di un dev server fresco.
- e2e accountant: `pnpm --filter @gestionale/accountant-api test:e2e` (Testcontainers, locale). 61 test.
- Migration: `add_<entity>` (`prisma migrate dev --create-only` → blocco RLS/partial-unique a mano → applica). RLS `<table>_tenant_isolation` USING-only + FORCE.

---

## PARTE B — Snapshot tecnico

### Git

- **Main @ 0463533** (PR #94, ADR-0041 HTTPS) — **invariato in questa sessione** (nessun commit). _(Code: conferma con `git log --oneline -1`.)_ +1 commit `docs(handoff)` in arrivo via PR.
- **Working tree SPORCO (intenzionale):** 3 file modificati non committati (Caddyfile, compose prod, compose adventure — vedi Fili aperti #1). **Non perderli.** Branch unico `main`, nessun branch feature pendente.
- ADR in repo fino a **0041**. **ADR-0042 in bozza fuori repo** (da committare con la PR infra).

### Modello domini/resolver/superfici (ADR-0042, bozza — cuore strategico di oggi)

| Dimensione        | Beta (dominio unico `studiodesk.cloud`)      | Target (un dominio per verticale) |
| ----------------- | -------------------------------------------- | --------------------------------- |
| `vertical`        | prima label sottodominio (`commercialisti.`) | il dominio (`studiodesk.cloud`)   |
| `tenant` (studio) | path `/t/<slug>`                             | sottodominio (`rossi.`)           |
| `surface`         | path `/admin` (operatore) · `/` (cliente)    | path `/admin` · `/` (invariata)   |

- Resolver = unico punto che legge host+path; consulta la blocklist **prima** del lookup (label riservata = superficie di sistema, non tenant). Tocca solo i 2 punti che oggi popolano lo slug: middleware FE + `TenantMiddleware` API pre-auth. JWT post-auth (ADR-0008) + iniezione RLS (`SET LOCAL app.tenant_id`) **invariati**. Nessuno schema change.
- Superadmin: `oneplatform` (observability infra, read-mostly, **firewall/azioni distruttive mai da UI** — la UI osserva, la CLI agisce) + `sa.<verticale>` (tenant + billing FIC).
- `game`/lumimondo: **fuori dal resolver**, progetto co-locato. Verticali-core nel resolver = `accountant`, `restaurant`.
- Caddy: in beta `reverse_proxy` verso porte locali dei verticali-core (no containerizzazione app). Placeholder ancora attivo dietro il proxy per i verticali-core.

### Schema dominio accountant (su `aziende`) — invariato

`Azienda` (15 campi, `tipoCliente` enum, soft-delete, RLS) · `Referente` (1:N, RLS) · `Preventivo` (enum `StatoPreventivo`, 3 totali Decimal, soft-delete, RLS) + `PreventivoVoce` (RLS dedicata, `totaleRiga` server-calc) · `Scadenza` (enum `VisibilitaScadenza`, FK opzionali SetNull, RLS+FORCE) + `ScadenzaCategoria` (`tenantId` nullable = piattaforma/custom, NO RLS → scoping applicativo, NO soft-delete).

### Stack & ambiente

- NestJS 11, Next.js 15, Prisma 6.19.3, PostgreSQL 16 (RLS), Redis 7, Vitest 3.2.4, Testcontainers, Playwright, Tailwind 3.4, shadcn/ui.
- Server Hetzner `gestionale-test` (Ubuntu), Docker Compose `docker-compose.dev.yml` (+ `docker-compose.prod.yml` per Caddy prod). Ruolo runtime DB `gestionale_app` (NOSUPERUSER NOBYPASSRLS), migration via `postgres` (DIRECT_URL).
- **HTTPS live (ADR-0041):** Caddy custom (modulo DNS Cloudflare) serve `studiodesk.cloud` + `*.studiodesk.cloud`, cert Let's Encrypt reali (DNS-01, auto-rinnovo), HTTPS-only + HSTS. Segreti (`CF_API_TOKEN`/`ACME_EMAIL`) solo in `.env`. **TODO:** backup volume `caddy_data` (cert reali).
- **lumimondo-adventure** (`/home/deploy/projects/lumimondo-adventure`, fuori monorepo): container su porta interna 3000 (host chiuso), rete `web`, live su `adventure.studiodesk.cloud` con basic_auth. PWA Phaser, zero-dep, salvataggi JSON, no DB/no tenant.
- Tenant demo: `studio-demo` (`admin@studio.local` Super Admin 37 permessi; `collaboratore@studio.local` Collaboratore con `scadenze.*`), + `studio-acme` per isolamento. Seed accountant: 5 aziende, 3 referenti, 2 preventivi, 7 categorie scadenze piattaforma.

### Roadmap dominio (riferimento)

Pipeline ciclo cliente: assessment (Groq) → preventivo → mandato/incarico (Groq) → timesheet/attività (costi interni) → dashboard margine (Groq). STOP-f3 catalogo servizi · f4 mandati · f5 timesheet · f6 margine. FIC = livello 3 (`sa.<verticale>`), parcheggiato.
