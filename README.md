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
pnpm install

# 2. Crea il file ambiente locale (la prima volta)
cp .env.example .env
# poi imposta i valori reali (in particolare POSTGRES_PASSWORD)

# 3. Avvia lo stack dati (Postgres + Redis + Caddy placeholder)
docker compose -f docker-compose.dev.yml up -d

# 4. Verifica che lo stack risponda
curl http://localhost:8080/   # atteso: "Gestionale - it works!"
```

Comandi disponibili oggi (root):

```bash
pnpm lint          # ESLint sull'intero repo (eslint .)
pnpm typecheck     # tsc --noEmit (root tsconfig solution-style, vuoto finché non ci sono workspace)
pnpm format:check  # Prettier --check (CI lo verifica)
pnpm format:write  # Prettier --write per allineare il repo
pnpm test          # placeholder finché non ci sono test (echo + exit 0)
```

Comandi predisposti via Turborepo (attivi quando esisteranno workspace in `apps/` o `packages/`):

```bash
pnpm dev          # turbo run dev
pnpm build        # turbo run build
```

Quando arriveranno i primi workspace, `lint` / `typecheck` / `test` torneranno a delegare via `turbo run` per beneficiare di cache e parallelismo.

## Convenzioni

- **Codice** in inglese, **UI** in italiano (vedi STARTER_PROMPT.md).
- **Commit message**: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`).
- **Branch**: `main` (stabile), `feature/*`, `fix/*`. PR via Squash and merge. Vedi [ADR-0002](./docs/architecture/ADR-0002-branching-strategy.md) (divergenza consapevole dal §C12 del brief).
- **Decisioni architetturali** documentate come ADR in `docs/architecture/`.

## Stato del progetto

Vedi [PROGRESS.md](./PROGRESS.md). Roadmap di alto livello in [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) sezione A5.
