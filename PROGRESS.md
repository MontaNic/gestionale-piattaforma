# PROGRESS.md — Stato del progetto Gestionale

> File vivente che documenta cosa è già fatto, cosa è in corso, cosa è ancora da fare.
> **Da leggere PRIMA del `PROJECT_BRIEF.md` per capire lo stato corrente.**
> Aggiornato dopo ogni macro-task completato.

**Ultimo aggiornamento:** 11 maggio 2026
**Fase corrente:** Setup infrastruttura completato, pronti per inizializzazione monorepo

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

### Decisioni prese durante setup (ADR informali, da formalizzare)

- **2026-05-11**: Hetzner CPX32 (non CPX31 deprecato)
- **2026-05-11**: Workflow Scenario B (VS Code Remote-SSH + Claude Code)
- **2026-05-11**: Niente dominio per ora, solo IP del server. SSL/dominio aggiunti in futuro quando serviranno (OAuth, PWA, ecc.)
- **2026-05-11**: Caddy come container in docker-compose, NON installato sull'host (coerente con A3 "tutto in docker")
- **2026-05-11**: Fail2ban con soglie tolleranti (vs. defaults aggressivi) per IP dinamico utente
- **2026-05-11**: Sudo NOPASSWD limitato a 4 binari (apt/apt-get/sysctl/systemctl), non whitelist ampia che Claude Code aveva proposto. Esclusi specificamente: docker, tee, install, chmod, usermod (richiedono password)
- **2026-05-11**: PROGRESS.md inizializzato dopo prima sessione di setup, sarà aggiornato dopo ogni macro-task

---

## 🚧 In corso / Prossimo task

**Macro-task: setup repository Git + struttura monorepo + primo docker-compose dev**

### Owner: Claude Code in VS Code Remote-SSH

### Stato preparazioni manuali Nicolò:

- [ ] Verifica `groups` include `docker` nella sessione VS Code corrente
- [ ] Verifica `docker ps` funziona senza errore permission denied
- [ ] Creato repository GitHub privato `gestionale-piattaforma`
  - Da fare: https://github.com → New repository → name `gestionale-piattaforma`, **Private**, no README/gitignore/license
- [ ] Annotato:
  - Username GitHub
  - Email account GitHub  
  - URL SSH: `git@github.com:USERNAME/gestionale-piattaforma.git`

### Task per Claude Code (vedere sotto "Prompt operativo prossimo task")

Sequenza:

1. **Git init + config locale + .gitignore + .gitattributes**
2. **SSH key dedicata server → GitHub** (`~/.ssh/id_ed25519_github`, configurata in `~/.ssh/config` server-side, caricata su GitHub come Deploy Key del repo con write access)
3. **git remote add origin** + branch main
4. **Struttura monorepo** (cartelle apps/packages/plugins/infra/docs/scripts/, package.json root, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .editorconfig, .prettierrc.json, .eslintrc.cjs, .nvmrc, README.md)
5. **ADR-0001-caddy-as-container.md** in docs/architecture/
6. **docker-compose.dev.yml** + Caddyfile + .env.example + .env (postgres:16-alpine + redis:7-alpine + caddy:2-alpine)
7. **Primo commit + push**
8. **Test `docker compose up -d`** + verifiche

Stop intermedi obbligatori: dopo step 2 (caricare SSH key su GitHub manualmente), dopo step 7 (review file prima commit), dopo step 8 (verifica container).

---

## 📋 Da fare prossimamente (dopo questo macro-task)

### Cleanup e formalizzazione
- [ ] **Rimuovere `/etc/sudoers.d/deploy-setup`** (NOPASSWD setup temporaneo)
- [ ] Aggiornare PROGRESS.md con lo stato del monorepo

### Verso F1 (Core Operativo MVP)
- [ ] Schema Prisma base (Tenant, Sede, User, Role, Permission, AuditLog) con RLS PostgreSQL
- [ ] Setup multi-tenancy nei middleware NestJS
- [ ] Auth backend NestJS (email+pwd + PIN operator)
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

## 📝 Prompt operativo prossimo task — da copiare a Claude Code

> Sostituire `[OUTPUT_GROUPS]`, `[OUTPUT_DOCKER_PS]`, `[USERNAME_GITHUB]`, `[EMAIL_GITHUB]` con valori reali prima di incollare.

