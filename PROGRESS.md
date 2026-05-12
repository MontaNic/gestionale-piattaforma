# PROGRESS.md — Stato del progetto Gestionale

> File vivente che documenta cosa è già fatto, cosa è in corso, cosa è ancora da fare.
> **Da leggere PRIMA del `PROJECT_BRIEF.md` per capire lo stato corrente.**
> Aggiornato dopo ogni macro-task completato.

**Ultimo aggiornamento:** 13 maggio 2026
**Fase corrente:** Monorepo + stack dev + CI/CD + Husky + Prisma data layer COMPLETO + **typecheck monorepo via Turbo** (CI ora valida tutti i workspace TS). Quality gates locali + safety net CI completi e propagati. Prossimo macro-task: **scaffold NestJS F1** (apps/api consumer di @gestionale/db, middleware tenant context, sostituzione policy RLS reali, auth module argon2+JWT).

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

---

## 🚧 In corso / Prossimo task

**Macro-task: da concordare nella prossima sessione.**

Candidate (in ordine di priorità suggerito, da validare con Nicolò all'apertura della prossima sessione):

1. **NestJS scaffold + auth + sostituzione policy RLS** (primario F1) — `apps/api`: scaffold NestJS consumer di `@gestionale/db`, middleware tenant context che fa `SET app.tenant_id` su transaction Prisma, sostituzione policy `USING (true)` con i 3 pattern reali (vedi ADR-0005), endpoint login email+password (argon2) + refresh token, PIN login per POS. Macro-task ampio. Vedi §D brief criteri F1.
2. **Bootstrap tenant logic** (parte di sopra o sub-task): clone `system_role_templates` (`isDefault: true`) → `roles` tenant-scoped con copia dei mapping a `role_permissions`, quando viene creato un nuovo tenant.
3. **Miglioramento pre-push hook** — parsing stdin formato git pre-push per distinguere push regolari da delete. Stima: 15-20 min.
4. **Dependabot / Renovate** — security updates automatici dipendenze. Stima: 20-30 min.

### Owner: Claude Code in VS Code Remote-SSH (con stop intermedi a Nicolò)

### Preparazioni manuali a carico di Nicolò prima di partire

(Nessuna preparazione bloccante. Branch protection lato server resta non-enforced finché non si valuta upgrade Team — non blocca lo sviluppo.)

---

## 📋 Da fare prossimamente (dopo questo macro-task)

### Cleanup e formalizzazione
- [ ] **Rimuovere `/etc/sudoers.d/deploy-setup`** (NOPASSWD setup temporaneo) — la condizione "primo `docker compose up` funzionante" è ora soddisfatta (smoke test verdi il 2026-05-11 sera), quindi è il momento giusto. Operazione manuale di Nicolò (richiede password sudo). Comando: `sudo rm /etc/sudoers.d/deploy-setup` poi verifica `sudo -l` per confermare che NOPASSWD su apt/sysctl/systemctl non sia più presente.
- [ ] ADR successivo (ADR-0005+) per strategia ACME quando arriverà un dominio reale (backup `caddy_data`, DNS vs HTTP challenge, wildcard policy)

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
- [ ] **Auth backend NestJS** (email+pwd argon2 + JWT 15min/7d rotation + PIN POS per cassieri/camerieri)
- [ ] **Primo Vitest setup** (in `packages/db` per test extension business logic, poi in `apps/api`)
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

> Il prompt operativo dettagliato per il prossimo macro-task (**setup CI/CD base con GitHub Actions**) verrà preparato da Nicolò all'apertura della prossima sessione. Il presente PROGRESS.md contiene già lo scope di alto livello nella sezione "🚧 In corso" sopra: Claude Code (sessione successiva) può partire da lì + lettura sezioni brief C7 (CI/CD) e C12 (convenzioni codice/branch).

---

## 📚 Riferimenti

- `PROJECT_BRIEF.md` — fonte di verità del progetto target
- `STARTER_PROMPT.md` — protocollo operativo Claude Code
- `PROGRESS.md` — questo file, stato corrente
