# PROGRESS.md — Stato del progetto Gestionale

> File vivente che documenta cosa è già fatto, cosa è in corso, cosa è ancora da fare.
> **Da leggere PRIMA del `PROJECT_BRIEF.md` per capire lo stato corrente.**
> Aggiornato dopo ogni macro-task completato.

**Ultimo aggiornamento:** 13 maggio 2026 (mattina-pomeriggio-sera-notte)
**Fase corrente:** Monorepo + stack dev + CI/CD + Husky + Prisma + typecheck Turbo + NestJS scaffold + D2a Auth + D2-vitest + D2b PIN POS + D3a RLS framework + D3b RLS activation + D4 Tenant bootstrap + E1 Next.js scaffold + E2 Login form UI + **B1 Auth E2E hardening (rate limit + lockout)** completi. **Difesa brute-force attiva**: throttler Redis (5/min login, 3/h tenant-create userId-tracked) + account lockout (10 fail/15min → block 15min) + Retry-After 900 fissi (anti-enumeration) + audit `auth.account_locked`. **10 endpoint operativi** API a `:3000` + frontend `:3001`, **25/25 test Vitest verdi** (+17 vs E2) + RLS attivo.

> ✅ **B1 chiuso**: rate limiting + lockout via Redis sliding window operativi. Smoke E2E 8/8 verdi (rate-limit auth-strict + tenant-create custom tracker + lockout login + lockout login-pin + reset doppio + isolation). Tech debt 14 nuove (TD-A → TD-N) tracciate in ADR-0013. Prossimo macro-task candidato: **B2 (email theft notification + rate-limit login-pin triplet + E2E full Nest bootstrap)** o da concordare. Vedi [ADR-0013](docs/architecture/ADR-0013-auth-e2e-hardening-b1.md) (rate-limit + lockout).

---

## 📌 Contesto rapido

Progetto: piattaforma SaaS gestionale modulare per ristorazione. Vedi `PROJECT_BRIEF.md` per visione completa, architettura, stack, moduli, [BACKLOG].

Owner umano: Nicolò (italiano, lavora da Mac, lavora in mobilità con IP dinamico).

Workflow operativo: 
- **Claude strategico** in chat web Anthropic → consulenza architetturale, validazione decisioni, preparazione prompt.
- **Claude Code** in VS Code Remote-SSH → esecuzione tecnica sul server: file ops, comandi, scaffold.
- **Nicolò** → orchestratore, esegue operazioni manuali (UI Hetzner, GitHub web, password sudo fuori NOPASSWD).

Lingua di lavoro: italiano.

---

## ✅ Completato

### Infrastruttura server

**Hardware:**
- Hetzner Cloud CPX32 (Regular Performance AMD, 4 vCPU, 8 GB RAM, 160 GB SSD NVMe)
- Location: Nürnberg/Falkenstein
- Ubuntu 22.04 LTS, kernel 5.15.0-174-generic
- Backup automatici Hetzner attivi (+20%)
- Hostname: `gestionale-test`

> **Nota storica:** primo tentativo CPX31 risultò deprecato (fine 2025). Hetzner ora usa nomenclatura CX Gen3 / CPX Gen2 / CCX. Scelto CPX32 (Regular Performance AMD Genoa).

**Sistema base:**
- [x] `apt update && upgrade -y` eseguito
- [x] Timezone `Europe/Rome` (CEST/CET in `date`)
- [x] Tooling base installato: `htop`, `ncdu`, `jq`, `git`, `curl`, `wget`, `unzip`
- [x] **Node.js toolchain** (installato il 2026-05-11 notte come prerequisito CI/CD):
  - nvm `v0.40.4` user-space in `~/.nvm` (script `install.sh` ispezionato pre-esecuzione, SHA256 `4b7412c4…`, URL esterni solo `nvm-sh/nvm`)
  - Node `20.18.1` (allineato a `.nvmrc`)
  - corepack upgraded `0.29.4` → `0.34.7` (fix bug noto verifica firme registry npm in corepack `< 0.31`)
  - pnpm `9.15.0` risolto da `packageManager` field via corepack
  - Aggiunte 3 righe standard a `~/.bashrc` (NVM_DIR + sourcing + bash_completion)

**Utenti & SSH:**
- [x] Utente `deploy` creato, password forte salvata da Nicolò
- [x] `deploy` aggiunto al gruppo `sudo`
- [x] `deploy` aggiunto al gruppo `docker` (richiede nuova sessione SSH per attivazione)
- [x] SSH key `~/.ssh/id_ed25519_gestionale` su Mac di Nicolò
- [x] Chiave pubblica caricata su Hetzner durante creazione server
- [x] `/home/deploy/.ssh/authorized_keys` con chiave (permessi 700/600 verificati)

**Hardening SSH (`/etc/ssh/sshd_config.d/99-hardening.conf`):**
- [x] `PermitRootLogin no` (root login completamente disabilitato)
- [x] `PasswordAuthentication no` (solo SSH key)
- [x] `PubkeyAuthentication yes`
- [x] `ChallengeResponseAuthentication no`
- [x] `MaxAuthTries 3`
- [x] `LoginGraceTime 30`
- [x] Test verificati: deploy entra senza password, root rifiutato, password rifiutate

**Firewall UFW:**
- [x] Stato attivo
- [x] Regole: 22/tcp (SSH), 80/tcp (HTTP), 443/tcp (HTTPS) — sia IPv4 sia IPv6
- [x] Default: `deny incoming`, `allow outgoing`

**Fail2ban (`/etc/fail2ban/jail.local`):**
- [x] Jail `sshd` enabled, mode aggressive
- [x] Soglie tolleranti per IP dinamico utente: `bantime=600`, `findtime=300`, `maxretry=10`
- [x] Backend systemd
- [x] Funzionante: IP attaccanti bot vengono bannati automaticamente

**Memoria:**
- [x] Swap file `/swapfile` da 4 GB persistente in `/etc/fstab`
- [x] `/etc/sysctl.d/99-swappiness.conf`: `vm.swappiness=10`, `vm.vfs_cache_pressure=50`

### Docker

- [x] Docker Engine 29.4.3 installato da repo ufficiale Docker (chiave GPG in `/etc/apt/keyrings/docker.asc`, repo in `/etc/apt/sources.list.d/docker.list`)
- [x] Docker Compose v2 plugin v5.1.3
- [x] `/etc/docker/daemon.json` configurato:
  - `log-driver: json-file`
  - `log-opts: max-size 10m, max-file 3`
  - `live-restore: true`
- [x] Test `docker run hello-world` ok (eseguito come `deploy` senza sudo via gruppo `docker`)

### Sudo configuration

- [x] `/etc/sudoers.d/deploy-setup` creato con NOPASSWD limitato a 4 binari:
  ```
  deploy ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/sbin/sysctl, /usr/bin/systemctl
  ```
- [ ] **TODO**: rimuovere `/etc/sudoers.d/deploy-setup` al completamento dello Step 4 (primo `docker compose up` funzionante)

### Mac di Nicolò

- [x] SSH key `~/.ssh/id_ed25519_gestionale` generata
- [x] `~/.ssh/config` con alias `gestionale-test` (User `deploy`, IdentityFile chiave dedicata, ServerAliveInterval 60)
- [x] Test `ssh gestionale-test` funziona da Terminale Mac e da VS Code Remote

### VS Code Remote-SSH

- [x] Estensione Remote-SSH installata
- [x] Connesso a `gestionale-test` come `deploy`
- [x] Workspace: `/home/deploy/projects/gestionale/`
- [x] Claude Code estensione attiva nella finestra remote

**Nota dolente risolta:** dopo aver fatto `usermod -aG docker deploy`, VS Code Remote-SSH non vedeva il nuovo gruppo perché il VS Code Server rimaneva con sessione cached. Risolto con:
```bash
# Da Terminale Mac (NON da dentro VS Code)
ssh gestionale-test
pkill -u deploy -f vscode-server
# Poi Quit + riaprire VS Code, reconnect
```

### File già sul server

- [x] `~/projects/gestionale/PROJECT_BRIEF.md` (66KB, brief completo)
- [x] `~/projects/gestionale/STARTER_PROMPT.md` (11KB, protocollo operativo)
- [x] `~/projects/gestionale/PROGRESS.md` (questo file)

### Monorepo Git + struttura cartelle + stack dev (2026-05-11 sera)