```
=== STATO ATTUALE ===

Sono Nicolò. Stiamo lavorando sul progetto descritto in PROJECT_BRIEF.md, seguendo il protocollo STARTER_PROMPT.md. Lo stato corrente è documentato in PROGRESS.md - leggilo PRIMA del brief per orientarti.

Preparazioni manuali appena completate per il prossimo task:

1. Sessione VS Code Remote riavviata, gruppo docker attivo per deploy:
   $ groups
   [OUTPUT_GROUPS]
   $ docker ps
   [OUTPUT_DOCKER_PS]

2. Creato repository GitHub privato:
   - URL SSH: git@github.com:[USERNAME_GITHUB]/gestionale-piattaforma.git
   - Username GitHub: [USERNAME_GITHUB]
   - Email per commit: [EMAIL_GITHUB]
   - Repository vuoto (no README, no gitignore, no license)

3. Decisione dominio: NIENTE DOMINIO PER ORA - Caddy gira su porte custom (8080) + IP server, no SSL/Let's Encrypt finché non servirà.

=== TASK DI OGGI ===

Inizializza repository Git locale + setup struttura monorepo + primo docker-compose dev. A macro-step con stop intermedi.

STEP 1 - Git init + config locale + .gitignore + .gitattributes
- git init in ~/projects/gestionale/
- user.name e user.email LOCALI al repo (non globali)
- .gitignore: Node.js, Next.js, Turborepo, env, IDE, OS, log
- .gitattributes: LF line endings su file di codice

STEP 2 - SSH key dedicata server -> GitHub  
- ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_github (no passphrase)
- Aggiungi Host github.com a ~/.ssh/config sul server
- Mostra chiave pubblica (cat ~/.ssh/id_ed25519_github.pub)
- STOP: aspetta che io carichi la chiave su GitHub come "Deploy key" del repo (settings repo > Deploy keys > Add deploy key, write access)
- Test: ssh -T git@github.com -> "Hi USERNAME!"

STEP 3 - Collega repo locale a GitHub
- git remote add origin git@github.com:USERNAME/gestionale-piattaforma.git
- git branch -M main

STEP 4 - Struttura monorepo (sez. A4 brief)
- Cartelle: apps/, packages/, plugins/, infra/, docs/architecture/, docs/decisions/, scripts/
- package.json root con workspaces (pnpm)
- pnpm-workspace.yaml
- turbo.json minimale (configureremo dopo)
- tsconfig.base.json (TS strict + path aliases base)
- .editorconfig
- .prettierrc.json
- .eslintrc.cjs base TS strict
- .nvmrc con Node LTS 20.x (versione specifica)
- README.md base: descrizione, stack (cita brief A3), struttura, comandi placeholder

STEP 5 - ADR-0001 in docs/architecture/
- docs/architecture/ADR-0001-caddy-as-container.md
- Sezioni: Status, Context, Decision, Consequences, Considered Alternatives

STEP 6 - Primo docker-compose dev
- docker-compose.dev.yml in root
- postgres:16-alpine (volume, healthcheck, env password)
- redis:7-alpine (volume, AOF persistence)
- caddy:2-alpine (bind mount Caddyfile, 8080:80)
- Caddyfile minimale: ":80 { respond 'Gestionale - it works!' 200 }"
- Network: gestionale_network
- Volumes named: postgres_data, redis_data, caddy_data, caddy_config
- .env.example (committato, documentato)
- .env (NON committato, valori reali, POSTGRES_PASSWORD generata con openssl rand -base64 32)

STEP 7 - Primo commit + push
- git add -A
- git status
- STOP: mostrami file da committare per review
- git commit -m "chore: initial monorepo structure + dev docker-compose"
- git push -u origin main
- Verifica GitHub web

STEP 8 - Test docker compose
- docker compose -f docker-compose.dev.yml config (validazione)
- docker compose -f docker-compose.dev.yml up -d
- docker ps - 3 container running con healthcheck OK
- Test connessioni:
  - Postgres: docker exec gestionale_postgres psql -U postgres -c "SELECT version();"
  - Redis: docker exec gestionale_redis redis-cli ping (atteso PONG)
  - Caddy: curl http://localhost:8080/ (atteso "Gestionale - it works!")

=== PROTOCOLLO ===

1. Leggi PROGRESS.md (per stato corrente), poi sezioni rilevanti brief: A2, A3, A4, A5, C5, C8
2. Riassumi cosa hai capito
3. Elenca ambiguità (Node version esatto? prettier vs biome? eslint scope? naming convention volumes/network?)
4. Verifica [BACKLOG] sez. F non toccato
5. Piano per ogni STEP: file da creare/modificare + comandi da eseguire
6. Per ogni comando indica chi esegue: tu (NOPASSWD apt/sysctl/systemctl, docker senza sudo, file ops) o Nicolò (sudo fuori NOPASSWD, GitHub web)
7. ASPETTA OK su piano prima di eseguire

Stop obbligatori:
- Dopo STEP 2 (per caricare SSH key su GitHub manualmente)
- Dopo STEP 7 prima del commit (review file)
- Dopo STEP 8 (verifica finale)

Pronto. Mostrami il piano.
```

---

## 📚 Riferimenti

- `PROJECT_BRIEF.md` — fonte di verità del progetto target
- `STARTER_PROMPT.md` — protocollo operativo Claude Code
- `PROGRESS.md` — questo file, stato corrente
