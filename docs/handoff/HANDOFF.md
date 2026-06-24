# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ `6f7e0d2` (+1 commit docs(handoff) in arrivo via PR).
> **Data:** 2026-06-25.

---

## PARTE A — Stato del progetto

### Natura di questa sessione

Sessione densa: **deploy applicativo reale** (tier app finalmente live su `gestionale-test`) + **Onda 1 completa** (reset password, invito cliente, superadmin minimale) + ricognizione AI/betadesk + pianificazione onde future.

### Dove siamo

Monorepo pnpm + Turbo, 2 verticali-core su base condivisa `packages/`:

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): scaffold congelato. Invariato.
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): **livello 1 + livello 2 COMPLETI** + **Onda 1 COMPLETA**. Catalogo permessi: **50**.

### NOVITÀ sessione 2026-06-25

**1. Deploy applicativo reale (PR #109, `8a06f88`)**

Il tier applicativo è ora **live e in esecuzione** su `gestionale-test`. Era il gap infra principale della sessione precedente.

- Dockerfile multi-stage per `accountant-api` (SWC builder, pnpm workspace-aware, prisma generate in-container) e `accountant-web` (Next standalone).
- Prerequisiti build: `tsconfig.build.json` api (SWC, `paths: {}`), `output: 'standalone'` web, `@swc/cli` devDep.
- `docker-compose.prod.yml`: servizi `accountant-api` + `accountant-web` su `gestionale_network`.
- Caddy: placeholder `respond 200` sostituito con `handle /api/* → reverse_proxy :3002` + `handle → reverse_proxy :3003`. Routing path-based same-origin.
- Env: `DATABASE_URL_DOCKER` / `DIRECT_URL_DOCKER` (host=`postgres`) nel `.env` gitignored — su host pulito vanno ricreate.
- Smoke test esterno: web 307 (Next), `/api/v1/health` ok, login cliente JWT emesso ✅.
- ⚠️ Immagine api ~1.15GB (TD: ottimizzazione pnpm prune prod, futuro).

**2. Onda 1 — Task 1: Reset password (PR #110, `e67c5f9`)**

- Model `PasswordReset` (token sha256, TTL 1h, monouso, dedup, RLS flat FORCE).
- `POST /auth/forgot-password` + `POST /auth/reset-password` (`@Public`).
- No-oracle: risposta sempre 200 a prescindere dall'esistenza email.
- Reset = logout globale (tutte le sessioni revocate in tx atomica).
- `MailService.sendPasswordResetEmail` con link tenant-scoped `/t/<slug>/reset-password?token=`.
- FE: pagine `forgot-password` + `reset-password` + link in login page. i18n it/en.
- Bug trovato in verifica manuale (non dal gate statico): link senza slug tenant → corretto.

**3. Onda 1 — Task 2: Invito cliente (PR #111, `09e7998`)**

- Model `ClienteInvito` (token sha256, TTL 7gg, dedup upsert su `(tenantId,aziendaId,email)`, RLS flat FORCE).
- Permesso `clienti.invitare` (→ 50 permessi, template Super Admin/Admin/Socio).
- `POST /aziende/:id/inviti` + `GET` + `DELETE` (revoca via `usedAt`).
- `POST /auth/accept-invite` (`@Public`): crea User cliente, auto-promote admin se azienda senza admin attivo, auto-login (ritorna `AuthTokensPayload`).
- `AuthService.issueSessionForUser` esportato per riuso.
- `MailService.sendInvitoClienteEmail`.
- FE: pannello `InvitiSection` in dettaglio azienda + pagina pubblica `accept-invite`. i18n it/en.

**4. Onda 1 — Task 3: Superadmin minimale (PR #112, `6f7e0d2`)**

- Tenant di piattaforma `oneplatform` (id fisso `01900000-0000-7000-8000-000000000001`) seedato.
- `PLATFORM_TENANT_ID` in `.env` + `.env.example`.
- `PlatformGuard` path-scoped: verifica `tenantId === PLATFORM_TENANT_ID`, fail-closed.
- `PlatformController` (`/platform/tenants`): list (cross-tenant via `withSystemContext`), create (riusa `TenantsService`), suspend, restore, soft-delete. Self-protection: vietato agire su `oneplatform` stesso.
- FE: pagina `/t/oneplatform/platform/tenants` + voce sidebar visibile solo nel tenant oneplatform. i18n it/en.
- Credenziali superadmin dev: `superadmin@oneplatform.local / Superadmin123!`.

**5. Ricognizione AI (betadesk)**

Subsistema AI betadesk mappato:

- Provider: Groq (`llama-3.3-70b-versatile`), layer astratto (`AIProvider` → `GroqProvider`).
- `AIClient` factory/facade + audit su `ai_audit`. `AIService` KB-aware multi-turno (assistente cliente). `KBRevisorService` (revisione notturna FAQ). Governance `AIPolicy`: toggle per-tenant, pseudonimizzazione PII, rate-limit/budget, audit.
- ⚠️ API key Groq era hardcoded in `master.php` → **chiave ruotata** (azione eseguita in sessione). Nuova chiave va inserita in `.env` quando implementeremo le feature AI.
- Piano: portare `AIClient` + `AIPolicy` su NestJS con `AnthropicProvider` + `GroqProvider` intercambiabili via env. Fuori scope per ora.

**6. Pianificazione onde future**

Definita roadmap a 6 onde (vedi §Roadmap). Onda 1 completa; Onda 2 inizia dalla prossima sessione.

### Visione del verticale — tre livelli StudioDesk

1. **Operatore-studio** ✅ COMPLETO
2. **Cliente-dello-studio** ✅ COMPLETO (portale path-based)
3. **Super-admin** ✅ MINIMALE (lifecycle tenant, `oneplatform`)

### Prossimo task — Onda 2

**Task 4 — Identità visiva / design system**: colore primario, tipografia, CSS vars shadcn. Sessione dedicata con proposte concrete prima di toccare codice.

**Task 5 — Homepage portale cliente**: "cosa c'è di nuovo oggi" — circolari non lette, comunicazioni, documenti recenti.

**Task 6 — Dashboard operatore differenziata per ruolo**.

### Fili aperti

- **`STUDIO_DESK.md` extension** (task 0 di riferimento): aggiungere sezione AI, cron inventory, feature map per pannello (admin/superadmin/public → stato in gestionale). Da fare prima dell'Onda 3.
- **Nuova chiave Groq** da inserire in `.env` quando si implementano feature AI.
- **Subdomain routing** (`[slug].studiodesk.cloud` per portale cliente): task infra futuro.
- **Invito operatore** via email (oggi solo seed manuale): Onda 4.

### Tech debt aperti

Invariati: **TD-BV** · **TD-CB** · **TD-PATCH-null-FK** · **TD-blocklist-drift** · **`web` external one-time** · **TD-documenti-tipo-codice** · **TD-utente-enum-forward** · **TD-storage-gc** · **TD-moduleResolution-node10** · **TD-circolari-utente-forward** · **TD-portale-com-allegati** · **TD-portale-com-apertura** · **TD-portale-circolari-html**.

Nuovi da questa sessione:

- **TD-immagine-api**: immagine `accountant-api` ~1.15GB (pnpm store include devDeps). Ottimizzabile con `pnpm prune --prod` o revisitando il layout runner.

### Roadmap onde

**Onda 1 — Sblocca l'uso reale** ✅ COMPLETA

1. ✅ Reset password (#110)
2. ✅ Invito cliente (#111)
3. ✅ Superadmin minimale (#112)

**Onda 2 — Identità e percezione** 🔜 4. Identità visiva (colore primario, tipografia, CSS vars shadcn) 5. Homepage portale cliente ("cosa c'è di nuovo oggi") 6. Dashboard operatore differenziata per ruolo

**Onda 3 — Valore operativo** 🔜 7. Email notifiche (circolari pubblicate, comunicazioni ricevute) 8. Alert scadenze cron (T-7 e T-1 via email) 9. Homepage studio pubblica (index.php equivalente, attivabile per tenant)

**Onda 4 — Piattaforma** 🔜 10. Superadmin monitoring (stato container, disk, memory — senza CLI) 11. Impersonation studio con banner 12. Invito operatore via email

**Onda 5 — Completamento portale cliente** 🔜 13. Download allegati comunicazioni lato cliente 14. Upload allegati lato cliente 15. 2FA TOTP operatore (campo `totpSecret` già in schema)

**Onda 6 — Futuro** 🔜 16. AI subsystem (assistente cliente KB-aware, `AIPolicy` governance) 17. Billing / FIC 18. Audit log UI 19. API pubbliche per-tenant 20. WhatsApp/Telegram notifiche

### Convenzioni di processo (invariate)

- STOP-gate: 0 → 1 → 2 → 3. Merge SEMPRE separato dopo `gh pr checks --watch` + via esplicito.
- `git add` selettivo (mai `-A`); commitlint header ≤ 100 inglese.
- Split commit per rischio (BE → STOP 2 → FE → STOP 2 → push).
- Verifica runtime manuale (ruolo non-superuser) prima di ogni commit FE — regola permanente.
- Empirical-first: mai asserire scope da deduzione.
- `docs/studiodesk/` + `betadesk` READ-ONLY.

### Note operative host (aggiornate)

- Repo: `/home/deploy/projects/gestionale`
- Stack live: `docker-compose.dev.yml` + `docker-compose.prod.yml` (override Caddy + servizi app)
- Comando deploy: `docker compose -f docker-compose.dev.yml -f docker-compose.prod.yml up -d --build accountant-api accountant-web`
- DB name: `gestionale`; seed: `db:seed`; container: `gestionale_postgres` / `gestionale_caddy`
- Caddy routing: `/api/*` → `accountant-api:3002`, resto → `accountant-web:3003`
- ⚠️ `/api/v1/health` (non `/api/health`) è l'endpoint reale — il global prefix è `api/v1`
- `DATABASE_URL_DOCKER` / `DIRECT_URL_DOCKER` nel `.env` gitignored (host=`postgres`)
- `PLATFORM_TENANT_ID=01900000-0000-7000-8000-000000000001` nel `.env`
- Nuova chiave Groq: da inserire in `.env` quando si implementano feature AI
- SSH tunnel: `LocalForward 3003 localhost:3003` + `LocalForward 3002 localhost:3002`

---

## PARTE B — Snapshot tecnico

### Git

- **Main @ `6f7e0d2`** (+1 commit `docs(handoff)` in arrivo via PR). Cronologia recente:
  - `6f7e0d2` feat(platform): superadmin minimale — lifecycle tenant, PlatformGuard (#112)
  - `09e7998` feat(auth): invito cliente via token — onboarding portale (#111)
  - `e67c5f9` feat(auth): reset password — forgot/reset flow, email token (#110)
  - `8a06f88` feat(infra): deploy applicativo — Dockerfile api/web, compose prod, Caddy (#109)
  - `b43aeb1` feat(accountant): circolari report letture lato studio — read_report (#107)
- **Working tree PULITO**, nessun branch pendente.
- ADR in repo fino a **0048**.

### Schema dominio accountant — aggiornato

`Azienda` · `Referente` · `Preventivo` + `PreventivoVoce` · `Scadenza` + `ScadenzaCategoria` · `Comunicazione` + `ComMessaggio` + `ComAllegato` · `DocumentoTipo` + `Documento` · `Circolare` + `CircolareDestinatario` + `CircolareLettura` · `User` (con `UserTipo`, `ClienteRuolo`, `aziendaId`) · **`PasswordReset`** · **`ClienteInvito`**. CHECK constraint `chk_cliente_azienda_id`.

### Permessi (50 totali)

Namespace studio: `aziende.*` · `referenti.*` · `preventivi.*` · `scadenze.*` · `comunicazioni.*` · `documenti.*` · `circolari.*` · `sistema.*` · **`clienti.invitare`**.
Namespace portale: `portale.documenti.visualizza` · `portale.comunicazioni.{visualizza,rispondi}` · `portale.circolari.visualizza`.
Template "Cliente" → 4 permessi portale.

### Stack & ambiente

- NestJS 11, Next.js 15 (standalone), Prisma 6, PostgreSQL 16 (RLS), Redis, Vitest, Testcontainers, Playwright, Tailwind, shadcn/ui.
- Server Hetzner `gestionale-test`. Docker Compose (`dev.yml` + `prod.yml`). Caddy custom (wildcard cert `*.studiodesk.cloud`, DNS-01 Cloudflare).
- **App containerizzate e live**: `gestionale-accountant-api-1` + `gestionale-accountant-web-1`.
- Tenant demo: `studio-demo` + `studio-acme` + **`oneplatform`** (superadmin piattaforma).
- Betadesk: `/home/deploy/projects/betadesk` — READ-ONLY, riferimento legacy.

### Verifica finale richiesta a Code (chiusura sessione)

Working tree pulito, main @ `6f7e0d2` allineato origin, nessun branch pendente, PROGRESS.md aggiornato con entry [2026-06-25] per sessione (deploy #109 + Onda 1 #110-112).