**Repository:**
- [x] `git init` in `~/projects/gestionale/`, branch `main`, identità locale (`MontaNic` / `y2fvvhfc25@privaterelay.appleid.com` come email per i commit)
- [x] Repository GitHub privato `MontaNic/gestionale-piattaforma` creato
- [x] **Deploy Key** dedicata caricata su GitHub (write access) — chiave server-side `~/.ssh/id_ed25519_github`, blocco `Host github.com` in `~/.ssh/config`, **scope ristretto al solo repo** (no chiave account-wide)
- [x] GitHub host key (`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU` ed25519) verificata contro fingerprint pubblico ufficiale e pinnata in `~/.ssh/known_hosts`
- [x] `git push -u origin main` riuscito — primo commit `d6cda3a` su [github.com/MontaNic/gestionale-piattaforma](https://github.com/MontaNic/gestionale-piattaforma)

**Struttura monorepo (sez. A4 brief):**
- [x] Cartelle create: `apps/`, `packages/`, `plugins/`, `infra/{docker,compose,caddy}/`, `docs/{architecture,decisions}/`, `scripts/` (placeholder `.gitkeep` dove vuote)
- [x] `package.json` root: `private: true`, `type: "module"`, `packageManager: pnpm@9.15.0`, `engines.node: ">=20.18.0 <21"`, devDeps minime (typescript, turbo, prettier, eslint, typescript-eslint, @eslint/js, @types/node), scripts placeholder `dev/build/lint/typecheck/test/format` via `turbo run …`
- [x] `pnpm-workspace.yaml` con `apps/*`, `packages/*`, `plugins/*`
- [x] `turbo.json` v2 minimale (tasks: build/dev/lint/typecheck/test)
- [x] `tsconfig.base.json` TS strict completo (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`) + path aliases `@gestionale/* → packages/*/src` e `@apps/* → apps/*/src`
- [x] `eslint.config.js` (ESLint 9 **flat config**, no legacy `.eslintrc.cjs`) con `typescript-eslint` recommended
- [x] `.prettierrc.json` (single quote, trailing comma all, printWidth 100, LF) + `.prettierignore`
- [x] `.editorconfig` (UTF-8, LF, 2 spaces, final newline)
- [x] `.nvmrc` → `20.18.1`
- [x] `.gitignore` (Node, Next, Turbo, env, IDE, OS, log, coverage) e `.gitattributes` (LF normalizzato)
- [x] `README.md` con stack table, struttura cartelle, comandi sviluppo, link ai documenti di progetto

**Architecture Decision Records:**
- [x] `docs/architecture/ADR-0001-caddy-as-container.md` (formalizza la scelta presa il 2026-05-11 mattina: Caddy come container in compose, non come servizio host)

**Stack dev funzionante:**
- [x] `docker-compose.dev.yml` (in root per ora — migrazione futura a `infra/compose/` quando arriveranno staging/prod):
  - `postgres:16-alpine` (verificato 16.13) — volume `postgres_data`, healthcheck `pg_isready`, no porte esposte all'host (accesso via network interna)
  - `redis:7-alpine` — volume `redis_data`, AOF `appendfsync everysec`, healthcheck `redis-cli ping`, no password in dev (TODO documentato per staging/prod)
  - `caddy:2-alpine` — bind mount `./Caddyfile`, volumi `caddy_data`/`caddy_config`, porta `8080:80` (no 443/Let's Encrypt finché non avremo dominio)
  - Network `gestionale_network` (bridge)
- [x] `Caddyfile` placeholder: `:80 { respond "Gestionale - it works!" 200 }`
- [x] `.env.example` committato (template documentato), `.env` reale con `POSTGRES_PASSWORD` 256-bit (`openssl rand -base64 32`), permessi 600, escluso da Git
- [x] Smoke test 3/3 verdi: `psql SELECT version();` → PostgreSQL 16.13, `redis-cli ping` → PONG, `curl localhost:8080/` → 200 + "Gestionale - it works!"
- [x] Container lasciati **up** per task successivi (volumi persistenti)

### Decisioni prese in questa sessione (da aggiungere al log decisionale)

- **2026-05-11**: **ESLint 9 flat config** (`eslint.config.js`), non legacy `.eslintrc.cjs` → evita migrazione obbligatoria entro 6-12 mesi
- **2026-05-11**: `pnpm@9.15.0` come `packageManager` (corepack-driven) + Node `20.18.1` in `.nvmrc` — versioni pinned esatte
- **2026-05-11**: TS strict baseline + `noUncheckedIndexedAccess: true` (più severo del minimo "strict")
- **2026-05-11**: Path aliases TS scelti — `@gestionale/*` per packages condivisi, `@apps/*` per workspace applicativi
- **2026-05-11**: `docker-compose.dev.yml` + `.env` + `Caddyfile` in **root**, non in `infra/compose/` — semplicità per dev iniziale. Quando arriveranno staging/prod, migrazione documentata
- **2026-05-11**: SSH **Deploy Key** del solo repo (no account-wide key) per principio least-privilege; chiave dedicata `~/.ssh/id_ed25519_github` senza passphrase (giustificata da uso server-only)
- **2026-05-11**: GitHub host key pinnata manualmente in `known_hosts` dopo verifica fingerprint contro pubblicazione ufficiale (no `StrictHostKeyChecking=accept-new` opaco)
- **2026-05-11**: ADR-0001 formalizza "Caddy come container"; ADR successivo per strategia ACME quando avremo dominio (vedi "📋 Da fare prossimamente")

### Decisioni prese durante setup (ADR informali, da formalizzare)

- **2026-05-11**: Hetzner CPX32 (non CPX31 deprecato)
- **2026-05-11**: Workflow Scenario B (VS Code Remote-SSH + Claude Code)
- **2026-05-11**: Niente dominio per ora, solo IP del server. SSL/dominio aggiunti in futuro quando serviranno (OAuth, PWA, ecc.)
- **2026-05-11**: Caddy come container in docker-compose, NON installato sull'host (coerente con A3 "tutto in docker")
- **2026-05-11**: Fail2ban con soglie tolleranti (vs. defaults aggressivi) per IP dinamico utente
- **2026-05-11**: Sudo NOPASSWD limitato a 4 binari (apt/apt-get/sysctl/systemctl), non whitelist ampia che Claude Code aveva proposto. Esclusi specificamente: docker, tee, install, chmod, usermod (richiedono password)
- **2026-05-11**: PROGRESS.md inizializzato dopo prima sessione di setup, sarà aggiornato dopo ogni macro-task

### Setup CI/CD GitHub Actions (2026-05-11 notte)

**Workflow CI attivo:**
- [x] `.github/workflows/ci.yml` — trigger su `pull_request → main` e `push → main`, job singolo `Lint · Typecheck · Format` su `ubuntu-latest`, timeout 10min, blocco `concurrency` con `cancel-in-progress` per evitare run sovrapposte
- [x] Setup pnpm via `pnpm/action-setup@v4` (versione letta da `packageManager` del `package.json`) + `actions/setup-node@v4` con `node-version-file: .nvmrc` e `cache: pnpm`
- [x] Step: `pnpm install --frozen-lockfile` → `pnpm format:check` → `pnpm lint` → `pnpm typecheck`
- [x] Primo run CI su `push` su `main` (commit `92c0724`) verde in **33s**
- [x] Primo ciclo PR completato (`feature/ci-test` → PR `#1` → CI verde su `pull_request` in **18s** grazie alla cache pnpm popolata → squash merge → branch eliminato → main resta lineare, commit risultante `b139a7f`)

**Script root sincronizzati al regime CI:**
- [x] `package.json` aggiornato: `lint → eslint .`, `typecheck → tsc --noEmit`, `test → placeholder echo+exit 0`, `format:check → prettier --check .`, nuovo `format:write → prettier --write .`. `dev`/`build` mantengono `turbo run` per quando esisteranno workspace
- [x] `tsconfig.json` root (nuovo): forma canonica solution-style `{files:[], references:[]}` che estende `tsconfig.base.json` — pronta ad accogliere project references quando arriveranno workspace
- [x] `tsconfig.base.json` corretto: rimossi path aliases illegali `@gestionale/*/*` e `@apps/*/*` (violavano TS5061 "max 1 `*` per pattern"). Forme rimaste: `@gestionale/* → packages/*/src/index.ts` e `@apps/* → apps/*/src/index.ts` (barrel pattern standard pnpm)
- [x] `pnpm-lock.yaml` generato + committato (necessario per `--frozen-lockfile` in CI)

**Convenzioni di processo:**
- [x] `.github/PULL_REQUEST_TEMPLATE.md` versione minima (descrizione, tipo Conventional Commit, 3 check base). Versione completa C12 (test, docs, migrazione DB, breaking, API pubbliche, AI tokens, feature flag) rimandata a quando arriverà codice F1
- [x] Badge CI nel README della homepage repo (`actions/workflows/ci.yml/badge.svg`)
- [x] README "Comandi di sviluppo" allineato agli script attuali

**ADR scritti:**
- [x] **ADR-0002** branching strategy: GitHub Flow semplificato (solo `main` + `feature/*` + `fix/*`) + **Squash and merge** obbligatorio da UI GitHub. Divergenza consapevole dal §C12 del brief, motivata da single-dev e nessuna release pubblica. Reintroduzione di `develop` rivalutata quando il progetto diventerà multi-dev o avrà ambiente staging persistente.
- [x] **ADR-0003** Prettier exclusions: i 3 documenti narrativi `PROJECT_BRIEF.md`, `PROGRESS.md`, `STARTER_PROMPT.md` esclusi via `.prettierignore` con commento di rimando all'ADR. Razionale: documenti scritti a mano con tabelle wide e struttura intenzionale, fuori dal regime di formatting automatico.

**Standing rule introdotta:**
- [x] Da oggi: niente più push diretti su `main`. Ogni macro-task → `feature/<topic>` → PR → CI verde → Squash and merge dalla UI da Nicolò. Eccezione one-shot: questo stesso aggiornamento di PROGRESS è andato direttamente su `main` (post-task docs update) per chiudere pulitamente il macro-task; da domani regola applicata senza eccezioni.

### Decisioni prese durante setup CI/CD (2026-05-11 notte)

- **2026-05-11**: Branching strategy = GitHub Flow semplificato + Squash and merge (ADR-0002)
- **2026-05-11**: 3 .md narrativi esclusi da Prettier (ADR-0003)
- **2026-05-11**: Cache pnpm via `actions/setup-node@v4` con `cache: pnpm` (più conciso e ufficiale rispetto a `actions/cache` manuale)
- **2026-05-11**: Script root `lint`/`typecheck`/`test` come comandi diretti finché i workspace sono vuoti — torneranno a `turbo run` quando esisteranno `apps/`/`packages/` reali con i propri task
- **2026-05-11**: nvm v0.40.4 user-space scelto rispetto a NodeSource apt-repo (futuro multi-versione, no impatto sistema, `.nvmrc`-aware)
- **2026-05-11**: Husky / lint-staged / commitlint **rimandati** a macro-task dedicato successivo (priorità più alta: validare CI prima di pre-commit hooks)
- **2026-05-11**: PR template completo C12 **rimandato** a quando arriverà codice F1 — la checklist (test, docs, migrazione DB, breaking, API pubbliche, AI tokens, feature flag) non avrebbe oggetti su cui mordere

### Setup Husky + lint-staged + commitlint (2026-05-12)

**3 git hook locali attivi (`.husky/`):**
- [x] `pre-commit` → `pnpm exec lint-staged` (auto-fix Prettier + ESLint sui soli file in stage)
- [x] `commit-msg` → `pnpm exec commitlint --edit "$1"` (valida Conventional Commits, 11 tipi whitelisted, `subject-case` disabled per IT, `header-max-length` 100)
- [x] `pre-push` → shell script anti-main (blocca `git push origin main` con messaggio guida + link ADR-0004; bypass intenzionale via `--no-verify`)
- [x] Hardening PATH: `pre-commit` e `commit-msg` caricano `nvm` autonomamente (`export NVM_DIR=...; [ -s $NVM_DIR/nvm.sh ] && . $NVM_DIR/nvm.sh`) per funzionare anche in ambienti non-interactive (GUI git client, IDE source control, runner CI minimali). Approccio defensivo: se nvm assente, fall-through al PATH già caricato.

**Versioni installate (devDeps root):**
- `husky@9.1.7`
- `lint-staged@17.0.4`
- `@commitlint/cli@21.0.0`
- `@commitlint/config-conventional@21.0.0`

**Config files:**
- [x] `.lintstagedrc.json` — glob-based: ESLint + Prettier su `*.{ts,tsx,js,jsx}`; Prettier su `*.{json,md,yml,yaml,css}` (rispetta `.prettierignore`)
- [x] `commitlint.config.cjs` — estensione `.cjs` esplicita perché `package.json` ha `"type": "module"` (un `.js` verrebbe caricato come ESM, incompatibile con `module.exports`)
- [x] `package.json` `prepare: "husky"` — install automatico hook su clone fresco
- [x] `eslint.config.js` blocco override per `**/*.cjs` (`sourceType: 'commonjs'` + globals CommonJS) — fix CI red su PR #2 risolto da PR #3 `38861e2`

**Test 6/6 passati:**
1. pre-commit auto-fix Prettier su JSON malformato
2. pre-commit BLOCK su unused-vars TS non auto-fixable
3. commit-msg BLOCK su messaggio non-Conventional
4. commit-msg PASS su Conventional valido
5. pre-push BLOCK su `git push origin main`
6. pre-push PASS su `git push origin feature/*`

**Convenzioni di processo:**
- [x] README sezione "Sviluppo locale" + nuova sotto-sezione "Git hook attivi (Husky)" con descrizione dei 3 hook + bypass `--no-verify`
- [x] README sezione "Convenzioni" aggiornata con doppio rimando ad ADR-0002 (branching) e ADR-0004 (hook)
- [x] **ADR-0004** local git hooks: razionale completo (compensa mancata enforcement server-side GitHub Free privato), 5 alternative considerate, sezione "Hardening PATH per ambienti non-interactive", reversibilità documentata
- [x] PR #2 (`feat: husky + lint-staged + commitlint`) → squash merge → `1178d12` su `main`
- [x] PR #3 (`fix: ESLint flat config for .cjs`) → squash merge → `38861e2` su `main`
- [x] Branch protection / Rulesets su GitHub: **creati ma non enforced** (limite GitHub Free privato, documentato in ADR-0004). Mitigazione: pre-push hook locale + disciplina ferrea "main never force-pushed"

### Decisioni prese durante setup Husky (2026-05-12)

- **2026-05-12**: Husky 9 (non v8) — flat config style, `core.hooksPath = .husky/_/` proxy
- **2026-05-12**: `commitlint.config.cjs` (non `.js`) per compatibilità con `"type": "module"` del root `package.json`
- **2026-05-12**: Hook hardening con source nvm condizionale → self-contained, non invasivi
- **2026-05-12**: `.eslintrc-style ignore` rifiutato in favore di flat config block per `.cjs` (continua a lintare invece di escludere — "fix the root, not the symptom")
- **2026-05-12**: Branch protection lato server **non comprata** (GitHub Free privato non enforce, upgrade Team $4/mese non giustificato per single-dev) → mitigazione client-side via pre-push hook
- **2026-05-12**: Disciplina "main never force-pushed" mantenuta anche dopo l'incident del commit empty `2151e4f` (vedi Incidents log) — precedente di disciplina > pulizia estetica

### Setup Prisma data layer multi-tenancy base (2026-05-12)

**Schema F1 (11 entità in `packages/db/prisma/schema.prisma`):**

- [x] **Tenant root**: `tenants` (id, name, slug unique, is_active, timestamps, soft-delete)
- [x] **Sede operativa**: `sedi` (tenant_id, name, address, city, postal_code, country IT, timezone Europe/Rome, currency EUR, soft-delete, FK tenant CASCADE)
- [x] **Identity tenant-scoped**: `users` (tenantId+email UNIQUE, password_hash argon2, pin_hash F1 POS login, failed_login_attempts, soft-delete; `[PRE F2]` totp_secret/valid_until/badge_nfc_id)
- [x] **Permission catalog globale**: `permissions` (code unique, description, category; no tenant_id, no timestamps — immutabile, seedable)
- [x] **System role templates globali**: `system_role_templates` (name unique, isDefault flag) + `system_role_template_permissions` (M:N PK composta) — pattern bootstrap nuovi tenant via clone
- [x] **Tenant-scoped roles**: `roles` (tenantId+name UNIQUE, isSystem flag, soft-delete) + `role_permissions` (M:N PK composta)
- [x] **User↔Role per sede**: `user_roles` (sede_id NULLABLE per ruoli tenant-wide, assigned_at/by) + **2 UNIQUE INDEX PARZIALI** per gestire NULL semantics PostgreSQL (`*_per_sede_unique` WHERE sede_id IS NOT NULL + `*_tenant_wide_unique` WHERE sede_id IS NULL)
- [x] **Session per device**: `sessions` (user_id CASCADE, sede_id SET NULL, device_type enum nativo `device_type`, refresh_token_hash, expires_at NOT NULL, is_active)
- [x] **Audit log immutabile**: `audit_logs` (tenant_id CASCADE, sede_id/user_id SET NULL, action/entity_type/entity_id, before_value/after_value JSONB, timestamp default NOW(); no updated_at/deleted_at; indice DESC su (tenant_id, timestamp))

**Convenzioni rispettate (§C1 brief):**

- [x] UUID v7 generato app-side via libreria `uuidv7@1.2.1` (no `@default` Prisma → id obbligatorio in ogni create, errore esplicito)
- [x] snake_case in DB / camelCase in TS via `@map` / `@@map`
- [x] FK con `onDelete` esplicito (Cascade/Restrict/SetNull come da matrice — vedi ADR-0005)
- [x] Indici su `tenant_id` ovunque, `(tenant_id, sede_id)` su operative, `refresh_token_hash` su sessions, `(tenant_id, timestamp DESC)` su audit_logs, `(entity_type, entity_id)` su audit_logs
- [x] Timestamps `created_at` / `updated_at` (auto via Prisma `@default(now())` / `@updatedAt`) + `deleted_at?` su entità con soft-delete

**Migration applicate (2 file, ~360 righe SQL):**

- [x] `20260511201706_init_multitenancy_base` — 11 CREATE TABLE + 1 CREATE TYPE (enum device_type) + 16 indici + 15 FK + 2 UNIQUE INDEX PARZIALI per user_roles
- [x] `20260511201927_enable_rls` — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ... USING (true)` su 7 tabelle target. TODO inline F1 auth con 3 pattern di policy reale (tenant_id diretto, EXISTS join, tenants con bypass Super Admin)

**Setup ambiente:**

- [x] Postgres esposto `127.0.0.1:5432:5432` (localhost-only, binding verificato no 0.0.0.0)
- [x] `DATABASE_URL` in root `.env` + esempio in `.env.example`
- [x] Script Prisma in `packages/db` wrappati da `dotenv-cli` per leggere root `.env`
- [x] Prisma `6.19.3` + `@prisma/client` `6.19.3` + `uuidv7` `1.2.1` + devDeps `tsx`, `dotenv-cli`, `@types/node`
- [x] `packages/db/src/index.ts` stub (re-export `PrismaClient`, `Prisma`); soft-delete extension + uuidv7 helper rimandati a macro-task successivo

**Convenzioni di processo:**

- [x] **ADR-0005** data layer: 4 decisioni (location packages/db, UUID v7 app-side, RLS placeholder, soft-delete extension), 3 pattern policy RLS reale identificati, sezione "RBAC e NULL semantics" su user_roles, alternative considerate tabellate, reversibility documentata

### Decisioni prese durante setup Prisma (2026-05-12)

- **2026-05-12**: Prisma in `packages/db` (divergenza consapevole da §A4 brief, ADR-0005). Riusabile da api/web/worker/script.
- **2026-05-12**: Prisma 6.19.3 (non 7) perché Prisma 7 richiede Node 20.19+; abbiamo 20.18.1 in `.nvmrc`. Upgrade a 7 quando si bumperà Node, migrazione meccanica.
- **2026-05-12**: UUID v7 app-side via `uuidv7` npm. No `pg_uuidv7` extension (overhead operativo), no UUID v4 (no sortability).
- **2026-05-12**: ID `String @id` senza default → omettere id in create() è errore esplicito. Helper wrapper arriverà in macro-task successivo.
- **2026-05-12**: RLS attivato subito con policy `USING (true)` placeholder. Ragione: dimenticarla dopo è anti-pattern; abilitarla su DB con dati e' costoso, ora è gratis.
- **2026-05-12**: Schema separato in 2 migration (init + enable_rls) per facilitare rollback chirurgico dev.
- **2026-05-12**: System role templates come tabella separata (opzione c rispetto a tenant "system" sentinel o tenant_id nullable). Pulizia semantica, bootstrap pattern chiaro.
- **2026-05-12**: 2 UNIQUE INDEX parziali su `user_roles` via SQL raw in migration init (Prisma `@@unique` non esprime UNIQUE parziali). Commento esplicativo 18 righe in-file.
- **2026-05-12**: `role_permissions` skip RLS — isolamento indiretto via FK→roles, defense-in-depth da valutare quando si scriveranno policy reali.
- **2026-05-12**: Soft-delete via Prisma extension client-side (non middleware deprecato). Implementazione rimandata a macro-task successivo.
- **2026-05-12**: `DATABASE_URL` nel root `.env` + `dotenv-cli` wrapper. No secondo `.env` in packages/db.
- **2026-05-12**: Postgres dev esposto su `127.0.0.1:5432` (no 0.0.0.0) — UFW non serve modifica, binding localhost basta.

### Completamento Prisma data layer (Macro-task B, 2026-05-12)

Chiusura della fase Prisma con seed catalog, soft-delete extension e helper esportati. Macro-task A formalmente chiuso in questa stessa PR.

**Migration intermedia:**

- [x] `20260511204441_add_permission_is_pre_f2` — aggiunge `permissions.is_pre_f2 BOOLEAN NOT NULL DEFAULT false` per supportare il flag F2 nel catalog seedato

**Helper + factory + singleton (`packages/db/src/index.ts`):**

- [x] `id()` → `string`: wrapper su `uuidv7()` per generare UUID v7 fresh (obbligatorio in ogni `create()` per via di `@id` senza default Prisma)
- [x] `uuidv7` re-export raw
- [x] `createPrismaClient()` factory: nuova istanza extended con `softDeleteExtension`. Per NestJS DI / test isolati.
- [x] `prisma` singleton eager: istanza al primo import del modulo; connessione TCP al DB resta lazy (Prisma 6). Per script seed/smoke/utility.
- [x] Type `ExtendedPrismaClient` esportato

**Soft-delete extension (`packages/db/src/soft-delete.ts`):**

- [x] **Auto-detect**: `modelsWithDeletedAt` set built al boot da `Prisma.dmmf.datamodel.models[].fields[].name === 'deletedAt'`. Niente lista hardcoded.
- [x] **Query intercept** (`findUnique`, `findFirst`, `findMany`, `count`, `aggregate`, `groupBy`): inject `where.deletedAt = null` se model match E `where` non esplicita `deletedAt`. Helper `withSoftDeleteFilter()` con cast `as any` interno (runtime-safe via guard).
- [x] **Escape esplicito**: `'deletedAt' in where` → no injection. Permette query "cestino" (`where: { deletedAt: { not: null } }`) e admin history.
- [x] **Delete intercept** (`delete`, `deleteMany`): trasforma in `update`/`updateMany` con `data: { deletedAt: new Date() }`. Warning in-file: `deleteMany()` senza `where` = soft-delete dell'intero modello (intenzionale).
- [x] **`forceDelete(where: { id })`** model extension: bypass via `$executeRawUnsafe('DELETE FROM "<table>" WHERE id = $1', id)`. Lookup tableName via `Prisma.dmmf.datamodel.models[].dbName`. ON DELETE CASCADE/SET NULL rispettati. Use case: GDPR right-to-erasure, cleanup admin.

**Seed (`packages/db/prisma/seed.ts`, idempotente):**

- [x] **32 permessi atomici namespaced** in 8 categorie: `sistema.*` (8), `anagrafica.*` (4), `menu.*` (5), `comande.*` (5), `cassa.*` (4), `report.*` (3), `magazzino.*` (2 con `isPreF2: true`), `ai.*` (1 con `isPreF2: true`)
- [x] **6 system role templates** con `isDefault: true` (auto-clonati a ogni nuovo tenant): Super Admin (32 perm), Admin sede (31), Direzione (24), Cassiere (10), Cameriere (4), Cucina/Bar (3)
- [x] **104 mappings** template ↔ permission via `system_role_template_permissions` (PK composta)
- [x] Upsert pattern su unique key (code/name) e PK composta — re-esecuzione safe (verificato: re-run produce 0 created / N updated/re-affirmed, count DB invariati)
- [x] Config `package.json#prisma.seed = "tsx prisma/seed.ts"` + script wrapper `db:seed` con `dotenv-cli`

**Smoke test (`packages/db/scripts/smoke-soft-delete.ts`):**

- [x] 5 scenari, 9 assertion, tutti verdi:
  1. Create + findUnique trova
  2. Delete → findUnique null, riga still in DB con escape esplicito
  3. findMany cestino include soft-deleted
  4. count default = 0, count con escape = 1
  5. forceDelete → riga sparita anche con escape
- [x] Autopulizia (scenario 5 forceDelete del tenant smoke-test)
- [x] Script wrapper `smoke:soft-delete` con `dotenv-cli`

**Fix tsconfig packages/db:**

- [x] Rimosso `rootDir: ./src` (irrilevante con `noEmit: true`), aggiunto include `scripts/**/*.ts`. Tutti i sorgenti TS del workspace ora sotto `pnpm --filter @gestionale/db typecheck`.
- [ ] **Issue parallelo da risolvere prima del scaffold NestJS**: root `pnpm typecheck` (tsconfig solution-style) non propaga ai workspace; CI non rileva errori TS. Vedi "📋 Da fare prossimamente → Qualità codice / processo".

### Decisioni prese durante Macro-task B (2026-05-12)

- **2026-05-12**: `forceDelete` via `$executeRawUnsafe` (opzione A) per bypass extension senza ricorsione. Firma `where: { id: string }` restrittiva ma sicura.
- **2026-05-12**: `prisma` singleton eager (no Proxy lazy). Costo memoria trascurabile, connessione DB resta lazy.
- **2026-05-12**: `deleteMany()` senza `where` = soft-delete totale by design. Documentato in-file.
- **2026-05-12**: Campo `isPreF2` (vs `isPrerelease`) coerente con commenti `[PRE F2]` sparsi nel codice. Migration intermedia per aggiungerlo al schema.
- **2026-05-12**: `isDefault: true` per tutti i 6 system_role_templates seedati — sono i ruoli base che ogni nuovo tenant eredita.
- **2026-05-12**: Smoke test pragmatico (tsx + assertion manuali) invece di Vitest setup ora. Framework test rimandato a sessione NestJS auth quando ci sarà primo unit test reale.
- **2026-05-12**: Pattern dotenv-cli esteso a tutti gli script che usano Prisma (`db:seed`, `smoke:*`), non solo `prisma:*` di prima.

### Strategia typecheck monorepo (Macro-task C, 2026-05-13)

Quick win di tooling che chiude il gap CI scoperto durante Macro-task B prima di affrontare lo scaffold NestJS.

**Modifiche:**

- [x] `package.json` root: `scripts.typecheck` da `"tsc --noEmit"` a `"turbo run typecheck"` — propaga ai workspace via Turbo
- [x] `turbo.json`: rimosso `dependsOn: ["^build"]` da task `typecheck` (no build step oggi; reintrodurremo con NestJS se servirà)
- [x] `packages/db/package.json`: invariato (script `typecheck: "tsc --noEmit"` già presente)
- [x] `.github/workflows/ci.yml`: invariato (step `pnpm typecheck` propaga automaticamente ora)

**Failure injection test** (validazione empirica):

| Scenario | Atteso | Misurato |
|---|---|---|
| Cache miss vuoto | `tsc` esegue, OK | ✅ 1.136s, hash `23e2d6404c6783a9` |
| Cache hit vuoto | `>>> FULL TURBO` | ✅ **54ms**, stesso hash |
| Errore TS injection | exit 2, TS2322 catturato | ✅ exit 2, `'number' is not assignable to type 'string'` |
| Cleanup | exit 0, hash ripristinato | ✅ 48ms, stesso hash di partenza (file byte-identico) |

**Gap chiuso e dimostrato.** Speedup re-run locale: **21×** (1.1s → 54ms).

**Convenzioni di processo:**

- [x] **ADR-0006** strategia typecheck monorepo: razionale (gap CI scoperto Macro-task B), implementation details, 4 alternative considerate (turbo chosen, pnpm -r rejected, Project References rimandato, lasciare gap rejected), reversibility documentata, sezione "Test di validazione" con failure injection matrix
- [x] PR #7 (`ci: fix typecheck propagation to workspace packages via Turbo`) — in corso di apertura/merge

### Decisioni prese durante Macro-task C (2026-05-13)

- **2026-05-13**: Approccio (a) `turbo run typecheck` scelto come orchestratore. Coerente con `dev`/`build` già su Turbo. Pattern scalabile (nuovi workspace TS auto-inclusi).
- **2026-05-13**: TS Project References (opzione c) **rimandato** finché non avremo 5+ workspace o build incrementale necessario. Setup non banale, beneficio reale solo a scala.
- **2026-05-13**: Cache Turbo in CI **non configurata** (oggi CI ~30s adeguato). Follow-up tracciato per quando diventerà bottleneck.
- **2026-05-13**: Rimosso `dependsOn: ["^build"]` da `turbo.json` task `typecheck` — coerenza dichiarazione vs realtà (no build step oggi). Reintroduciamo con il primo workspace che ha build.

### D1 NestJS scaffold + healthcheck (Macro-task D1, 2026-05-13)

Backend NestJS in `apps/api/`, consumer di `@gestionale/db`. Scaffold base con DbModule + HealthModule. Niente auth, niente business logic (rimandati a D2/D3/D4).

**Scaffold manuale (no `nest new`):**

- [x] `apps/api/package.json` — `@gestionale/api`, CJS (no `type: module`), deps NestJS 11 + workspace `@gestionale/db@workspace:*`
- [x] `apps/api/tsconfig.json` — estende `tsconfig.base.json`, override `module: commonjs` + `moduleResolution: node`, `experimentalDecorators` + `emitDecoratorMetadata`, `noEmit: true` (dev via ts-node-dev)
- [x] `apps/api/nest-cli.json` — per `nest build` futuro
- [x] `apps/api/src/main.ts` — bootstrap + `app.enableShutdownHooks()` per graceful SIGTERM
- [x] `apps/api/src/app.module.ts` + `app.controller.ts` (GET `/` → "Gestionale API")
- [x] `apps/api/src/db/{db.module.ts, db.service.ts}` — `@Global` + composition wrapper su `prisma` singleton + `OnModuleInit`/`OnModuleDestroy` lifecycle (`$connect`/`$disconnect` con log)
- [x] `apps/api/src/health/{health.module.ts, health.controller.ts, health.service.ts, health.dto.ts}` — GET `/health` con `$queryRaw\`SELECT 1\``, HTTP 200/503 semantico via `ServiceUnavailableException`

**Modifiche correlate (4 course corrections):**

- [x] **CC1**: dev runner = `ts-node-dev --respawn --transpile-only` (NOT tsx — non emette `emitDecoratorMetadata` necessario a NestJS DI). Valutato empiricamente swc (13 min, fallback): swc/nest -b swc presuppongono build→dist→run, incompatibile con consumo TS-source-live di workspace deps via symlink
- [x] **CC2**: `packages/db/package.json` rimosso `"type": "module"` per CJS interop con apps/api. Asimmetria CJS/ESM evitata, tech debt esplicito tracciato (vedi sezione sotto)
- [x] **CC3**: rimosso `.js` suffix da import interni di `packages/db/src/index.ts`, `prisma/seed.ts`, `scripts/smoke-soft-delete.ts` (conseguenza diretta di CC2: `.js` suffix non risolve in CJS)
- [x] **CC4**: `app.enableShutdownHooks()` in main.ts → SIGTERM/SIGINT propaga `OnModuleDestroy` ai provider, `$disconnect` graceful

**Convenzioni di processo:**

- [x] ESLint override scoped `apps/api/**/*.ts` accentrate nel root `eslint.config.js` (flat config 9 no config-discovery): `experimentalDecorators` + disable `no-extraneous-class`, `no-useless-constructor`, `consistent-type-imports` (necessari per pattern NestJS DI/Module)
- [x] `.env.example` aggiornato con `PORT` (commentato, default 3000)
- [x] Pattern `dotenv-cli` esteso a `dev` e `start:prod` di apps/api (coerente con packages/db)
- [x] **ADR-0007** scaffold + 4 course corrections + sezione "Tech Debt Accepted" esplicita + sezione "Empirical Evidence" con swc detour 13 min
- [x] PR #8 (`feat: NestJS API scaffold with healthcheck endpoint and DbModule`) — in corso

**Verifica runtime end-to-end:**

```
$ curl http://localhost:3000/      → 200 "Gestionale API"
$ curl http://localhost:3000/health → 200 {"status":"ok","db":"connected","timestamp":"..."}

Lifecycle log:
[NestFactory] Starting Nest application...
[DbService] Prisma connected to PostgreSQL  ← OnModuleInit OK
[NestApplication] Nest application successfully started
[Bootstrap] Gestionale API listening on http://localhost:3000

Quality gates: format + lint + typecheck (Turbo 2/2 workspace) ALL GREEN
Smoke regression packages/db: 9/9 verdi (no regression post-CC2/CC3)
```

### Decisioni prese durante D1 NestJS (2026-05-13)

- **2026-05-13**: NestJS 11 + manual scaffold (aderenza monorepo)
- **2026-05-13**: CJS apps/api + packages/db (CC2). Asimmetria CJS/ESM rifiutata
- **2026-05-13**: ts-node-dev per dev (swc detour empirico documentato in ADR-0007 "Empirical Evidence")
- **2026-05-13**: DbModule `@Global` + DbService **composition** (non inheritance). `OnModuleInit`/`OnModuleDestroy` per lifecycle Prisma
- **2026-05-13**: HTTP 200/503 semantico via `ServiceUnavailableException` su `/health`
- **2026-05-13**: `app.enableShutdownHooks()` attivo dal D1 (CC4)
- **2026-05-13**: ESLint override scoped per apps/api accentrate nel root config (no config-discovery in flat config 9)
- **2026-05-13**: `tsconfig.json` apps/api con `noEmit: true` — build futura via `tsconfig.build.json` dedicato

### D2a Auth module — email/password + JWT + refresh rotation (Macro-task D2a, 2026-05-13 notte)

Backend auth funzionante end-to-end. Scope ridotto rispetto al D2 monolitico per disciplina tempi (calibrazione 5h vs 3h sottostimato): D2-vitest e D2b in macro-task separati.

**Endpoint attivi (6, sotto `/api/v1/`):**

- [x] GET `/` (Public) — root, "Gestionale API"
- [x] GET `/health` (Public) — DB ping, 200/503 semantico
- [x] POST `/auth/login` (Public, header `X-Tenant-Slug` required) — email + password + tenant → JWT pair + session record
- [x] POST `/auth/refresh` (Public, tenantId dal JWT payload) — rotation: vecchia session `is_active: false`, nuova creata
- [x] POST `/auth/logout` (Protected) — session corrente disattivata, 204
- [x] GET `/me` (Protected) — user + roles + 32 permissions flat dal DB (no JWT inlining)

**Pattern auth (10 decisioni, ADR-0008):**

- [x] **Argon2id** per password hashing (vincitore PHC 2015, OWASP 2023+)
- [x] **JWT HS256** con `@nestjs/jwt` (secret 64-byte base64 da `openssl rand -base64 48`)
- [x] **Payload minimal**: `{sub, tenantId, sessionId, type, iat, exp}` — niente roles/permissions inline (revoca istantanea, no stale token)
- [x] **Refresh rotation BASE**: token rotato → vecchia session disattivata + nuova creata + new pair returned. Detection FULL (revoke all on reuse) → D2-vitest
- [x] **JwtAuthGuard globale** security-by-default + `@Public()` opt-out (root, /health, /auth/login, /auth/refresh)
- [x] **Tenant resolution via header `X-Tenant-Slug`** scoped a `/auth/login` only (TenantMiddleware). Post-auth tenantId dal JWT payload — anti-spoofing
- [x] **Audit log best-effort** in `audit_logs` su login.success / login.failure / logout (wrapped try/catch, audit fail non blocca auth)
- [x] **failed_login_attempts counter** incrementato su wrong password, reset su login success (anti-brute baseline F1)
- [x] **No info leak** su credenziali: stesso `E_AUTH_INVALID_CREDENTIALS` per email-non-esiste / password-errata / utente-disabilitato
- [x] **Sessioni stateful** in tabella `sessions`: device_id=user_agent slice, device_type='web' (D2b distinguera POS), refresh_token_hash argon2, expires_at NOT NULL, is_active per soft-revoke

**Smoke E2E 10/10 verdi** (eseguito 2026-05-13 00:20 UTC):

| # | Scenario | Esito |
|---|---|---|
| 1 | GET /health | ✅ 200 |
| 2 | POST /auth/login con tenant + admin | ✅ 200 + JWT pair |
| 3 | GET /me con access token | ✅ 200 + user + role + 32 permissions flat |
| 4 | POST /auth/refresh | ✅ 200 + new pair, session rotated |
| 4b | Vecchio refresh re-use | ✅ 401 |
| 4c | GET /me con NEW_ACCESS | ✅ 200 |
| 5 | POST /auth/logout | ✅ 204 |
| 5b | GET /me post-logout | ✅ 401 (session is_active=false) |
| 6 | POST /auth/login senza X-Tenant-Slug | ✅ 401 E_AUTH_TENANT_REQUIRED |
| 7 | POST /auth/login wrong password | ✅ 401 E_AUTH_INVALID_CREDENTIALS |

**Seed dev data (opt-out via NODE_ENV=production):**

- [x] `packages/db/prisma/seed.ts` esteso: tenant "demo" + sede "Sede Principale" + admin@demo.local (password Admin123! argon2 hashed, pin NULL) + role "Super Admin" tenant-scoped + 32 mappings cloni da template + user_role assignment tenant-wide
- [x] Verifica DB count post-seed: tenants=1, sedi=1, users=1, roles=1, role_permissions=32, user_roles=1 (idempotente con upsert)

**File creati (24 nuovi in apps/api/src/):**

- `auth/`: auth.module.ts, auth.controller.ts, auth.service.ts, strategies/jwt.strategy.ts, guards/jwt-auth.guard.ts, decorators/public.decorator.ts, decorators/current-user.decorator.ts, interfaces/jwt-payload.interface.ts, interfaces/authenticated-request.interface.ts, dto/{login,refresh,auth-response}.dto.ts
- `tenant/`: tenant.module.ts, tenant.middleware.ts, decorators/current-tenant.decorator.ts
- `users/`: users.module.ts, users.service.ts
- `me/`: me.module.ts, me.controller.ts

**File modificati (5):**

- `apps/api/src/main.ts` — `setGlobalPrefix('api/v1')` + `useGlobalPipes(ValidationPipe)`
- `apps/api/src/app.module.ts` — imports nuovi moduli + TenantMiddleware scoped a `/auth/login` only
- `apps/api/src/app.controller.ts` — `@Public()` su GET `/`
- `apps/api/src/health/health.controller.ts` — `@Public()` su GET `/health`
- `.env.example` — placeholder `JWT_SECRET` + comando openssl

**Dipendenze installate (apps/api):**

- `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`
- `argon2`, `class-validator`, `class-transformer`
- devDeps: `@types/passport-jwt`

### Decisioni prese durante D2a (2026-05-13 notte)

- **2026-05-13**: Scope split D2a / D2b / D2-vitest per disciplina tempi (calibrazione 5h vs 3h sottostimata). PR coordinate: D2a auth base + ADR-0008, D2-vitest test framework, D2b PIN POS
- **2026-05-13**: **Scoperta importante** — migration `unique_pin_per_tenant` rimossa (era nel prompt originale). Argon2 salt random vanifica la unique constraint: hash di "1234" per user A != hash per user B → constraint non scatta mai per duplicati clear-text. Falsa sicurezza. Soluzione D2b: verifica applicativa via `argon2.verify()` loop su `usersWithPin` del tenant
- **2026-05-13**: TenantMiddleware scoped SOLO a `/auth/login` (e in D2b a `/auth/login-pin`). `/auth/refresh` deriva tenantId dal payload JWT del refresh token. Pattern anti-spoofing
- **2026-05-13**: JWT payload minimal `{sub, tenantId, sessionId, type, iat, exp}` — roles/permissions lookup runtime dal DB per revoca istantanea
- **2026-05-13**: JwtAuthGuard globale via APP_GUARD + `@Public()` opt-out (security-by-default). Endpoint pubblici: root, /health, /auth/login, /auth/refresh
- **2026-05-13**: Audit log best-effort (try/catch + Logger warn su fail). Fail audit non blocca auth — accettato per F1
- **2026-05-13**: `failed_login_attempts` counter base solo (no rate limiting in D2a). Auth hardening macro-task per Redis throttler + IP lockout
- **2026-05-13**: Seed dev data opt-out (`NODE_ENV !== 'production'`) — convenience by default, safety via env explicit in prod
- **2026-05-13**: Theft detection BASE in D2a (vecchio refresh → 401). Detection FULL (revoke all su token rotato re-used) rimandata a D2-vitest

### D2-vitest — Vitest baseline + theft detection FULL (2026-05-13 notte tardi)

Setup framework test del monorepo + chiusura decisione 10 di ADR-0008 (Vitest rimandato).

**Vitest setup:**

- [x] **Vitest 3.2.4** (downgrade da 4.1.6 — bug native binding rolldown irrisolto da pnpm)
- [x] **`projects` array** in `vitest.config.mts` root (API Vitest 4-ready, no `workspace` field deprecato)
- [x] **`.mts` extension** per config (Vite 7 ESM-only, apps/api CJS preserved)
- [x] **`apps/api/test/setup.ts`** placeholder per future global mocks
- [x] **`--passWithNoTests`** su script `test`/`test:coverage` (workspace senza spec non rompono)
- [x] **`turbo.json` task test**: rimosso `dependsOn: ["^build"]` (test indipendenti)
- [x] **Root script** `test`: da placeholder a `turbo run test`

**Theft detection FULL (`AuthService.refresh`):**

- [x] Decision tree 5 scenari: JWT invalid / session absent / hash mismatch / session active + hash match (rotation) / session NOT active + hash match (**THEFT**)
- [x] Theft action: `updateMany` revoke all user sessions con `isActive: true` + audit `auth.theft_detected` con payload forense `{revokedSessionCount, suspectedSessionId, attackerIp, attackerUserAgent}` + throw `E_AUTH_THEFT_DETECTED`
- [x] Audit actions enum espanso: `auth.{login.success, login.failure, logout, refresh.success, theft_detected}`
- [x] Logger warn esplicito su theft detection (alert-friendly)

**4 test essential (`apps/api/src/auth/auth.service.spec.ts`):**

| # | Test | Esito |
|---|---|---|
| 1 | login success → JWT pair + session + audit `auth.login.success` | ✅ |
| 2 | login wrong password → throws + `failed_login_attempts++` + audit `auth.login.failure` reason `wrong_password` | ✅ |
| 3 | login user not found → throws E_AUTH_INVALID_CREDENTIALS (no info leak) + audit reason `user_not_found_or_inactive` | ✅ |
| 4 | refresh con rotated token → `updateMany({userId, isActive: true})` revoke all + audit `auth.theft_detected` con payload forense completo + throws E_AUTH_THEFT_DETECTED | ✅ |

Run: `pnpm test` → 4 passed (8ms), 380ms total setup.

**E2E smoke verifica empirica** (2026-05-13 00:41 UTC):

1. Login → refresh_A
2. refresh(refresh_A) → refresh_B (rotation, vecchia session `is_active=false`)
3. refresh(refresh_A) re-use → **HTTP 401 E_AUTH_THEFT_DETECTED**
4. `SELECT COUNT(*) FROM sessions WHERE user_id=admin AND is_active=true` → **0** (entrambe revocate)
5. `SELECT * FROM audit_logs WHERE action='auth.theft_detected'` → 1 row con `afterValue = {attackerIp, attackerUserAgent, suspectedSessionId, revokedSessionCount: 1}` ✅

### Decisioni prese durante D2-vitest (2026-05-13 notte tardi)

- **2026-05-13**: Vitest 3.2.4 (no 4.x) — bug rolldown native binding pnpm. Stabile, Vite 7-compatible
- **2026-05-13**: `.mts` extension per config Vitest — necessario per Vite 7 ESM-only senza toccare CJS apps/api
- **2026-05-13**: **Bypass DI container** nei test — instanziazione manuale `new AuthService(mockDb, mockUsers, mockJwt)`. Motivo: esbuild Vitest non emette `emitDecoratorMetadata` (stesso problema D1 con tsx). Trade-off accettato: test business logic isolata vs DI tree validation. E2E test (full bootstrap) in macro-task futuro
- **2026-05-13**: Mock argon2 + @gestionale/db module-level via `vi.mock()`. Determinismo + zero CPU cost del KDF reale
- **2026-05-13**: Theft action = revoke ALL + audit forense (no email notify F1). Defense in depth: anche legittimo costretto re-login. Email notification in macro-task "Auth E2E hardening" insieme rate limiting
- **2026-05-13**: Turbo task `test`: rimosso `dependsOn: ["^build"]` (test indipendenti, parallelismo dev locale, cache cleanliness)
- **2026-05-13**: Audit log `auth.refresh.success` aggiunto come action distinta da `auth.login.success` (analytics tracking, joint via `previousSessionId` in afterValue)

### D2b — PIN POS login (Macro-task D2b, 2026-05-13 notte tardi)

Auth completata con flusso PIN dedicato ai terminali POS. Scope: 2 endpoint + uniqueness applicativa + 4 audit actions + 2 test essential + smoke E2E 8 scenari.

- [x] **POST `/api/v1/auth/pin-setup` (Protected)** — re-auth `currentPassword` (OWASP) + validazione formato PIN (`^\d{4,6}$`) + check forbidden patterns (~60 entries hardcoded: all-same + sequenziali asc/desc 4/5/6 cifre) + uniqueness applicativa via `argon2.verify` loop su `findAllWithPinByTenant(tenantId, excludeId=userId)` + `argon2.hash` + `users.pin_hash` update. Idempotente (overwrite permesso, audit discriminato).
- [x] **POST `/api/v1/auth/login-pin` (Public)** — header `X-Tenant-Slug` obbligatorio (TenantMiddleware scoped al path) + DTO `{pin, deviceId, deviceType}` con `deviceType ∈ {pos_tablet, pos_desktop, mobile}` (escluso `web`) + scan argon2.verify sui candidati `pin_hash != null AND isActive` + emette JWT pair + session con `deviceId`/`deviceType` overrides.
- [x] **`apps/api/src/auth/utils/pin-validator.ts`**: `FORBIDDEN_PINS: ReadonlySet<string>` (~60 entries) + `validatePin()` con errore `E_AUTH_PIN_FORBIDDEN_PATTERN`.
- [x] **DTO**: `PinSetupDto` (currentPassword min 8 + pin regex) e `LoginPinDto` (pin regex + deviceId 1-64 + deviceType `@IsIn`).
- [x] **`UsersService` esteso**: `findAllWithPinByTenant(tenantId, excludeId?)` + `setPinHash(userId, hash)`.
- [x] **4 nuove audit actions** (totale 9): `auth.pin.setup` (wasReset:false), `auth.pin.reset` (wasReset:true), `auth.login_pin.success`, `auth.login_pin.failure`. Re-auth fallito su pin-setup riusa `auth.login.failure` con `reason: 'pin_setup_password_check_failed'`.
- [x] **2 nuovi test essential** (totale 6): test 5 verifica setupPin success path (argon2.hash + setPinHash + audit setup); test 6 verifica loginPin scan multi-candidate (verify false → true) + session POS + audit login_pin.success.
- [x] **TenantMiddleware esteso**: `auth/login-pin` aggiunto a `forRoutes` (pre-auth, no JWT da cui derivare tenantId).
- [x] **Smoke E2E 8 scenari verdi** (PIN `4827` random non-pattern): login admin → pin-setup OK → pin-setup forbidden 1234 → wrong password 401 → login-pin success → login-pin wrong 0000 → /me con PIN token → DB session deviceType=pos_tablet.

#### Decisioni prese durante D2b (2026-05-13 notte tardi)

- **2026-05-13**: PIN regex `^\d{4,6}$` (no separator). Tastiere POS numeriche; lunghezza variabile per UX/security trade-off.
- **2026-05-13**: `FORBIDDEN_PINS` set hardcoded (~60 entries: all-same + sequenziali asc/desc per 4-6 cifre). Niente file/rete; revocabile/estendibile in-source.
- **2026-05-13**: **Uniqueness via argon2.verify loop** (decisione critica). Migration `unique_pin_per_tenant` rifiutata: argon2 salt random → hash dello stesso PIN sono diversi → l'index non scatta mai per duplicati clear-text (falsa sicurezza). F1 OK con N piccolo (poche user/tenant). Tech debt F2: HMAC-SHA256(pin, tenantSalt) come `pin_lookup` indicizzato.
- **2026-05-13**: PIN overwrite consentito + audit discriminato `auth.pin.setup` (pin_hash era NULL) vs `auth.pin.reset` (overwrite). UX: utente puo' resettare il proprio PIN senza percorso admin.
- **2026-05-13**: Re-auth `currentPassword` su pin-setup (OWASP "Authentication-sensitive operation"). Mitigazione XSS/session hijack.
- **2026-05-13**: `login-pin` failure NON incrementa `failed_login_attempts` (counter e' per coppia email+password). Tech debt F1+: rate limit dedicato per `(tenantId, deviceId, ip)` in Redis bucket.
- **2026-05-13**: `deviceType` login-pin esclude `web` (DTO `@IsIn` ammette solo pos_tablet/pos_desktop/mobile). `web` non e' POS.
- **2026-05-13**: Single error code `E_AUTH_INVALID_CREDENTIALS` per PIN wrong / no match. No info leak (stesso pattern login email/password).
- **2026-05-13**: Smoke test PIN `4827` (random non-pattern) invece di `5678` originalmente proposto (sequenziale, sarebbe stato rifiutato dal validator).

### D3a — RLS framework (Macro-task D3a, 2026-05-13 notte fonda)

Framework Row Level Security operativo a livello applicativo. **NON attiva il enforcement reale** (policy DB ancora placeholder, postgres user bypassa RLS). Necessario D3b per security activation.

- [x] **AsyncLocalStorage context** (`packages/db/src/rls.ts`): `TenantContext` type + ALS singleton + helpers `getTenantContext`, `runInTenantContext(ctx, fn)`, `withSystemContext(fn)`, `withSuperAdminContext(tenantId, fn)`.
- [x] **rlsExtension factory** (`packages/db/src/rls.ts`): Prisma extension `$allOperations` wrappa ogni query in `$transaction` interactive con `SET LOCAL app.tenant_id` + `SET LOCAL app.is_super_admin`. Fail-fast `RlsNoContextError` se context mancante.
- [x] **R3 fix F1 + re-entrancy guard**: scoperto empiricamente a STOP 1 che `query(args)` non eredita il tx context di Prisma. Workaround: `(tx as any)[modelLower][operation](args)` + `inflightStorage` ALS guard per recursion. Documentato in rls.ts + ADR-0009.
- [x] **Wire extension** in `packages/db/src/index.ts`: chain `softDeleteExtension` → `rlsExtension`. Re-export RLS API.
- [x] **TenantContextInterceptor** (`apps/api/src/context/tenant-context.interceptor.ts`): NestJS Interceptor globale registrato via `APP_INTERCEPTOR`, wrappa handler in `runInTenantContext({tenantId: req.tenantId, isSuperAdmin: false})` via Observable/Promise bridge (firstValueFrom). Skip per Public senza tenant.
- [x] **TenantMiddleware refactor**: slug lookup in `withSystemContext`, resolve → `runInTenantContext` wrappa il `next()` per propagare ALS al resto della chain.
- [x] **AuthService.refresh wrap**: `/auth/refresh` non passa per middleware tenant → wrap interno con `runInTenantContext({tenantId: payload.tenantId, false})` dopo JWT decode. Refactor `refresh` + `refreshInContext`.
- [x] **Health service wrap** in `withSystemContext` (anche se `$queryRaw` bypassa extension: leggibilita' intent + safety futura).
- [x] **Seed + smoke-soft-delete wrap** in `withSystemContext` (script ops = system context per design).
- [x] **6 test essential** continuano a passare: mock `@gestionale/db` esteso con `runInTenantContext`, `withSystemContext`, `withSuperAdminContext` (passthrough fn).
- [x] **Smoke "limited" 4/4 scenari verdi** (script `/tmp/d3a-smoke-limited.ts` non committato): role temp non-superuser + policy reale temp su `users` only; BASELINE/SCEN1/SCEN2 (tenant random=0)/SCEN3 (super_admin=tutti)/SCEN4 (no context throws) tutti PASS.
- [x] **ADR-0009 v1**: 15 decisioni + R3 fix + R9 deferred + considered alternatives + reversibility + tech debt + security considerations.

#### Decisioni prese durante D3a (2026-05-13 notte fonda)

- **2026-05-13**: Pattern S2 (per-operation tx + Prisma extension) vs S3 (HTTP-scoped tx) — S3 scartato per R5 (argon2 verify blocca pool connection ~150ms). S2 overhead 2-3ms/query localhost accettabile F1.
- **2026-05-13**: ALS instance singleton di modulo in `packages/db/src/rls.ts` (non in apps/api). Seed.ts e altri script in packages/db possono importare senza dipendenza inversa cross-package. Decisione architetturale chiarita a STOP 0.
- **2026-05-13**: **R3 manifesto a STOP 1**: `query(args)` dentro `$transaction(async tx => ...)` non eredita il tx context (verificato empiricamente). Fix F1: `tx[modelLower][operation](args)` + re-entrancy guard. Pattern testato 4/4 scenari verdi.
- **2026-05-13**: **R9 scoperto a STOP 1**: postgres user (DATABASE_URL) è superuser + BYPASSRLS, bypassa RLS by design. Senza app role non-superuser, RLS è no-op. Split D3a/D3b deciso: D3a chiude con framework, D3b attiva con role + GRANT + DIRECT_URL + migration policy reali.
- **2026-05-13**: **S5 clarification**: `isSuperAdmin = false` SEMPRE da JWT in F1. Tenant-scoped "Super Admin" role del seed e' solo bundle di permessi, NON RLS bypass. Concetto "platform super admin user" rimandato a macro-task futuro.
- **2026-05-13**: Naming policy reali D3b: `<table>_tenant_isolation` (vs placeholder `<table>_policy`). Permette future policy multiple per tabella.
- **2026-05-13**: `tenant_id` policy = text comparison (no cast `::uuid`): scoperto a STOP 1 che `tenant_id` è TEXT in DB (Prisma String mapping). Le policy D3b useranno text comparison senza cast.

### D3b — RLS activation (Macro-task D3b, 2026-05-13 notte fonda)

RLS attivo e enforced runtime. App role non-superuser + policy reali + FORCE ROW LEVEL SECURITY + pattern dual-URL Prisma + docker init bootstrap + smoke E2E full.

- [x] **Migration `create_app_role_and_grants`**: `CREATE ROLE gestionale_app` IF NOT EXISTS con placeholder password (`'PLACEHOLDER_MUST_BE_ROTATED'`, ruotata via separato `ALTER ROLE` post-apply) + attributi `LOGIN NOSUPERUSER NOBYPASSRLS` + `GRANT USAGE/SELECT/INSERT/UPDATE/DELETE` su schema+tables+sequences + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` per future tabelle.
- [x] **Schema Prisma dual-URL**: `directUrl = env("DIRECT_URL")` mappato in `packages/db/prisma/schema.prisma`. Prisma 5+ usa DIRECT_URL automaticamente per DDL (migrate/generate), DATABASE_URL per runtime queries. Nessun swap manuale `.env` necessario.
- [x] **`.env` + `.env.example`**: aggiunti `APP_DB_PASSWORD` (raw base64), `DATABASE_URL` (app role con password URL-encoded — pattern `=`→`%3D`, `+`→`%2B`, `/`→`%2F`), `DIRECT_URL` (postgres). `.env.example` con placeholder, `.env` reale gitignored.
- [x] **Migration `replace_rls_placeholder_with_real`**: DROP `<table>_policy` × 7 + CREATE `<table>_tenant_isolation` × 7 con pattern `is_super_admin OR tenant_id = current_setting('app.tenant_id', true)`. user_roles/sessions usano EXISTS join. `tenants` usa colonna `id`. NO cast `::uuid` (tenant_id è TEXT). + ALTER TABLE FORCE ROW LEVEL SECURITY × 7.
- [x] **Migration `tighten_app_role_attributes`** (defense in depth aggiunto a STOP 7 per simmetria con docker init script): `ALTER ROLE gestionale_app NOCREATEDB NOCREATEROLE NOINHERIT`. Idempotente.
- [x] **Seed esteso con `seedDevTenant(params)` helper**: refactor del bootstrap tenant dev in funzione riusabile. Aggiunto 2° tenant `acme` (slug 'acme', name 'Pizzeria Acme') + sede `Sede Centro` Roma + user `manager@acme.local` / `Manager123!` + role Super Admin tenant-scoped + 32 role_permissions. Idempotente (0 created al re-run).
- [x] **Smoke E2E full** `packages/db/scripts/smoke-rls-e2e.ts` (script committato, read-only, idempotente): 7 scenari (5 mandatory + 2 extra coverage): tenant demo isolation (count=1), tenant acme isolation (count=1), cross-tenant block via UUID-known lookup (null), system context bypass (count=2), super admin context (bypass via is_super_admin), roles table isolation (count=1), audit_logs equivalence (`demo_ctx_count == system_filter_demo_count`). Wrapper `pnpm smoke:rls-e2e`. **7/7 PASS** prima e seconda esecuzione.
- [x] **Docker compose ensure role bootstrap**: `infra/postgres/init/01-create-app-role.sh` idempotente con `format(%L)` injection-safe, `set -euo pipefail`, guard env var. `docker-compose.dev.yml` con `APP_DB_PASSWORD` env propagata al service postgres + mount `./infra/postgres/init:/docker-entrypoint-initdb.d:ro`. Gira SOLO al primo bootstrap del volume.
- [x] **Post-D3a finding**: `JwtStrategy.validate()` faceva query Prisma al guard stage (prima dell'Interceptor) → `RlsNoContextError`. Latente in D3a perchè policy era `USING(true)` + test mock-based. Fix con wrap in `runInTenantContext(payload.tenantId, false)` (defense in depth) + refactor `validate/validateInContext`. Pattern analogo a `AuthService.refresh`.
- [x] **ADR-0009 v2**: aggiunte sezioni "Status finale", "D3b — Activation completed", "Post-D3a findings", "Considered Alternatives D3b", "Reversibility estesa", "Tech debt aggiornato" (10 voci), "Security considerations finale". Status: Accepted (D3a + D3b complete).
- [x] **README**: callout SUCCESS RLS Active sostituisce il vecchio warning, sezione "Database setup (D3b RLS Active)" con runbook 5-step (genera password / configura URL / migrate / ALTER ROLE / seed), sezione "Multi-tenant isolation (D3a + D3b)" con componenti DB + comando smoke + caveat.

#### Decisioni prese durante D3b (2026-05-13 notte fonda)

- **2026-05-13**: **R9 scoperto a STOP 1 D3a → risolto in D3b**. Postgres user superuser+BYPASSRLS bypassa RLS. Senza app role non-superuser, framework è no-op. Split D3a/D3b deciso a STOP 1 D3a, completato a D3b.
- **2026-05-13**: **Pattern dual-URL Prisma** (DATABASE_URL=app role / DIRECT_URL=postgres) scelto rispetto a swap manuale del singolo URL. Prisma 5+ usa DIRECT_URL automaticamente per migrate/generate quando definito in schema.
- **2026-05-13**: **FORCE ROW LEVEL SECURITY obbligatorio**: senza, il table owner (postgres come migration runner) bypassa policy. Senza ALTER TABLE FORCE, gestionale_app vede filtrato ma postgres no → asimmetria pericolosa.
- **2026-05-13**: **EXISTS join policy per user_roles + sessions**: tabelle senza colonna `tenant_id` diretta. user_roles → `roles.tenant_id`, sessions → `users.tenant_id`. Index PK rende sub-select O(log n). Denormalizzazione tenant_id rimandata (tech debt F1+ se profiling lo giustifica).
- **2026-05-13**: **Password placeholder + ALTER ROLE post-migrate** (pattern non ideale): migration committata in git non puo' contenere password reale. Soluzione: `'PLACEHOLDER_MUST_BE_ROTATED'` + step manuale post-apply documentato in README + warning ASCII box prominente in migration SQL. Tech debt #8 ADR-0009: secret manager (Vault) per F2.
- **2026-05-13**: **Refactor `seedDevTenant(params)` helper** durante STEP 4: il bootstrap tenant inline avrebbe creato duplicazione demo+acme. Helper riusabile single source of truth. Non decisione architetturale macro (refactor pulito), menzione solo in commit message.
- **2026-05-13**: **JwtStrategy.validate wrap** (post-D3a finding emerso a STEP 2): query Prisma dentro `validate()` (guard stage) prima dell'Interceptor. Fix con `runInTenantContext(payload.tenantId)` (defense in depth, RLS filtra session.findUnique sul tenantId del JWT).
- **2026-05-13**: **Migration immutability** (regola interna nata da STEP 3 checksum drift): MAI modificare SQL/comment di migration applicate. Per fix/refinement post-apply → nuova migration `<ts>_fix_<topic>.sql`. Esempio: `tighten_app_role_attributes` aggiunge attributi role senza toccare `create_app_role_and_grants`.
- **2026-05-13**: **Docker init script + migration coesistenti**: docker init per fresh volume (password reale at-bootstrap), migration per existing volumes (placeholder + ALTER ROLE post). Coerente con docker-entrypoint-initdb.d semantics (one-shot).

### D4 — Bootstrap tenant logic (Macro-task D4, 2026-05-13 notte fonda)

Endpoint `POST /api/v1/tenants` per creare nuovo tenant + bootstrap RBAC completo in 1 chiamata atomic. Apre il pattern "ops multi-statement atomic" per macro-task futuri.

- [x] **Endpoint `POST /api/v1/tenants`** (`apps/api/src/tenants/tenants.controller.ts`): protetto by `JwtAuthGuard` globale, body `CreateTenantDto`, defense-in-depth check `user` undefined.
- [x] **`TenantsService.createTenant(dto, createdBy)`** (~190 LOC): permission check FUORI tx → `withSystemContextAtomicTx` atomic → 8 operations (slug check, tenant.create, sede.create, argon2.hash, user.create, 6× role+rolePermissions clone da template, userRole.create con assignedById, auditLog 'tenant.created').
- [x] **`UsersService.hasPermission(userId, code)`** (`apps/api/src/users/users.service.ts`): query Prisma `findFirst` con chain `roles.some → role.permissions.some → permission.code` + `select: {id: true}`. Lazy lookup coerente con ADR-0008 decisione 7. 2 test essential mock-based (8/8 Vitest totali).
- [x] **DTO `CreateTenantDto`** (`apps/api/src/tenants/dto/create-tenant.dto.ts`): @IsString/@MinLength/@MaxLength/@Matches/@IsEmail/@IsNotIn(FORBIDDEN_SLUGS). Default sede service-side via `??`. Test DTO via Vitest temporaneo 9/9 PASS (S1 valid, S2-S6 slug rejections, S7 password, S8 email, S9 postal code).
- [x] **`FORBIDDEN_SLUGS`** (`apps/api/src/tenants/dto/forbidden-slugs.ts`): 11 voci hardcoded (`api/www/admin/system/app/public/static/health/auth/me/tenants`). Pattern simmetrico a `FORBIDDEN_PINS` D2b.
- [x] **TenantsModule** + import in `AppModule.imports`: DI `UsersModule` per `usersService.hasPermission`.
- [x] **Audit action enum** esteso (totale 10): `+'tenant.created'` con `afterValue: {slug, name, adminEmail}` — NO password.
- [x] **2 Atomic helpers in `packages/db/src/rls.ts`**: `withSystemContextAtomicTx(client, fn)` + `withTenantContextAtomicTx(client, tenantId, fn)`. ~110 LOC. Bypass auto-wrap dell'extension RLS via `inflightStorage` re-entry guard (esposto come export internal). SET LOCAL una volta sull'inizio del tx via helper privato `setLocalRlsContext`.
- [x] **Atomicity test 4/4 PASS** (script `/tmp/d4-atomicity-test.ts`, one-shot non committato): S1 system+throw rollback, S2 system happy create, S3 tenant ctx RLS attivo, S4 tenant+throw rollback.
- [x] **Smoke E2E 5/5 PASS** (script `/tmp/d4-smoke.sh`, one-shot non committato): S1 no auth=401, S2 valid slug=201+delta DB esatto (+1 tenant/+1 user/+6 roles/+104 rolePermissions/+1 userRole/+1 auditTenantCreated/+1 sede), S3 dup slug=409+E_TENANT_SLUG_EXISTS, S4 'admin' slug=400+E_TENANT_SLUG_RESERVED, S5 login nuovo admin + /me=32 perms.
- [x] **STEP 0 fix `$queryRaw` regression** in `rls.ts`: pass-through `$allOperations` con `model=undefined` (raw queries arrivano qui in Prisma 6.19.3). 5 LOC. Health check tornato 200 (era 503 dopo swap a NOSUPERUSER DATABASE_URL).
- [x] **ADR-0010** (nuovo): 7 decisioni + 3 discoveries (F1 $queryRaw, F2 $transaction atomicity, F3 forceDelete+RLS bypass), considered alternatives, reversibility, tech debt (4 voci), security considerations.
- [x] **README**: sezione "Tenant bootstrap (D4) — POST /tenants" con curl esempio; tabella "modalità accesso DB" estesa da 3 a 5 (aggiunti 2 Atomic helpers).
- [x] **ADR-0009 v3 Notes**: 2 caveat aggiunti (raw queries pass-through scoperto empiricamente F1; explicit `$transaction` non atomico → usa Atomic helpers F2).

#### Decisioni prese durante D4 (2026-05-13 notte fonda)

- **2026-05-13**: **F1 fix $queryRaw regression** scoperto al pre-flight D4. Bug latente in D3a/D3b mascherato da smoke read-only + test mock-based. Health check funzionava finche' DATABASE_URL=postgres (superuser bypass), rotto al swap a NOSUPERUSER. Fix 5 LOC: early-return pass-through nell'extension RLS quando `model === undefined`.
- **2026-05-13**: **F2 fix $transaction atomicity** scoperto pre-implementazione TenantsService. Verifica empirica: `prisma.$transaction(async tx => tx.tenant.create(...) + throw)` → tenant NON rollback (orphan). Root cause: RLS extension auto-wrappa ogni op in `client.$transaction(...)` separato (closure `client` e' BASE, non userTx). Fix architetturale: 2 Atomic helpers (`withSystemContextAtomicTx` + `withTenantContextAtomicTx`) che fanno SET LOCAL una volta + `inflightStorage` guard per bypass auto-wrap nelle ops dentro al tx.
- **2026-05-13**: **F3 forceDelete + RLS bypass in `withSystemContext`** scoperto durante regression check post-smoke D4. `forceDelete` usa `$executeRawUnsafe` → bypassa extension → SET LOCAL non applicato → policy filtra → DELETE 0 rows. Workaround D4: cleanup ops via `DIRECT_URL` (postgres superuser bypassa RLS by design). Fix proper futuro: `withSystemContextRaw` helper. Tech debt #1 ADR-0010.
- **2026-05-13**: **Permission check FUORI tx + inline (no Guard generico)**: D4 ha 1 endpoint. Inline `usersService.hasPermission` sufficient. Generic `@RequirePermissions(...)` rimandato a macro-task RBAC enforcement futuro.
- **2026-05-13**: **Slug forbidden list hardcoded** (pattern simmetrico FORBIDDEN_PINS D2b): no fetch DB/rete, revocabile/estendibile in-source.
- **2026-05-13**: **Default sede service-side** (vs `@Transform` DTO): default validi anche se `createTenant` chiamato da seed/CLI bypassando DTO. Single source of truth.
- **2026-05-13**: **Audit log `tenant.created` filtrato**: `afterValue = {slug, name, adminEmail}`. **NO password** (security leak — audit log readable da Super Admin + system queries).
- **2026-05-13**: **Cleanup pattern lesson learned**: test script che creano dati DB richiedono cleanup verificato via DIRECT_URL (superuser bypass) OR tx rollback intenzionale. Pattern futuro per smoke scripts. Tech debt #2 ADR-0010.

### E1 — Next.js scaffold + dual package strategy (Macro-task E1, 2026-05-13 mattina)

Primo macro-task frontend. Trigger di CC2 ADR-0007 (CJS/ESM strategy) ora risolto via dual package professional. Scaffold `apps/web` Next.js 15 + React 18.3 + Tailwind 3.4 + shadcn/ui consumer di `@gestionale/db` via `exports.import → dist/index.mjs`. apps/api invariato (zero regression).

- [x] **Fase 1 — `packages/db` dual package via `tsup`**: `package.json` con `type: module` + `exports` conditional (import/require + types nested ATTW-compliant) + `files: ["dist"]`. `tsup.config.ts` 12 LOC: CJS+ESM+DTS, `outExtension` esplicito (`.cjs`/`.mjs`), target node20, external `@prisma/client`. Build: 6 file dist/ (cjs/mjs + d.cts/d.ts + 2 sourcemap), ~10K cadauno. Smoke RLS 7/7 PASS post-build.
- [x] **Fase 1 fix in-fase — 10 type errors latenti packages/db** (Discovery F1): `tsup --dts` ha rivelato errori non catchati da `tsc --noEmit` né da test runtime. Fix minimal in-place (`(Prisma as any).dmmf`, `tx: any` per `$executeRawUnsafe`, type annotations su lambda `.map()`). ZERO refactor, ZERO regression runtime. Commento motivazione runtime su ogni cast.
- [x] **Fase 2 — apps/api consumer trasparente**: ZERO modifiche apps/api. `node -e "require.resolve('@gestionale/db')"` → `dist/index.cjs` (exports.require). 5 endpoint smoke OK: health 200, login 201+JWT pair, /me 200+32 perms, POST /tenants 201+payload completo, cleanup tenant via psql DIRECT_URL. Vitest 8/8 verde.
- [x] **Fase 3 — Turbo build chain**: `turbo.json` `dev: dependsOn ["^build"]` + `typecheck: dependsOn ["^build"]` (Opzione A globale). Cache miss 4.8s, cache hit `>>> FULL TURBO` 119ms (ratio 40x). Dev chain validato: `pnpm exec turbo run dev --filter=@gestionale/api` → db:build prima, api:dev dopo.
- [x] **Fase 4 — apps/web scaffold Next.js 15 manual**: 7 file (`package.json`, `tsconfig.json`, `next.config.mjs`, `.eslintrc.json`, `src/app/{layout,page}.tsx`, `src/app/globals.css`). Versioni `next@15.5.18`, `react@18.3.1`, `react-dom@18.3.1`. Smoke `:3001` HTTP 200, HTML con `<title>Gestionale</title>`, `<html lang="it">`, `<h1>Gestionale Platform</h1>`, `<p>F1 scaffold attivo</p>`.
- [x] **Fase 5 — Tailwind 3.4 + shadcn/ui scaffold manuale**: `tailwindcss@3.4.19` + `postcss@8.5.14` + `autoprefixer@10.5.0`. 5 file shadcn manuali (T3-style, NO CLI): `components.json`, `src/lib/utils.ts` (cn helper), `src/components/ui/button.tsx` (cva 6 variants 4 sizes + Slot), `src/app/globals.css` (HSL CSS vars), `tailwind.config.ts` (theme.extend + plugin tailwindcss-animate). Button renderizzato styled (bg-primary, h-10 px-4 py-2, hover/focus/disabled states).
- [x] **Fase 6 — Gate critico 6/6 PASS**: health 200 + web 200+Button + typecheck FULL TURBO 119ms 4/4 + lint clean (fix in-fase ignore `next-env.d.ts`) + Vitest 8/8 + smoke RLS 7/7. Entrambi i dev server in parallelo OK (api:3000 + web:3001).
- [x] **Fase 7 — Docs**: [ADR-0011](docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md) (status, context, 5 decisions, 5 discoveries E1, considered alternatives, reversibility, 5 tech debt, security). ADR-0007 status update CC2 = Resolved. README Stack table + sezione "Frontend (apps/web)" + nota entrypoint dev pattern. PROGRESS questa sezione.

#### Discoveries E1 (5 finding, tutti tracked in ADR-0011)

- **F1 — 10 type errors latenti packages/db rivelati da tsup DTS** (STOP 1): `Prisma.dmmf` rimosso da `.d.ts` Prisma 6, `$executeRawUnsafe` strippato dal tipo `Tx` post-`$extends`, implicit any su lambda Prisma 6 narrowing. Cause: `noEmit: true` + nessun DTS emit pre-E1 nascondevano la fragilità. Fix in-place minimal con commenti motivazione runtime.
- **F2 — `pnpm --filter <ws> <script>` bypassa Turbo `dependsOn`** (STOP 3): pnpm filter chiama lo script diretto, salta orchestration Turbo. Pattern corretto: `pnpm dev` (root) OR `pnpm exec turbo run dev --filter=<ws>`. Documentato in README + ADR-0011 F2.
- **F3 — Path resolution asymmetry apps/api vs apps/web** (STOP 4): apps/api eredita base `paths` (alias to src/), apps/web override (resolve via node_modules + exports.import to dist/). Intentional, ma sorgente di confusione futura — tracked TD-4 ADR-0011.
- **F4 — `shadcn@latest` (v4.7.0) pollution + Tailwind 4 default** (STOP 5): no opt-out flag T3 documentato, genera CSS oklch + `@import "tw-animate-css"` + crea file fuori workspace + auto-modifica layout.tsx. Manual scaffold 5 file è la SOLA via affidabile per T3.4 nel 2026.
- **F5 — `next-env.d.ts` triple-slash refs viola ESLint** (STOP 6, in-fase): file auto-generato Next con `/// <reference types="next" />` rifiutato da `@typescript-eslint/triple-slash-reference`. Fix: aggiunto `**/next-env.d.ts` a `eslint.config.js` ignores + `next-env.d.ts` a `.gitignore` (pattern Next.js docs).

#### Decisioni prese durante E1 (2026-05-13 mattina)

- **2026-05-13**: **Dual package via tsup** (vs ESM-everywhere vs tsx workaround) — Opzione A di ADR-0007 CC2 scelta. tsup zero-config, build CJS+ESM+DTS in <2s, exports field ATTW-compliant.
- **2026-05-13**: **tsup vs tsc puro**: tsup wraps esbuild + rollup-plugin-dts, 12 LOC config totali. tsc puro richiederebbe 2 build separati + scripting (~40+ LOC).
- **2026-05-13**: **Tailwind 3.4 (NO 4)**: shadcn ecosystem 100% compat T3 oggi, T4 breaking (oklch + `@theme` directive). Migration tracked TD-1.
- **2026-05-13**: **React 18.3 (NO 19)**: ecosystem (Radix, shadcn, libs third-party) full compat 18.3, parziale/sperimentale 19. Migration tracked TD-2.
- **2026-05-13**: **Manual scaffold apps/web (NO create-next-app)**: pattern coerente con apps/api D1 manual scaffold. Auto-install pollution evitata, config divergence (eslint/tsconfig) evitata.
- **2026-05-13**: **shadcn manual scaffold (NO CLI)**: F4 discovery — shadcn@4.7.0 defaulta T4 senza opt-out. 5 file standard T3 scritti a mano. Tracked TD-5.
- **2026-05-13**: **path resolution F3 → `@/*: ["apps/web/src/*"]`** (path completo da workspace root baseUrl), NON `["./src/*"]` (resolverebbe contro workspace root). TS paths sono relativi a baseUrl ereditato, NON al file tsconfig.
- **2026-05-13**: **next-env.d.ts → gitignore + eslint ignore** (F5): pattern Next.js docs raccomandato. File auto-generato non va committato.

---

### E2 — Login form UI + integrazione API (Macro-task E2, 2026-05-13 mattina-pomeriggio)

Primo flow end-to-end frontend↔API via browser. Form login `/login` (react-hook-form + zod + shadcn Form/Input/Card/Alert) → POST `/auth/login` con `X-Tenant-Slug: demo` → localStorage JWT → `/dashboard` GET `/me` → render Welcome `<firstName>` `<lastName>` + 32 permessi badge + logout. Auto-redirect `/` → `/login` o `/dashboard` basato su auth state. Bug fix collaterale **CORS missing backend (F3 critical)**: primo client browser-based ha esposto gap latente.

- [x] **Pre-flight**: branch `feature/login-flow-e2`, baseline 8/8 Vitest + 7/7 smoke RLS, admin@demo.local login + /me verificato via curl reale (shape MeResponse empirica)
- [x] **Fase 1 — shadcn install**: `printf "N\n" | pnpm dlx shadcn@latest add form input label card alert` (preserve button.tsx E1). Deps installate: `react-hook-form@7.75`, `@hookform/resolvers@5.2`, `zod@4.4`, `@radix-ui/react-label@2.1.8`. **Pollution check verde**: no T4 (no oklch/@base-ui/tw-animate-css), React resta 18.3.1. Pattern senior: `shadcn add` (E2) rispetta `components.json` ≠ `shadcn init` (E1) pollution
- [x] **Fase 2 — API client + auth lib + types**: 3 file `apps/web/src/lib/`: `api.ts` (`ApiError` class + `apiPost<T>` + `apiGet<T>` con DRY `parseError`), `auth.ts` (4 token functions con SSR guards), `types.ts` (`LoginResponse` + `MeUser` + `MeRole` + `MeResponse` shape verificata empiricamente via curl `/me` reale). `.env.local.example` committato + `.env.local` gitignored (riga 33 root)
- [x] **Fase 3 — Login page**: `apps/web/src/app/login/page.tsx` 128 LOC con `'use client'` + RHF + zodResolver + shadcn Form components. Zod schema email + min(8) password con messaggi IT. Submit try/catch ApiError → discriminate `E_AUTH_INVALID_CREDENTIALS` → "Email o password non corrette". autoComplete hints email/current-password
- [x] **Fase 4 — Dashboard + root redirect**: `apps/web/src/app/dashboard/page.tsx` 113 LOC (useEffect fetch /me + handle 401 → clearTokens + redirect, loading state, error state, Card Welcome + roles list + permessi flex-wrap badges + logout button). `apps/web/src/app/page.tsx` REPLACE (Server Component E1 → client-side redirect via `isAuthenticated()` + `router.replace`)
- [x] **Fase 5 — Gate critico**: 4/4 curl endpoint (health 200 + /login 200 + /dashboard 200 + / 200), typecheck FULL TURBO 4/4, lint clean (post fix F2 import type), Vitest 8/8 cached, smoke RLS 7/7. **9/9 smoke browser PASS** (Nicolò Mac manual, screenshot Welcome Admin Demo verificato)
- [x] **Fase 5 fix in-fase F3 ⭐ CRITICAL — CORS missing backend**: discovery dal browser console "Access to fetch blocked by CORS policy". Root cause: D2a-D4 testati SOLO via curl (no Origin enforcement), E2 primo browser-based caller espone gap. Fix: 5 LOC funzionali in `apps/api/src/main.ts` (`app.enableCors({origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001', credentials: true})`) + `.env.example` sezione CORS. ts-node-dev hot-reload PID 770893 → 781095. Curl OPTIONS preflight verificato: 4 header CORS attesi presenti
- [x] **Fase 6 — Docs**: [ADR-0012](docs/architecture/ADR-0012-frontend-auth-flow.md) (status, context, 6 decisions, 4 discoveries E2, 9 considered alternatives, 6 reversibility scenarios, 6 tech debt TD-1→TD-6, security pro/contro). README Stack table + sezione "Login flow (E2)" + paragrafo CORS. PROGRESS questa sezione

#### Discoveries E2 (4 finding, tutti tracked in ADR-0012)

- **F1 — Limitazione testing Claude Code remoto** (STOP 3): server SSH Hetzner no Chromium/Playwright. Validation client-side React richiede browser headless o manual test Nicolò. Server-side render verificabile via curl (HTTP 200 + token HTML), bundle compile verde, ma 4 test validation client-side delegati a Nicolò. Tracked TD-4: setup Playwright per E2E CI
- **F2 — shadcn CLI output non passa monorepo lint strict** (STOP 5): `apps/web/src/components/ui/form.tsx` generato con `import * as LabelPrimitive` ma usato solo type position. Violava `@typescript-eslint/consistent-type-imports` root config. Fix 1 carattere: `import type * as LabelPrimitive`. Lesson: file generated-by-tool validati dal gate lint. Tracked TD-5: verify lint immediato post-`shadcn add`
- **F3 ⭐ CRITICAL — CORS missing in NestJS backend** (Fase 5): browser fetch blocked by CORS policy, root cause backend NestJS never enabled CORS. Causa latency: D2a/D2b/D3a/D3b/D4 endpoint testati SOLO via curl (no Origin enforcement). E2 primo browser-based caller espone gap. Fix in `apps/api/src/main.ts` 5 LOC (`app.enableCors({origin: env.CORS_ORIGIN ?? 'http://localhost:3001', credentials: true})`) + env var CORS_ORIGIN + credentials:true preparato httpOnly cookie migration. Verifica empirica curl OPTIONS preflight: Allow-Origin + Allow-Credentials + Allow-Methods + Allow-Headers tutti presenti. **Lesson generalizzabile**: ogni nuovo "tipo di client" (browser, mobile, third-party SDK) può rivelare gap latenti del backend invisibili dal client precedente
- **F4 — Cross-platform browser shortcuts** (smoke test 8): Nicolò usa Mac → `Cmd+R` per refresh (NON `F5` come scritto inizialmente nei test). Memo documentation: futuri test browser includere shortcut Mac/Windows/Linux distinti

#### Decisioni prese durante E2 (2026-05-13 mattina-pomeriggio)

- **2026-05-13**: **JWT storage localStorage (NO httpOnly cookie)**: pragmatic over secure per progetto NOT-production. ~1.5h risparmiate vs setup cookie middleware + CSRF. Anti-pattern XSS surface accettato, tracked TD-1
- **2026-05-13**: **react-hook-form + zod (vs formik/yup vs manual useState)**: shadcn Form richiede RHF peer dep, zod type-safe + `z.infer<>` automatic. Versioni installate più recenti del prompt (zod 4 vs 3, resolvers 5 vs 3) ma API pattern invariata
- **2026-05-13**: **TENANT_SLUG = 'demo' hardcoded**: single-tenant flow E2 scope-contained. Subdomain/path routing tracked TD-2. Comment esplicito sul const top-level
- **2026-05-13**: **Pages structure 3-route + client-side redirect /**: `/` (page.tsx replace E1 con redirect), `/login`, `/dashboard`. Server Component inadatto per `/` (serve localStorage check). `router.replace` (NON `push`) → no history pollution su redirect e logout
- **2026-05-13**: **No auto-refresh token**: access token 15min, user re-login forzato post-scadenza. Trade-off UX accettato E2, pattern logout naturale. Tracked TD-3
- **2026-05-13**: **shadcn CLI `add` (vs E1 `init` manual scaffold)**: `add` rispetta `components.json` esistente (zero pollution). `printf "N\n"` per preservare `button.tsx` E1 quando `form` dipendenza chiede overwrite. Pattern senior consolidato

---

### B1 — Auth E2E hardening parte 1: rate limit + lockout (Sessione 8, 2026-05-13 sera-notte)

**Branch**: `feature/auth-e2e-hardening-b1` · **Status**: completato, PR merge pending · **ADR**: [ADR-0013](docs/architecture/ADR-0013-auth-e2e-hardening-b1.md)

Split di "B Auth E2E hardening" (carry-over [ADR-0008 §3](docs/architecture/ADR-0008-auth-module.md) + [ADR-0010 #4](docs/architecture/ADR-0010-tenant-bootstrap.md) + ADR-0012 Security gap): B1 = rate-limit + lockout, B2 = email theft + E2E full bootstrap programmato sessione 9.

**Deliverables**:

- `ThrottlerModule.forRootAsync` global + Redis storage (`@nestjs/throttler@6.5.0` + `@nest-lab/throttler-storage-redis@1.2.0` + `ioredis@5.10.1`)
- 3 named throttlers env-driven: `default` (60/min global), `auth-strict` (5/min `/auth/login` + `/auth/login-pin` opt-in via `@AuthStrict()`), `tenant-create` (3/h `POST /tenants` opt-in via `@TenantCreate()`)
- `AppThrottlerGuard` custom tracker **userId-or-IP** per `tenant-create` (JWT decode minimale dall'Authorization header pre-JwtAuthGuard ordering — anti IP rotation)
- `RedisModule` `@Global` shared (1 connection pool ioredis riusabile per Throttler + Lockout + futuro cache/session)
- `LockoutService` Redis sliding window (ZADD/ZREMRANGEBYSCORE/ZCARD/SET pipeline atomico): threshold=10, window=15min, duration=15min env-driven
- `AuthService.login` + `loginPin`: check lockout PRE-DB lookup (anti-timing-leak). Reset doppio (Redis + DB `failedLoginAttempts`) su success.
- `LockoutExceptionFilter` (extends `BaseExceptionFilter`, APP_FILTER): `Retry-After: 900` **fissi** anti user-enumeration (real retryAfterSec solo in log)
- Nuovo audit action `auth.account_locked` (totale 11, **no migration** necessaria — `audit_logs.action` è String text-based)
- `@nestjs/config@4.0.4` retrofit incrementale (solo nuovi moduli, legacy `process.env` invariato)
- Helper utility estratti per testability: `apps/api/src/throttler/utils/jwt-decode.util.ts` (`extractSubFromAuthHeader`) + `skip-if-metadata.util.ts` (higher-order builder)
- 17 nuovi test Vitest (8 LockoutService + 9 throttler helpers) → **25/25 totali PASS** (~681ms), zero regression
- `docker-compose.dev.yml`: port mapping `127.0.0.1:6379:6379` per ts-node-dev sull'host (simmetrico Postgres)

**Smoke E2E verificati (A-H, 8/8)**:

| # | Scenario | Verdetto |
|---|---|---|
| A | Rate-limit `/auth/login`: 5x 401 + 6° 429 | ✅ |
| B | Rate-limit `/auth/login-pin`: 5x 401 + 6° 429 (bucket distinto per route) | ✅ |
| C | Custom tracker `tenant-create`: 3x 400 + 4° 429, Redis key `user:019e1e40-...` via JWT decode (NON IP fallback) | ✅ |
| D | Cross-endpoint isolation: `/health` 200 dopo lockout `/auth/login` | ✅ |
| E | Lockout `/auth/login` (THRESHOLD=3 temp): 2x 401 + 3° 429 promosso in-flight + 4°+ `Retry-After: 900` + audit `auth.account_locked` | ✅ |
| F | Reset doppio: 2 fail → ZCARD=2 + DB counter=2 → login OK → ZCARD=0 + DB counter=0 | ✅ |
| G | Lockout `/auth/login-pin`: key `pin:tenant:<uuid>:device:smoke-pin-device` + NO DB counter increment (D2b §8 carry-over confermato) | ✅ |
| H | Key isolation: A blocked, B (email diversa) → 401 NOT 429 | ✅ |

**Empirical discoveries (#16-21, +6 cumulative → totale 21)**:

- **#16** Throttler v6 named throttlers globali by default (fix: skipIf metadata opt-in pattern)
- **#17** Container Redis docker-compose non host-exposed di default (fix: `ports: ['127.0.0.1:6379:6379']`)
- **#18** `req.user` undefined in APP_GUARD ThrottlerGuard (pre-JwtAuthGuard ordering) — fix: JWT decode minimale Authorization header (no verify)
- **#19** `@nestjs/throttler@6.5.0` `getTracker(req)` single-arg (no context) — fix: override `handleRequest(requestProps)` con `customGetTracker` wrappato
- **#20** `BaseExceptionFilter` APP_FILTER DI break con custom constructor → omettere constructor (NestJS risolve HttpAdapterHost automaticamente)
- **#21** `ValidationPipe` filtra PRE-controller → lockout counter non incrementato per input malformati (validation errors non consumano bucket; attacker con password ben formata sì)

**Tech debt nuovi (14 voci TD-A → TD-N)** — vedi [ADR-0013](docs/architecture/ADR-0013-auth-e2e-hardening-b1.md):

Categorie: Redis resilience (TD-A,B), Config consistency (TD-C), Docker port (TD-D), Security trade-off (TD-E,J), Throttler quirks (TD-F,G), Lockout key scope (TD-H,I,K), Filter pattern (TD-L), Test coverage (TD-M), Refactor minor (TD-N).

## 🚧 In corso / Prossimo task

**Macro-task: da concordare nella prossima sessione.**

Candidate (in ordine di priorità suggerito, da validare con Nicolò all'apertura della prossima sessione):

1. **B2 — Auth E2E hardening parte 2** (carry-over B1): email notification on theft + account_locked (`nodemailer` + MailHog dev MTA), rate-limit `/auth/login-pin` per `(tenantId, deviceId, ip)` triplet (D2b §8 carry-over completo), E2E test full Nest bootstrap (primo del progetto) con Testcontainers Postgres + Redis reale, verify TD-B empiricamente (Redis down mid-request behaviour). Stima 3-4h.
2. **Multi-tenant tenant slug resolution** (TD-2 ADR-0012) — subdomain detection OR path-based OR query param per superare hardcoded `'demo'`. Sblocca TD-H lockout key per-tenant. Stima 1-2h.
3. **Setup Playwright E2E frontend CI** (TD-4 ADR-0012) — Playwright + 5-10 test E2E (login flow, dashboard, logout) + GitHub Actions integration. Stima 3-4h.
4. **RBAC enforcement** — Guard generico `@RequirePermissions('code1', 'code2')` + `PermissionsGuard` quando F1 avra' 10+ endpoint protetti da permission diverse (vedi ADR-0010 tech debt #3).
5. **`withSystemContextRaw` helper** — fix proper F3 D4 (forceDelete + RLS bypass). ~30 LOC in rls.ts + smoke verify. Bassa priorita' finche' raw ops in withSystemContext sono ops one-shot.
6. **Miglioramento pre-push hook** — parsing stdin formato git pre-push per distinguere push regolari da delete. Stima: 15-20 min.
7. **Dependabot / Renovate** — security updates automatici dipendenze. Stima: 20-30 min.

### Owner: Claude Code in VS Code Remote-SSH (con stop intermedi a Nicolò)

### Preparazioni manuali a carico di Nicolò prima di partire

(Nessuna preparazione bloccante. Branch protection lato server resta non-enforced finché non si valuta upgrade Team — non blocca lo sviluppo.)

---

## 📋 Da fare prossimamente (dopo questo macro-task)

### Cleanup e formalizzazione
- [ ] **Rimuovere `/etc/sudoers.d/deploy-setup`** (NOPASSWD setup temporaneo) — la condizione "primo `docker compose up` funzionante" è ora soddisfatta (smoke test verdi il 2026-05-11 sera), quindi è il momento giusto. Operazione manuale di Nicolò (richiede password sudo). Comando: `sudo rm /etc/sudoers.d/deploy-setup` poi verifica `sudo -l` per confermare che NOPASSWD su apt/sysctl/systemctl non sia più presente.
- [ ] ADR successivo (ADR-0005+) per strategia ACME quando arriverà un dominio reale (backup `caddy_data`, DNS vs HTTP challenge, wildcard policy)

### Tech debt esplicito (NestJS scaffold D1 + E1 + E2)

Tracking accentrato delle course corrections. Dettagli in [ADR-0007](docs/architecture/ADR-0007-nestjs-api-scaffold.md) + [ADR-0011](docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md) + [ADR-0012](docs/architecture/ADR-0012-frontend-auth-flow.md).

- [x] ~~**CC2 — CJS/ESM strategy re-evaluation**~~ — **RISOLTO 2026-05-13 (E1, ADR-0011)** via dual package strategy: `packages/db` torna ESM-native + `tsup` build step + `exports` conditional. apps/api consuma `dist/index.cjs` (zero modifiche), apps/web `dist/index.mjs`.
- [ ] **CC1 — ts-node-dev → swc-node migration**: `ts-node-dev` v2.0.0 (~2022) è "stale repo". CC2 risolto ha abilitato in linea di principio anche la migration dev runner (con build step packages/db ora c'è). Re-evaluation differita, low priority finché ts-node-dev resta operativo. Workaround disponibili: loader Node `@swc-node/register` con nodemon, TS Project References (ADR-0006 opzione c). Monitor maintenance status ogni 6 mesi.
- [ ] **TD-1 ADR-0011 — Tailwind 3.4 → 4 migration**: ecosystem (shadcn registry, plugin) in transizione. Trigger: shadcn registry T4 completa + T4 plugins ecosystem maturo. Stima 2-3h.
- [ ] **TD-2 ADR-0011 — React 18.3 → 19 migration**: ecosystem libs in assorbimento, peer dep warnings residui. Trigger: Radix+shadcn 100% R19 validato. Stima 1-2h.
- [ ] **TD-3 ADR-0011 — TypeScript 7.0 baseUrl deprecation**: carry-over da `tsconfig.base.json` (NON introdotto da E1). Trigger: bump TS a 7.0 (Q3 2026). Stima 30-45 min, migration meccanica a paths self-contained.
- [ ] **TD-4 ADR-0011 — packages/db source-vs-dist asymmetry**: apps/api typecheck via src/, apps/web via dist/. Funziona oggi (2 consumer). Trigger: arrivo 3° workspace consumer (apps/kds probabile). Stima 30-60 min, decisione strategica "always-dist" vs "always-src".
- [ ] **TD-5 ADR-0011 — shadcn manual scaffold update path**: 5 file shadcn scritti a mano in E1 (F4 discovery). Trigger: shadcn 5.x opt-out T3 flag OR breaking changes registry da prendere. Monitor CHANGELOG ogni 6 mesi.
- [ ] **TD-1 ADR-0012 — Migration localStorage → httpOnly cookie**: JWT in localStorage XSS surface. Trigger: ANY production deployment OR introduction sensitive features (financial transactions, multi-user concurrent). Stima ~1.5h (backend cookie middleware + CSRF endpoint + frontend `credentials: 'include'`). `credentials: true` già in CORS config (E2 ready).
- [ ] **TD-2 ADR-0012 — Multi-tenant tenant slug resolution**: oggi `TENANT_SLUG = 'demo'` hardcoded in `LoginPage`. Trigger: 2° tenant deve loggarsi via browser. Stima 1-2h. Opzioni: subdomain (`demo.gestionale.local`) OR path (`/t/demo/login`) OR query param.
- [ ] **TD-3 ADR-0012 — Auto-refresh token prima scadenza**: access token 15min, user re-login forzato. Trigger: feedback UX "sessione scade durante uso". Stima ~1h. Pattern setInterval 14min + refresh in background + edge case tab inactive + multi-tab sync.
- [ ] **TD-4 ADR-0012 — Setup Playwright E2E frontend CI**: oggi smoke browser manual Nicolò (no regression visiva auto-caught). Trigger: prima regression visiva non catturata da test unit OR 2° pagina critical. Stima 3-4h (Playwright + 5-10 test E2E + GitHub Actions).
- [ ] **TD-5 ADR-0012 — shadcn CLI output cleanup pattern**: `shadcn add` può generare file che violano lint rules monorepo (E2 F2: 1 char `import type`). Trigger: ogni nuovo component. Stima 5-10 min per component. Memo CHANGELOG monitor.
- [x] ~~**TD-6 ADR-0012 (backend) — Logout server-side via /auth/logout**~~: **RISOLTO 2026-05-13** in questa PR. Frontend handleLogout async chiama POST /auth/logout PRE clearTokens + always-executed clearTokens su error (silent log) + loading state UX. Discovery collaterale: apiPost lib 204 No Content handling fix (+3 LOC riusabile per DELETE F1). Vedi [ADR-0012 sezione TD-6 Resolution](./docs/architecture/ADR-0012-frontend-auth-flow.md).

### Qualità codice / processo (post Husky setup + typecheck monorepo)
- [x] ~~**Strategia typecheck monorepo**~~ — RISOLTO 2026-05-13 (Macro-task C, ADR-0006). `pnpm typecheck` ora propaga via Turbo a tutti i workspace, CI valida `packages/db` e futuri.
- [ ] **Cache Turbo in CI** via `actions/cache` su `.turbo/`: quando CI diventerà bottleneck (oggi ~30s adeguato, niente di urgente). Beneficio atteso: skip ricalcolo typecheck/lint per file invariati. Stima: 15 min.
- [ ] **TS Project References nel root `tsconfig.json`**: quando avremo 5+ workspace o quando il typecheck cross-package supererà 10-15s, valutare migrazione a `composite: true` per build incrementale. Vedi ADR-0006 sezione "Considered Alternatives" punto (c).
- [ ] **Miglioramento pre-push hook**: parsing stdin formato git pre-push per distinguere push regolari da delete (`local-sha == 0000...` indica delete). Elimina la necessità di `--no-verify` per cancellazioni remote legittime di branch diverso da `main` quando ci si trova su `main`. Vedi commit body PR #2 per dettagli edge case.
- [ ] **Branch protection lato server**: attualmente Rulesets su GitHub Free **non enforced**. Decisione di rivalutarli solo se: (a) si passa a Team account ($4/mese — non giustificato per single-dev), oppure (b) il progetto diventa multi-developer. Fino ad allora, protezione affidata a pre-push hook (ADR-0004).
- [ ] **PR template completo** secondo §C12 brief (test, docs, migrazione DB, breaking changes, impatto API pubbliche, token AI usage, impatto feature flag) — da espandere quando arriverà codice F1.
- [ ] **Dependabot / Renovate** per security updates automatici delle dipendenze (vedi §C5 brief "Dipendenze monitorate"). Configurazione `.github/dependabot.yml` quando ci sarà più superficie da monitorare.
- [ ] **Migration config Prisma 7**: spostare `"prisma"` config da `package.json` a `prisma.config.ts` quando upgraderemo Node a 20.19+ (oggi pin `.nvmrc` a 20.18.1) → Prisma 7. Deprecation warning attualmente visibile su `prisma db seed`. Non blocca, migration meccanica.

### Operazioni manuali ricorrenti
- Cancellare a mano eventuali branch `revert-*` orfani via `git push origin --delete <branch>` se accidentali in futuro (UI GitHub "Revert" crea sempre la branch anche se non si conferma la PR di revert).

### Verso F1 (Core Operativo MVP)
- [x] ~~Schema Prisma base (Tenant, Sede, User, Role, Permission, AuditLog) con RLS PostgreSQL~~ — completato 2026-05-12 (Macro-task A)
- [x] ~~Seed system_role_templates + permission catalog~~ — completato 2026-05-12 (Macro-task B: 32 permessi + 6 templates + 104 mappings)
- [x] ~~Soft-delete extension Prisma client + helper `uuidv7` wrapper esportato~~ — completato 2026-05-12 (Macro-task B: 5 scenari smoke verdi)
- [ ] **Scaffold NestJS** `apps/api` consumer di `@gestionale/db` (prossimo macro-task)
- [ ] **Middleware tenant context** NestJS: `SET app.tenant_id` su transaction Prisma per attivare RLS reale
- [ ] **Sostituzione policy RLS** `USING (true)` con check reali (3 pattern in ADR-0005) — sub-task del precedente
- [ ] **Bootstrap tenant logic**: clone `system_role_templates` (`isDefault: true`) → `roles` con `tenant_id` reale + copia mapping `system_role_template_permissions` → `role_permissions`
- [x] ~~**Auth backend NestJS — email/password + JWT + refresh rotation + /me**~~ — completato 2026-05-13 notte (D2a, ADR-0008). 6 endpoint, smoke 10/10 verdi, admin@demo.local seedato
- [x] ~~**D2-vitest: Vitest 3 baseline + 4 test AuthService + theft detection FULL**~~ — completato 2026-05-13 notte tardi (E2E theft verificato: revoke all + audit forense)
- [ ] **D2b PIN POS**: `/auth/pin-setup` + `/auth/login-pin` + uniqueness applicativa + 2 test PIN
- [ ] Valutare RLS su `role_permissions` con `EXISTS` join (defense-in-depth, vedi ADR-0005 follow-up)
- [ ] UI shell Next.js (layout, theme, i18n setup IT primary + EN secondary)
- [ ] Mappa tavoli editor + viewer (drag&drop, 6 tipi, 7 stati)
- [ ] Menu CRUD + listini multipli
- [ ] Comande PWA cameriere (offline-first con IndexedDB)
- [ ] Cassa + driver Epson FP F1 (stub iniziale)
- [ ] KDS app (Kitchen Display System)
- [ ] Sito vetrina + prenotazioni online
- [ ] Dashboard widget + report base
- [ ] AI Assistant Claude API integration
- [ ] (...continua secondo sezione D del brief)

### Predisposizioni [PRE] da considerare nello scaffold
- Vedere sezione A5 del PROJECT_BRIEF.md per la lista completa
- In particolare durante setup monorepo: feature flag, audit log, RLS, i18n, plugin/webhook hooks

---

## 🔄 Workflow operativo correnti

### Esecuzione comandi

| Categoria | Chi esegue |
|---|---|
| `sudo apt`, `apt-get`, `sysctl`, `systemctl` | Claude Code (NOPASSWD) |
| `sudo` su altri binari (chmod, install, tee, usermod, docker con sudo) | Nicolò (digita password) |
| `docker` senza sudo (grazie a gruppo docker) | Claude Code |
| File operations (create, edit, mkdir) | Claude Code |
| Operazioni manuali web (GitHub, Hetzner UI, DNS) | Nicolò |
| Decisioni architetturali ambigue | Claude strategico in chat web |

### Convenzioni file/cartelle
- Tutto sotto `/home/deploy/projects/gestionale/`
- Configurazioni globali macchina sotto `/etc/` (sysctl, fail2ban, ssh, docker)
- Documenti di processo (questo) in root del progetto
- Documenti architetturali in `docs/architecture/`

### Convenzioni Git
- Branch principale: `main`
- Commit message: convenzione [Conventional Commits](https://www.conventionalcommits.org/)
  - `chore:` setup, dipendenze, config
  - `feat:` nuova feature
  - `fix:` bug fix
  - `docs:` documentazione
  - `refactor:` ristrutturazione senza cambio comportamento
  - `test:` aggiunta/modifica test
  - `ci:` pipeline CI/CD

---

## 📓 Incidents log / Lezioni operative

Sezione viva. Registra incidenti, near-miss e lezioni che vale la pena ricordare per evitare di rifare gli stessi errori.

### 2026-05-12 — Commit empty `2151e4f` pushato accidentalmente su `main` durante test hardening Husky

**Cosa è successo.** Durante il setup di Husky (macro-task "Husky + lint-staged + commitlint"), nello specifico durante una variante di test del pre-push hook su `main`, ho fatto:

```
git stash --include-untracked   # libera il WT per checkout pulito a main
git checkout main
git commit --allow-empty -m "chore: hardening test pre-push block"
git push origin main            # atteso BLOCK del pre-push hook
```

Il push **non è stato bloccato** ed è atterrato come commit `2151e4f` su `origin/main`.

**Causa root.** `git stash --include-untracked` ha stashato anche i file `.husky/*` perché in quel momento erano **untracked** (non ancora committati nella feature branch in corso). Con `.husky/pre-commit`, `.husky/commit-msg`, `.husky/pre-push` rimossi dal working tree, Husky 9 (che routa via `core.hooksPath = .husky/_/` con proxy verso `.husky/<hook>`) non ha trovato gli script utente e ha eseguito un **no-op silenzioso**. Niente blocco del commit-msg, niente blocco del pre-push.

**Decisione.** **Nessun force-push di rollback** su `origin/main`. Il commit `2151e4f` rimane in storia come monito permanente. Razionale:

1. **Disciplina ferrea "`main` never force-pushed"** — fare un'eccezione anche per buona ragione apre un precedente
2. **Lezione formativa al diritto**: il commit resta visibile per ricordare la lezione
3. Funzionalmente innocuo (empty commit, non rompe nulla in CI o nello stato del codice)
4. Costo del force-push (`--no-verify` del nostro pre-push hook, precedente di disciplina) > beneficio (pulizia estetica di 1 commit)

**Lezioni.**

1. **Mai stashare untracked quando dipendi dagli hook**. Prima di test che richiedono hook attivi: o committa gli hook prima (anche temporaneamente), o usa `git stash` (default, solo tracked) senza `--include-untracked`. In generale: stash `--include-untracked` è una forma di "disabilitazione silenziosa" di tutto ciò che non è ancora committato — pericoloso quando include codice di sicurezza.
2. **Setup `Husky 9 = .husky/_` proxy fallisce silently** se gli script `.husky/<hook>` non esistono. Comportamento documentato ma controintuitivo: invece di error "hook not found", proxy esegue no-op. Importante saperlo perché può mascherare hook disattivati.
3. **Test che dipendono da effetti su `origin/main` devono essere fatti con doppio gate**: hook attivo + autorizzazione esplicita dell'owner. Non fare test pre-push su `main` in modalità auto senza fermarsi a verificare lo stato degli hook prima.

### 2026-05-12 — PR #2 (`feat: husky...`) mergiata con CI rossa

**Cosa è successo.** Subito dopo la fase di hardening dei hook, ho fatto squash merge della PR #2 (`feat: add husky + lint-staged + commitlint with pre-push main protection`) sul branch `main`. La CI del commit di merge era **rossa**: ESLint si lamentava di `commitlint.config.cjs`:

```
error  'module' is not defined  no-undef
```

**Causa root.** ESLint 9 con flat config applica per default `sourceType: 'module'` a tutti i file, incluso `.cjs`. In ambiente ESM la global `module` non è definita, quindi la regola `no-undef` di `@eslint/js` segnala errore sui literal CommonJS. Il file `commitlint.config.cjs` era stato introdotto dalla PR #2 stessa e non era stato testato contro ESLint prima del merge (il pre-commit eseguiva lint-staged solo sui file in stage del commit, non sul repo intero).

**Decisione.** Fix in nuova PR #3 (`fix: configure ESLint flat config for .cjs files as CommonJS`) con override flat config:

```js
{
  files: ['**/*.cjs'],
  languageOptions: {
    sourceType: 'commonjs',
    globals: { module: 'readonly', require: 'readonly', __dirname: 'readonly', __filename: 'readonly', process: 'readonly' },
  },
},
```

Approccio "fix the root, not the symptom": i `.cjs` continuano a essere lintati, e l'override è riusabile per qualsiasi futuro `.cjs` di tooling. Alternativa scartata: aggiungere `commitlint.config.cjs` a `.eslintignore` (più rapido ma esclude da future regressioni). PR #3 mergiata → `38861e2` su main → CI verde ristabilita.

**Side effect del flusso.** GitHub UI "Revert" cliccato sulla PR #2 mergiata ha creato la branch remota `revert-2-feature/husky-lint-staged-commitlint` (banner "Compare & pull request"). La PR di revert non è stata aperta perché abbiamo deciso di andare avanti col fix. Branch orfana cancellata manualmente via `git push origin --delete revert-2-feature/...` durante chiusura macro-task.

**Lezioni.**

1. **Mai mergiare PR con CI rossa**, neanche per fretta. La protezione lato server non c'è (GitHub Free privato), quindi è disciplina umana: leggere lo stato CI prima del click "Squash and merge".
2. **Pre-commit `lint-staged` non sostituisce la CI**: `lint-staged` valida solo i file modificati nel commit. Se introduco un file nuovo (es. `commitlint.config.cjs`) che PASSA lint-staged ma rompe il lint globale su CI, il problema emerge solo a CI run completata. Pattern: dopo PR che introduce file di config, prevedere un giro locale `pnpm lint` completo prima del push.
3. **Il bottone "Revert" di GitHub crea branch anche se non si conferma la PR**: tracciarli e ripulirli manualmente, oppure ignorarli sapendo che è "branch in attesa di promozione a PR".

---

## 🧠 Note di contesto importanti

### Vincoli espliciti

- **NON andrà mai in produzione vera**: progetto di gioco/apprendimento
- **Niente utenti reali, niente dati reali, niente requisiti legali stringenti**: le note legali in brief sez. E sono "se andasse in produzione"
- Stack tecnico **vincolante** (non negoziabile): vedi A3 brief
- 25 blocchi funzionali approvati B1-B25 + scartati [BACKLOG] in sez. F

### Cose già scartate (in [BACKLOG] sezione F del brief)

NON proporre, NON includere senza esplicito sblocco:
- Modulo Retail integrato
- Computer Vision controllo piatti
- Voice ordering
- Benchmark anonimo tra tenant
- Plugin Marketplace pubblico (API/webhook interni sì, marketplace esterno no)

### Vincoli Nicolò (utente)

- Lavora in italiano
- IP dinamico, mobilità (no whitelist IP statico)
- Mac (BSD tools, differenze da GNU/Linux)
- Vuole imparare facendo + AI come copilot
- Preferisce procedere step-by-step con stop di conferma
- Quando AI propone qualcosa di security-sensitive o ampio, vuole revisione strategica prima di OK

---

## 📝 Prompt operativo prossimo task — da definire

> E2 completato (primo login browser funzionante, [ADR-0012](docs/architecture/ADR-0012-frontend-auth-flow.md)). Prossimo macro-task da concordare nella prossima sessione (candidate priorizzate in sezione "🚧 In corso").

---

## 📚 Riferimenti

- `PROJECT_BRIEF.md` — fonte di verità del progetto target
- `STARTER_PROMPT.md` — protocollo operativo Claude Code
- `PROGRESS.md` — questo file, stato corrente
