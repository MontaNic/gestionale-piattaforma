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

Backend NestJS 11 (CommonJS) in [`apps/api/`](./apps/api/) — consumer di `@gestionale/db`. F1 scaffold con healthcheck; auth e business logic in macro-task successivi (D2/D3/D4).

```bash
# Dev server (ts-node-dev + watch + restart automatico)
pnpm --filter @gestionale/api dev

# Endpoint disponibili
curl http://localhost:3000/         # → "Gestionale API"
curl http://localhost:3000/health   # → {"status":"ok","db":"connected","timestamp":"..."}
```

`PORT` è letta da `.env` (default 3000). `DATABASE_URL` consumata via `DbService` (singleton Prisma client esteso, con lifecycle gestito da NestJS — `$connect` su startup, `$disconnect` su SIGTERM/SIGINT grazie a `app.enableShutdownHooks()`).

Healthcheck restituisce **HTTP 200** quando il DB ping (`SELECT 1`) riesce; **HTTP 503** (via `ServiceUnavailableException`) quando il DB è unreachable. Pattern production-ready per orchestrator (Kubernetes liveness/readiness, load balancer).

Razionale scaffold + 4 course corrections empiriche (tsx fail su decorator metadata, swc detour 13min, packages/db CJS tech debt, enableShutdownHooks): [ADR-0007](./docs/architecture/ADR-0007-nestjs-api-scaffold.md).

Comandi disponibili oggi (root):

```bash
pnpm lint          # ESLint su tutto il repo (eslint .)
pnpm typecheck     # turbo run typecheck → propaga ai workspace (@gestionale/db, @gestionale/api)
pnpm format:check  # Prettier --check (CI lo verifica)
pnpm format:write  # Prettier --write per allineare il repo
pnpm test          # placeholder finché non ci sono test (echo + exit 0)
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
