# 🎯 Gestionale

[![CI](https://github.com/MontaNic/gestionale-piattaforma/actions/workflows/ci.yml/badge.svg)](https://github.com/MontaNic/gestionale-piattaforma/actions/workflows/ci.yml)

Piattaforma SaaS modulare multi-tenant, AI-native ed estensibile per la gestione di esercizi della ristorazione.

> 📖 La fonte di verità del progetto è [PROJECT_BRIEF.md](./PROJECT_BRIEF.md).
> Lo stato corrente e la roadmap operativa sono in [PROGRESS.md](./PROGRESS.md).
> Il protocollo per le sessioni AI è in [STARTER_PROMPT.md](./STARTER_PROMPT.md).

## Stack

Vincolato dalla sezione A3 del brief.

| Layer                   | Tecnologia                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Frontend                | Next.js 14+ (App Router) · TypeScript · Tailwind · shadcn/ui                               |
| Backend                 | NestJS · TypeScript · Prisma                                                               |
| Database                | PostgreSQL 16+ (Row Level Security per multi-tenancy)                                      |
| Cache / Queue / Pub-Sub | Redis 7+                                                                                   |
| Real-time               | Socket.io                                                                                  |
| Storage file            | MinIO                                                                                      |
| Search                  | MeiliSearch                                                                                |
| Reverse proxy           | Caddy (in container — vedi [ADR-0001](./docs/architecture/ADR-0001-caddy-as-container.md)) |
| Container               | Docker · Docker Compose v2                                                                 |
| Feature flags           | Unleash (self-hosted)                                                                      |
| AI                      | Anthropic Claude API (via `packages/ai-tools`)                                             |
| Testing                 | Vitest · Jest · Playwright                                                                 |
| CI/CD                   | GitHub Actions                                                                             |

## Struttura monorepo

```
apps/         Applicazioni (web, api, kds) — Next.js / NestJS
packages/     Codice condiviso (ui, shared, fiscal-drivers, plugin-sdk, ai-tools, eslint-config)
plugins/      Plugin ufficiali sviluppati internamente
infra/        Dockerfile, compose, configurazioni Caddy
docs/         ADR (docs/architecture), decisioni di prodotto (docs/decisions), API, ai-prompts
scripts/      Script operativi (backup, migrazioni custom, ecc.)
```

Tooling: **pnpm workspaces** + **Turborepo**.

## Prerequisiti

- Node.js `20.18.1` (vedi `.nvmrc` — usa `nvm use` se hai nvm)
- pnpm `9.15.x` (vedi `packageManager` in `package.json` — abilita con `corepack enable`)
- Docker Engine ≥ 24 con Compose v2

## Sviluppo locale

```bash
# 1. Installa le dipendenze del monorepo
#    (lo script "prepare" attiva automaticamente gli hook Husky)
pnpm install

# 2. Crea il file ambiente locale (la prima volta)
cp .env.example .env
# poi imposta i valori reali (in particolare POSTGRES_PASSWORD)

# 3. Avvia lo stack dati (Postgres + Redis + Caddy placeholder)
docker compose -f docker-compose.dev.yml up -d

# 4. Verifica che lo stack risponda
curl http://localhost:8080/   # atteso: "Gestionale - it works!"
```

### Git hook attivi (Husky)

Dopo `pnpm install`, i seguenti hook girano automaticamente:

- **`pre-commit`** — `lint-staged` esegue `eslint --fix` + `prettier --write` sui soli file in stage (veloce, auto-fix dove possibile)
- **`commit-msg`** — `commitlint` valida il messaggio contro [Conventional Commits](https://www.conventionalcommits.org/); tipi accettati: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`
- **`pre-push`** — blocca i push diretti su `main` (compensa la mancata enforcement server-side su GitHub Free privato)

Razionale completo: [ADR-0004](./docs/architecture/ADR-0004-local-git-hooks.md). Bypass emergenza: `git push --no-verify`.

### Database layer (`packages/db`)

Schema multi-tenant, migrations, seed e Prisma client tipizzato (con soft-delete extension applicata) in [`packages/db/`](./packages/db/). `DATABASE_URL` è letta dal root `.env` (gli script `prisma:*`, `db:seed`, `smoke:*` usano `dotenv-cli` per puntarlo).

```bash
# Applica migrations pendenti (dev)
pnpm --filter @gestionale/db prisma:migrate:dev

# Stato delle migrations
pnpm --filter @gestionale/db prisma:migrate:status

# Rigenera Prisma Client (dopo modifica schema)
pnpm --filter @gestionale/db prisma:generate

# Esplora il DB in browser
pnpm --filter @gestionale/db prisma:studio

# Popola permission catalog + 6 system role templates (idempotente)
pnpm --filter @gestionale/db db:seed

# Validazione end-to-end soft-delete extension (5 scenari)
pnpm --filter @gestionale/db smoke:soft-delete
```

In dev il Postgres del compose espone `127.0.0.1:5432:5432` (localhost-only). L'API in container userà invece l'hostname `postgres` su `gestionale_network`. Razionale data layer: [ADR-0005](./docs/architecture/ADR-0005-prisma-data-layer.md).

**Uso da altri workspace** (api, web, worker future, script):

```ts
import { prisma, id, createPrismaClient } from '@gestionale/db';

// Singleton (per script seed/smoke/utility):
const tenant = await prisma.tenant.create({ data: { id: id(), name: '...', slug: '...' } });

// Factory (per NestJS DI / test isolati):
const client = createPrismaClient();
```

`id()` genera UUID v7 (obbligatorio in ogni `create()` perché lo schema non ha `@default`). La soft-delete extension è applicata automaticamente: `find*` e `count` escludono i record con `deletedAt != null` by default; pass `where: { deletedAt: ... }` esplicito per query del "cestino"; `prisma.<model>.forceDelete({ id })` per hard-delete intenzionale (GDPR/cleanup).

Al bootstrap del primo tenant (logica F1 NestJS), i 6 `system_role_templates` con `isDefault: true` saranno clonati come `roles` con il `tenant_id` reale (più copia dei mapping permission).

### API server (`apps/api`)

Backend NestJS 11 (CommonJS) in [`apps/api/`](./apps/api/) — consumer di `@gestionale/db`. F1 scaffold con healthcheck + auth module completo: email/password + JWT + refresh rotation + theft detection (D2a + D2-vitest) e **PIN POS login** (D2b).

```bash
# Dev server (ts-node-dev + watch + restart automatico)
pnpm --filter @gestionale/api dev

# Endpoint pubblici
curl http://localhost:3000/api/v1/                # → "Gestionale API"
curl http://localhost:3000/api/v1/health          # → {"status":"ok","db":"connected","timestamp":"..."}

# Login (admin@demo.local seedato via NODE_ENV != production)
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "X-Tenant-Slug: demo" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.local","password":"Admin123!"}'
# → {"data":{"accessToken":"...","refreshToken":"...","expiresIn":900}}

# Endpoint protetti (Authorization: Bearer <access>)
curl http://localhost:3000/api/v1/me -H "Authorization: Bearer $ACCESS"
# → {"data":{"user":{...},"roles":[...],"permissions":[...]}}

curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refresh-from-login>"}'
# → nuovi tokens, vecchia session disattivata

curl -X POST http://localhost:3000/api/v1/auth/logout -H "Authorization: Bearer $ACCESS"
# → HTTP 204
```

#### PIN POS login (D2b)

Flusso a 2 endpoint per terminali POS (tablet/desktop), separato dal login email/password:

```bash
# 1. Setup PIN (protected): re-auth via currentPassword + PIN 4-6 cifre non-pattern
curl -X POST http://localhost:3000/api/v1/auth/pin-setup \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Admin123!","pin":"4827"}'
# → {"data":{"success":true}}
# PIN proibiti (400 E_AUTH_PIN_FORBIDDEN_PATTERN): all-same (0000, 1111...) e sequenziali (1234, 4321...)

# 2. Login PIN (public, X-Tenant-Slug + device): emette JWT pair + session POS
curl -X POST http://localhost:3000/api/v1/auth/login-pin \
  -H "X-Tenant-Slug: demo" \
  -H "Content-Type: application/json" \
  -d '{"pin":"4827","deviceId":"tablet-01","deviceType":"pos_tablet"}'
# → {"data":{"accessToken":"...","refreshToken":"...","expiresIn":900}}
# deviceType ∈ {pos_tablet, pos_desktop, mobile} (no web)
```

Uniqueness PIN garantita lato applicazione via `argon2.verify` loop (il salt random di argon2id rende inutile un UNIQUE index su `pin_hash`). Vedi [ADR-0008 sezione D2b](./docs/architecture/ADR-0008-auth-module.md#d2b-implementation--pin-pos-login-2026-05-13-update) per decisioni e tech debt (HMAC lookup index in F2).

**Env vars** (`.env`):

- `PORT` (default 3000)
- `DATABASE_URL` (Prisma connection string)
- `JWT_SECRET` (HS256 secret, generato con `openssl rand -base64 48`)

**Pattern auth (vedi [ADR-0008](./docs/architecture/ADR-0008-auth-module.md))**:

- **Argon2id** per password e PIN POS
- **JWT HS256**: access 15min + refresh 7d, refresh rotation con session invalidation
- **JwtAuthGuard globale** security-by-default + `@Public()` opt-out
- **Tenant resolution**: header `X-Tenant-Slug` solo pre-auth (`/auth/login`, `/auth/login-pin`); post-auth tenantId dal JWT payload (anti-spoofing)
- **Sessioni stateful** in tabella `sessions` con lifecycle (refresh rotation → vecchia `is_active: false`, nuova creata)
- **Audit log** best-effort su login/logout in tabella `audit_logs`

Healthcheck restituisce **HTTP 200** quando il DB ping (`SELECT 1`) riesce; **HTTP 503** (via `ServiceUnavailableException`) quando il DB è unreachable. Pattern production-ready per orchestrator (Kubernetes liveness/readiness, load balancer).

Razionale scaffold + 4 course corrections empiriche (tsx fail su decorator metadata, swc detour 13min, packages/db CJS tech debt, enableShutdownHooks): [ADR-0007](./docs/architecture/ADR-0007-nestjs-api-scaffold.md).

### Testing (Vitest)

Vitest 3.2.4 con pattern `projects` array (Vitest 4-ready). Config in [`vitest.config.mts`](./vitest.config.mts) root + `apps/<workspace>/vitest.config.mts`.

```bash
# Tutti i test del monorepo (propaga via Turbo)
pnpm test

# Solo apps/api in watch mode
pnpm --filter @gestionale/api test:watch

# Coverage v8 (locale)
pnpm --filter @gestionale/api test:coverage
```

Pattern test attuale (D2-vitest): instanziazione manuale dei service NestJS con mock providers via `vi.fn()` (bypass DI container, vedi [ADR-0008](./docs/architecture/ADR-0008-auth-module.md) sezione "D2-vitest implementation"). E2E test (full Nest bootstrap + Testcontainers) in macro-task futuro.

Comandi disponibili oggi (root):

```bash
pnpm lint          # ESLint su tutto il repo (eslint .)
pnpm typecheck     # turbo run typecheck → propaga ai workspace (@gestionale/db, @gestionale/api)
pnpm format:check  # Prettier --check (CI lo verifica)
pnpm format:write  # Prettier --write per allineare il repo
pnpm test          # turbo run test → propaga ai workspace con spec files
pnpm dev           # turbo run dev (attivo quando un workspace ha script `dev`)
pnpm build         # turbo run build (per produzione futura)
```

## Convenzioni

- **Codice** in inglese, **UI** in italiano (vedi STARTER_PROMPT.md).
- **Commit message**: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`).
- **Branch**: `main` (stabile), `feature/*`, `fix/*`. PR via Squash and merge — push diretti su `main` bloccati lato locale dal pre-push hook (vedi [ADR-0002](./docs/architecture/ADR-0002-branching-strategy.md) e [ADR-0004](./docs/architecture/ADR-0004-local-git-hooks.md)).
- **Decisioni architetturali** documentate come ADR in `docs/architecture/`.

## Stato del progetto

Vedi [PROGRESS.md](./PROGRESS.md). Roadmap di alto livello in [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) sezione A5.
