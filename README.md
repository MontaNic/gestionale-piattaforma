# 🎯 Gestionale

[![CI](https://github.com/MontaNic/gestionale-piattaforma/actions/workflows/ci.yml/badge.svg)](https://github.com/MontaNic/gestionale-piattaforma/actions/workflows/ci.yml)

Piattaforma SaaS modulare multi-tenant, AI-native ed estensibile per la gestione di esercizi della ristorazione.

> 📖 La fonte di verità del progetto è [PROJECT_BRIEF.md](./PROJECT_BRIEF.md).
> Lo stato corrente e la roadmap operativa sono in [PROGRESS.md](./PROGRESS.md).
> Il protocollo per le sessioni AI è in [STARTER_PROMPT.md](./STARTER_PROMPT.md).

> ✅ **Primo login browser funzionante + Auth E2E hardening 100% completo (B1 + B2a + B2b).**
> Macro-task **D3a + D3b + D4 + E1 + E2 + B1 + B2a + B2b** completati: RLS attivo runtime, endpoint `POST /tenants` atomic con permission check `sistema.tenant.gestisci`, **apps/web Next.js 15 + Tailwind 3.4 + shadcn/ui** consumer di `@gestionale/db` via dual package exports, **frontend con `/login` + `/dashboard`** (primo login browser end-to-end), **rate limiting Redis (4 throttler) + account lockout sliding window + email notification Mailpit + per-tenant rate-limit `/auth/login-pin` + ThrottlerGuard fail-open verified Redis DOWN end-to-end** (TD-AD RESOLVED). **E2E test framework attivo** (`@testcontainers/postgresql` + `@testcontainers/redis` + supertest, Vitest projects array unit/e2e split). Cross-tenant lookup bloccato a livello DB, app role `gestionale_app` (NOSUPERUSER, NOBYPASSRLS), 10 endpoint operativi su `:3000`, **CORS abilitato**, frontend `:3001`. **29/29 test verdi** (25 unit + 4 e2e). Dettagli in [ADR-0009](./docs/architecture/ADR-0009-rls-real.md) (RLS) + [ADR-0010](./docs/architecture/ADR-0010-tenant-bootstrap.md) (tenant bootstrap) + [ADR-0011](./docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md) (dual package + Next.js scaffold) + [ADR-0012](./docs/architecture/ADR-0012-frontend-auth-flow.md) (frontend auth flow E2) + [ADR-0013](./docs/architecture/ADR-0013-auth-e2e-hardening-b1.md) (B1 rate limit + lockout) + [ADR-0014](./docs/architecture/ADR-0014-auth-e2e-hardening-b2a.md) (B2a email + login-pin per-tenant) + [ADR-0015](./docs/architecture/ADR-0015-auth-e2e-hardening-b2b.md) (B2b E2E + TD-AD fix).

## Stack

Vincolato dalla sezione A3 del brief.

| Layer                   | Tecnologia                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Frontend                | Next.js 15 (App Router) · React 18.3 · TypeScript · Tailwind 3.4 · shadcn/ui · react-hook-form · zod |
| Backend                 | NestJS · TypeScript · Prisma                                                                         |
| Database                | PostgreSQL 16+ (Row Level Security per multi-tenancy)                                                |
| Cache / Queue / Pub-Sub | Redis 7+                                                                                             |
| Real-time               | Socket.io                                                                                            |
| Storage file            | MinIO                                                                                                |
| Search                  | MeiliSearch                                                                                          |
| Reverse proxy           | Caddy (in container — vedi [ADR-0001](./docs/architecture/ADR-0001-caddy-as-container.md))           |
| Container               | Docker · Docker Compose v2                                                                           |
| Feature flags           | Unleash (self-hosted)                                                                                |
| AI                      | Anthropic Claude API (via `packages/ai-tools`)                                                       |
| Testing                 | Vitest · Jest · Playwright                                                                           |
| CI/CD                   | GitHub Actions                                                                                       |

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

Schema multi-tenant, migrations, seed e Prisma client tipizzato (con soft-delete + RLS extension applicate) in [`packages/db/`](./packages/db/). `DATABASE_URL` è letta dal root `.env` (gli script `prisma:*`, `db:seed`, `smoke:*` usano `dotenv-cli` per puntarlo).

Da E1 (2026-05-13) `packages/db` ha **build step via `tsup`** ([ADR-0011](./docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md)): emette `dist/index.{cjs,mjs,d.cts,d.ts}` con `exports` conditional. Consumer CJS (apps/api) carica `dist/index.cjs`, consumer ESM (apps/web, futuro worker/kds) carica `dist/index.mjs`. `pnpm --filter @gestionale/db build` produce gli artifact; Turbo `dependsOn: ["^build"]` orchestra la build automaticamente quando si lancia `pnpm dev` (root) o `pnpm exec turbo run dev --filter=<consumer>`.

#### Database setup (D3b RLS Active) — pattern dual-URL + post-migration password rotation

**Da fare UNA volta** quando arriva un nuovo dev clone o si deploya su un nuovo ambiente:

1. **Genera password app role**:
   ```bash
   echo "APP_DB_PASSWORD=$(openssl rand -base64 32)" >> .env
   ```
2. **Configura `DATABASE_URL` / `DIRECT_URL`** in `.env` (segui `.env.example`):
   - `DATABASE_URL`: connection string del role `gestionale_app` (runtime, NOSUPERUSER, NOBYPASSRLS). Password URL-encoded.
   - `DIRECT_URL`: connection string del role `postgres` (superuser, per migration + admin ops).
3. **Applica le migration**:
   ```bash
   pnpm --filter @gestionale/db prisma:migrate:deploy
   ```
   La migration `create_app_role_and_grants` crea il role `gestionale_app` con una password **placeholder non funzionale** (`'PLACEHOLDER_MUST_BE_ROTATED'`), perché il SQL committato non può contenere la password reale.
4. **Ruota la password al valore reale** (CRITICO — senza questo step, l'app non parte):
   ```bash
   psql "$DIRECT_URL" -c "ALTER ROLE gestionale_app PASSWORD '$APP_DB_PASSWORD'"
   ```
5. **Seed dati base** (idempotente):
   ```bash
   pnpm --filter @gestionale/db db:seed
   ```

Per fresh bootstrap docker (volume nuovo): lo script [`infra/postgres/init/01-create-app-role.sh`](./infra/postgres/init/01-create-app-role.sh) crea il role con la password reale da `$APP_DB_PASSWORD` al primo avvio del container, prima che la migration giri (l'`IF NOT EXISTS` la rende no-op). In quel caso lo step 4 è no-op.

Tech debt F2 documentata in [ADR-0009](./docs/architecture/ADR-0009-rls-real.md) sezione "Tech debt registrato": integrare secret manager (Vault / AWS Secrets Manager) per evitare il pattern placeholder-then-rotate in staging/prod.

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

#### Rate limiting & account lockout (B1 + B2a + B2b fail-open)

Difesa brute-force a 2 strati via Redis (vedi [ADR-0013](./docs/architecture/ADR-0013-auth-e2e-hardening-b1.md) + [ADR-0014](./docs/architecture/ADR-0014-auth-e2e-hardening-b2a.md) + [ADR-0015](./docs/architecture/ADR-0015-auth-e2e-hardening-b2b.md) per fail-open Redis DOWN):

**Strato 1 — Rate limiting** (`@nestjs/throttler` + Redis storage, 4 named throttlers env-driven):

| Throttler       | Soglia default | Endpoint                                                 | Tracker                                                  |
| --------------- | -------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `default`       | 60 req/min     | global fallback (tutti gli endpoint non opt-in)          | IP                                                       |
| `auth-strict`   | 5 req/min      | `/auth/login` (opt-in via `@AuthStrict()`)               | IP                                                       |
| `tenant-create` | 3 req/h        | `POST /tenants` (opt-in via `@TenantCreate()`)           | **userId** via JWT decode (fallback IP)                  |
| **`auth-pin`**  | **10 req/min** | **`/auth/login-pin` (opt-in via `@LoginPinThrottle()`)** | **`(tenantId, ip)` triplet (fallback `pin:unknown:ip`)** |

Custom tracker `userId` per `tenant-create` impedisce IP rotation di un attacker autenticato. Custom tracker `(tenantId, ip)` per `auth-pin` isola buckets tra tenant (smoke verificato: demo saturated, acme stessa IP NON bloccato). `deviceId` non incluso nel triplet → TD-Y per F1 PWA cameriere. Tuning via env: `THROTTLE_*_TTL_MS/LIMIT` (8 vars totali).

**Strato 2 — Account lockout** (`LockoutService` Redis sliding window):

- 10 tentativi falliti in 15min → blocco 15min (env: `LOCKOUT_THRESHOLD`, `LOCKOUT_WINDOW_MS`, `LOCKOUT_DURATION_MS`)
- Chiavi lockout: `email:<email>` per `/auth/login` (TD-H: per-tenant post multi-tenant slug), `pin:tenant:<tenantId>:device:<deviceId>` per `/auth/login-pin` (D2b §8)
- Check PRE-DB lookup (anti-timing-leak utenti esistenti vs non)
- `Retry-After: 900` **fissi** anti user-enumeration (TD-J)
- Audit `auth.account_locked` su transizione → locked (PII masked: `afterValue.lockoutKeyHash` = sha256[0:8])
- Reset doppio su success: Redis (`resetAttempts`) + DB (`users.failed_login_attempts: 0`)
- **Fail-open su Redis down** (TD-AD RESOLVED B2b, vedi [ADR-0015](./docs/architecture/ADR-0015-auth-e2e-hardening-b2b.md)): `AppThrottlerGuard.handleRequest` outer try/catch + `isRedisError` regex `/MaxRetriesPerRequestError|ECONNREFUSED|Redis|ioredis/i` → rate limit + lockout disattivati MA auth continua. Audit log Postgres traccia attempts. Pattern coerente con `LockoutService` fail-open (B1) e `MailService` fail-open (B2a). Verifica empirica integration test `td-ad-throttler-redis-down.e2e-spec.ts` (Redis container stop mid-test → request 201, NON 500).

```bash
# Esempio: lockout dopo N fail
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/v1/auth/login \
    -H "X-Tenant-Slug: demo" \
    -H "Content-Type: application/json" \
    -d '{"email":"victim@x.com","password":"WrongPass1!"}'
done
# 11° (post-lockout):
# HTTP/1.1 429 Too Many Requests
# Retry-After: 900
# {"statusCode":429,"code":"E_AUTH_ACCOUNT_LOCKED","message":"Account temporaneamente bloccato..."}
```

#### Email notifications (B2a)

Eventi security generano email notification automatica via `MailService` (vedi [ADR-0014](./docs/architecture/ADR-0014-auth-e2e-hardening-b2a.md)):

- **`[Gestionale] Account temporaneamente bloccato`** — 10 fail consecutivi su `/auth/login` → email all'utente legittimo con `identifierHash` + durata 15min + azioni raccomandate
- **`[Gestionale] Attività sospetta — sessioni revocate`** — refresh token reuse rilevato (theft detection D2-vitest) → email + count session revocate + IP/UA attaccante

**Stack**: `nodemailer@8.0.7` + [Mailpit](https://mailpit.axllent.org/) v1.30 (dev MTA in container — sostituisce MailHog abbandonato).

```bash
# Container già in docker-compose.dev.yml
docker compose -f docker-compose.dev.yml up -d mailpit
# Mailpit Web UI:  http://127.0.0.1:8025
# SMTP endpoint:   127.0.0.1:1025
# REST API:        http://127.0.0.1:8025/api/v1/messages
```

**Pattern fail-open layered**:

- `transporter.verify()` su `onModuleInit`: no-throw (log warn se SMTP down, app continua)
- `sendSafe()` wrapper privato: `try/catch` con `Promise<boolean>` return (audit flag `emailSent`)
- Email perduta ≠ auth bloccato (audit log Postgres è la fonte primaria di security signal)

**Content zero-PII**: solo `identifierHash` sha256[0:8] (pattern coerente audit log B1), IP, user-agent, count. MAI password/JWT/refresh-token/session-id plain.

**Production**: TD-Z provider esterno (Postmark / SES / Resend) — trigger production deploy. SMTP config via env: `SMTP_HOST/PORT/USER/PASS/FROM/SECURE`.

#### Tenant bootstrap (D4) — POST /tenants

Endpoint protetto per creare un nuovo tenant + bootstrap RBAC completo (vedi [ADR-0010](./docs/architecture/ADR-0010-tenant-bootstrap.md)). Richiede JWT valido + permission `sistema.tenant.gestisci` (Super Admin del proprio tenant ce l'ha by default — vedi seed).

```bash
# Login admin@demo (ha sistema.tenant.gestisci via Super Admin role)
ACCESS=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Slug: demo" \
  -d '{"email":"admin@demo.local","password":"Admin123!"}' | jq -r .data.accessToken)

# Crea nuovo tenant
curl -X POST http://localhost:3000/api/v1/tenants \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pizzeria Esempio",
    "slug": "pizzeria-esempio",
    "adminEmail": "admin@pizzeria.local",
    "adminPassword": "Esempio123!",
    "adminFirstName": "Mario",
    "adminLastName": "Rossi"
  }'
# → 201 + {data: {tenant, sede, admin, superAdminRole}}
```

Una singola chiamata bootstrap-a 8 entità atomic (tutto in 1 transaction Prisma via [`withSystemContextAtomicTx`](./docs/architecture/ADR-0009-rls-real.md#d3b--activation-completed-2026-05-13)):

1. Tenant (slug uniqueness check + create)
2. Sede default (`Sede Principale, Milano, 20100` se non override)
3. Admin user (argon2 hashed password)
4. Clone 6 `system_role_templates` → 6 roles tenant-scoped (Super Admin, Admin sede, Direzione, Cassiere, Cameriere, Cucina/Bar)
5. 104 role_permissions (32+31+24+10+4+3 cloned mappings)
6. Assignment admin → Super Admin tenant-wide (sede_id NULL)
7. Audit log `tenant.created` con `{slug, name, adminEmail}` (NO password)

Error codes: `401` (no JWT), `403 E_AUTH_INSUFFICIENT_PERMISSIONS`, `400 E_TENANT_SLUG_INVALID_FORMAT`/`E_TENANT_SLUG_RESERVED`, `409 E_TENANT_SLUG_EXISTS`.

Forbidden slugs (anti-collision route): `api, www, admin, system, app, public, static, health, auth, me, tenants`.

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

#### Multi-tenant isolation (D3a + D3b) — RLS Active

Multi-tenant isolation enforced runtime via PostgreSQL Row Level Security (vedi [ADR-0009](./docs/architecture/ADR-0009-rls-real.md)).

**Componenti applicativi (D3a)**:

- **AsyncLocalStorage context** (`packages/db/src/rls.ts`): ALS singleton + helpers `runInTenantContext`, `withSystemContext`, `withSuperAdminContext`. Propaga `(tenantId, isSuperAdmin)` lungo l'intera chain async.
- **Prisma extension RLS** (`rlsExtension`): wrappa ogni operazione model in `$transaction` interactive con `SET LOCAL app.tenant_id` + `SET LOCAL app.is_super_admin`. Fail-fast: throw `RLS_NO_CONTEXT` se la query parte fuori da context.
- **TenantContextInterceptor** (`apps/api/src/context/tenant-context.interceptor.ts`): globale post-JwtAuthGuard, wrappa handler in `runInTenantContext({tenantId: req.tenantId, isSuperAdmin: false})`. Skip per route Public senza tenant (root, /health, /auth/refresh).
- **TenantMiddleware** (refactor D3a): slug lookup in `withSystemContext`, dopo resolve `runInTenantContext(...)` per il resto della chain. Pre-auth routes (login, login-pin).
- **AuthService.refresh wrap**: `/auth/refresh` non passa per middleware tenant → wrap interno con tenantId dal payload JWT.
- **JwtStrategy.validate wrap** (post-D3a finding emerso a STEP 2 D3b): query Prisma dentro `validate()` runnano al guard stage, prima dell'Interceptor. Wrap in `runInTenantContext(payload.tenantId)` per defense in depth.

**Componenti DB (D3b)**:

- **App role** `gestionale_app` (NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT) usato come connection runtime.
- **Pattern dual-URL Prisma**: `DATABASE_URL` = app role (runtime), `DIRECT_URL` = postgres superuser (migration via `directUrl` in `schema.prisma`).
- **7 policy reali** `<table>_tenant_isolation` + `FORCE ROW LEVEL SECURITY` su 7 tabelle multi-tenant (tenants/sedi/users/roles/user_roles/sessions/audit_logs). Pattern: `is_super_admin OR tenant_id = current_setting(app.tenant_id)`. user_roles/sessions usano EXISTS join (no tenant_id diretta).
- **Bootstrap fresh volume**: `infra/postgres/init/01-create-app-role.sh` crea il role con password reale al primo avvio del container Postgres.

5 modalità di accesso DB (3 single-op + 2 atomic multi-statement, vedi ADR-0010 sezione "Discoveries F2" per il perché degli Atomic helpers):

| Modalità                  | Quando                                                           | Helper                                                         |
| ------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Tenant-scoped (99%)       | Request post-auth + pre-auth con tenant slug                     | `runInTenantContext({tenantId, false}, fn)`                    |
| System                    | Seed, jobs, bootstrap, health check, slug pre-tenant             | `withSystemContext(fn)`                                        |
| Super Admin cross-tenant  | Script ops manuali (no JWT-based super admin in F1, vedi ADR-S5) | `withSuperAdminContext(tenantId, fn)`                          |
| **System atomic tx (D4)** | Multi-statement atomic in system context (es. createTenant)      | `withSystemContextAtomicTx(prisma, async tx => ...)`           |
| **Tenant atomic tx (D4)** | Multi-statement atomic in tenant context (es. bulk update)       | `withTenantContextAtomicTx(prisma, tenantId, async tx => ...)` |

Gli Atomic helper sono necessari perché un `prisma.$transaction(async tx => ...)` esplicito **non e' atomico** quando le operazioni passano per l'extension RLS (l'extension auto-wrappa ogni op in un tx separato). Pattern: SET LOCAL una volta sull'inizio tx + `inflightStorage=true` guard previene re-wrap dell'extension. Vedi [ADR-0010 sezione "Discoveries F2"](./docs/architecture/ADR-0010-tenant-bootstrap.md#f2--transaction-esplicito-non-atomico-con-rls-extension).

Smoke E2E full (read-only, idempotente, riusabile per CI futura):

```bash
pnpm --filter @gestionale/db smoke:rls-e2e
```

7 scenari (5 mandatory + 2 extra coverage): tenant demo isolation, tenant acme isolation, cross-tenant block (UUID-known lookup → null), system bypass, super admin context, roles table isolation, audit_logs equivalence check.

**Caveat noti** (documentati in ADR-0009):

- `$queryRaw` / `$executeRawUnsafe` bypassano l'extension (intercetta solo model operations). Chiamanti devono usare `withSystemContext` o accettare bypass.
- D3a fix R3: `query(args)` dentro `$transaction` NON eredita il tx context. Workaround: `tx[model][operation](args)` + re-entrancy guard.
- La migration `create_app_role_and_grants` crea il role con placeholder password — `ALTER ROLE ... PASSWORD '$APP_DB_PASSWORD'` richiesto post-migration su ogni nuovo ambiente (vedi sezione "Database setup" sopra + ADR-0009 tech debt #8).

Healthcheck restituisce **HTTP 200** quando il DB ping (`SELECT 1`) riesce; **HTTP 503** (via `ServiceUnavailableException`) quando il DB è unreachable. Pattern production-ready per orchestrator (Kubernetes liveness/readiness, load balancer).

**CORS** (E2 fix, [ADR-0012](./docs/architecture/ADR-0012-frontend-auth-flow.md)): backend abilita CORS specifico via `CORS_ORIGIN` env var (default `http://localhost:3001`). Anti-pattern wildcard `*` evitato. `credentials: true` preparato per future httpOnly cookie migration (TD-1). Multi-origin futuro (es. apps/kds) tracciabile via array `[origin1, origin2]` o regex pattern.

Razionale scaffold + 4 course corrections empiriche (tsx fail su decorator metadata, swc detour 13min, packages/db CJS tech debt, enableShutdownHooks): [ADR-0007](./docs/architecture/ADR-0007-nestjs-api-scaffold.md). **Update E1**: CC2 (packages/db CJS forzato) risolto via dual package strategy — vedi [ADR-0011](./docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md).

### Frontend (`apps/web`)

Next.js 15 App Router + React 18.3 + Tailwind 3.4 + shadcn/ui. Scaffold E1 in [`apps/web/`](./apps/web/), consumer di `@gestionale/db` via **dual package exports** (CJS+ESM+DTS generato da `tsup` — vedi [ADR-0011](./docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md)).

```bash
# Dev server (via Turbo — auto-build packages/db prima di avviare Next)
pnpm exec turbo run dev --filter=@gestionale/web   # → http://localhost:3001

# Build production
pnpm --filter @gestionale/web build

# Typecheck
pnpm --filter @gestionale/web typecheck
```

A regime E1: home statica a `:3001` con `<h1>Gestionale Platform</h1>` + Button shadcn renderizzato (smoke visivo dell'integrazione Tailwind + shadcn). **E2** ha sostituito la home con redirect client-side + introdotto `/login` + `/dashboard`.

Stack version pinning + razionale (Tailwind 3.4 vs 4, React 18.3 vs 19, manual scaffold vs `create-next-app`): [ADR-0011 sezione Decisions](./docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md#decisions).

#### Login flow (E2 + TD-2 multi-tenant routing)

Primo flow end-to-end frontend↔API via browser. Stack: App Router pages + Next.js 15 middleware (multi-tenant routing path-based) + `react-hook-form` + `zod` + shadcn `Form` components + localStorage JWT storage (pragmatic, tech debt esplicito).

```bash
# Avvia entrambi i dev server (2 terminali OR pnpm dev root)
pnpm exec turbo run dev --filter=@gestionale/api    # → :3000
pnpm exec turbo run dev --filter=@gestionale/web    # → :3001

# Browser: http://localhost:3001 → redirect /t/demo/login (default tenant dev)
# Credenziali seedate D3b:
#   - admin@demo.local / Admin123!         → http://localhost:3001/t/demo/login
#   - manager@acme.local / Manager123!     → http://localhost:3001/t/acme/login
# Post-login: /t/<slug>/dashboard con Welcome <firstName> + permessi badge + logout button
```

**Multi-tenant routing path-based (TD-2 resolution, sessione 9)**:

- Pattern URL: `/t/<slug>/<page>` (es. `/t/demo/login`, `/t/acme/dashboard`)
- [`apps/web/src/middleware.ts`](./apps/web/src/middleware.ts) Next.js 15 edge-side: slug validation regex + `RESERVED_SLUGS` Set (coerente backend `FORBIDDEN_SLUGS` D4)
- Root `/` → redirect `/t/demo/login` (default tenant dev) — Server Component fallback + middleware edge
- Slug invalid (es. `INVALID-FOO` uppercase) o reserved (es. `api`, `admin`) → redirect `/not-found`
- Client components leggono slug runtime via `useParams<{slug:string}>()` (App Router idiomatic)
- API client [`apps/web/src/lib/api.ts`](./apps/web/src/lib/api.ts): `RequestOptions { tenantSlug?, accessToken? }` interface tipizzata. `tenantSlug` → header `X-Tenant-Slug`. Backend API contract INVARIATO.

Pattern struttura: 5 pages (`/`, `/not-found`, `/t/[slug]/login`, `/t/[slug]/dashboard`, root middleware) + 3 lib (`api.ts` API client typed con `ApiError` + `RequestOptions`, `auth.ts` token storage con SSR guards, `types.ts` matching empirico `/me` response). `router.replace`/`router.push` tenant-aware via template literal `/t/${tenantSlug}/<page>`. Error discrimination per `E_AUTH_INVALID_CREDENTIALS` → UX-friendly "Email o password non corrette".

Razionale completo: [ADR-0012](./docs/architecture/ADR-0012-frontend-auth-flow.md) — 6 decisioni E2 (localStorage vs cookie, RHF+zod, tenant slug hardcoded → **risolto TD-2**, pages structure, no auto-refresh, shadcn CLI add) + sezione **TD-2 Resolution** (path-based vs subdomain vs query param, smoke server-side 7/7), 5 discoveries (E2 + #31 Next.js dynamic segment shell escape), 7 tech debt (TD-1 → TD-7).

**Entrypoint dev — anti-pattern noto**: `pnpm --filter @gestionale/web dev` **bypassa Turbo** (chiama lo script direttamente, salta `dependsOn`). Se `packages/db/dist/` non esiste fallisce con `Cannot find module`. Usa sempre uno di questi due:

- `pnpm dev` (root, Turbo orchestra l'intera build chain dev di tutti i workspace)
- `pnpm exec turbo run dev --filter=<workspace>` (filtra a un workspace ma mantiene la chain)

Vedi [ADR-0011 Discoveries F2](./docs/architecture/ADR-0011-dual-package-strategy-and-nextjs-scaffold.md#f2--pnpm---filter-ws-script-bypassa-turbo-orchestration).

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

Pattern test attuale: unit test con istanziazione manuale dei service NestJS + mock providers via `vi.fn()` (bypass DI container, vedi [ADR-0008](./docs/architecture/ADR-0008-auth-module.md) sezione "D2-vitest implementation"). **E2E test framework attivo da B2b** (`apps/api/test/e2e/`).

### E2E tests (Testcontainers)

E2E test framework attivo da B2b (vedi [ADR-0015](./docs/architecture/ADR-0015-auth-e2e-hardening-b2b.md)). Vitest `projects` array separa **unit** (`src/**/*.spec.ts`, fast ~700ms) da **E2E** (`test/e2e/**/*.e2e-spec.ts`, slow ~13s con container start).

Stack: `supertest@7.x` + `@testcontainers/postgresql@11.x` + `@testcontainers/redis@11.x` + `pg@8.x` (raw SQL truncate/seed) + `unplugin-swc` + `@swc/core` (decoratorMetadata emit per NestJS DI). Container fresh per file test, `TRUNCATE` 11 tabelle `CASCADE` tra describe.

```bash
# E2E only (slow, ~13s con container start + Prisma migrate)
pnpm --filter @gestionale/api test:e2e

# Unit only (fast, ~700ms, no Docker)
pnpm --filter @gestionale/api test

# Entrambi
pnpm --filter @gestionale/api test:all
```

Helpers in [`apps/api/test/e2e/helpers/`](./apps/api/test/e2e/helpers/):

- `test-containers.ts` — `startTestContainers()` (Promise.all Postgres+Redis + Prisma migrate) + `stopTestContainers()`
- `test-app.ts` — `createTestApp()` (env override + lazy AppModule import) + `truncateDatabase()` + `seedMinimal()` (tenant demo + admin con argon2)
- `setup-env.ts` — env vars pre-import + `reflect-metadata` (necessario per `JWT_SECRET` letto top-level)

E2E test esistenti (B2b):

- `auth-login.e2e-spec.ts` (3 scenari: login OK, wrong password, no tenant header)
- `td-ad-throttler-redis-down.e2e-spec.ts` (1 scenario: `AppThrottlerGuard` fail-open Redis DOWN verified)

**Discoveries empiriche** (#27-30) + decisioni + tech debt: [ADR-0015](./docs/architecture/ADR-0015-auth-e2e-hardening-b2b.md). Nota: `@Inject(ClassName)` esplicito su 14 file production code (Discovery #29 permanente — TD-AE) come workaround Vitest+NestJS-DI gap.

### E2E tests frontend (Playwright)

E2E frontend attivi da TD-4 sessione 10 (vedi [ADR-0016](./docs/architecture/ADR-0016-playwright-e2e-frontend-ci.md)). Playwright 1.60.0 (Chromium + Firefox + WebKit). Multi-tenant fixture demo + acme via storage state pattern. 7 test E2E flow critici + 2 smoke.

Pre-requisiti dev locale:

```bash
# Browser binaries (~1.2GB in ~/.cache/ms-playwright, una tantum)
cd apps/web && pnpm exec playwright install

# Host system libs apt (Ubuntu 22.04 minimal, una tantum — Discovery #32)
sudo pnpm exec playwright install-deps
```

Stack dev up obbligatorio: `docker compose -f docker-compose.dev.yml up -d` + `pnpm dev` (background in tab dedicata) + `apps/web/.env.e2e` con credenziali seed (template `.env.e2e.example` committato).

```bash
cd apps/web
pnpm test:e2e:chromium   # Run Chromium (default, ~9s)
pnpm test:e2e:ui          # UI mode debug visivo (port forward Mac richiesto)
pnpm test:e2e:debug       # Debug step-by-step
pnpm test:e2e:report      # Apri ultimo HTML report
```

Files chiave: [`apps/web/e2e/auth.setup.ts`](./apps/web/e2e/auth.setup.ts) (login UI demo + acme → storage state `.auth/<slug>.json`), [`apps/web/e2e/specs/`](./apps/web/e2e/specs/) (7 spec + smoke), [`apps/web/playwright.config.ts`](./apps/web/playwright.config.ts) (4 projects: setup + chromium/firefox/webkit).

CI: job `e2e-playwright` in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) (container `mcr.microsoft.com/playwright:v1.60.0-jammy` + services Docker Postgres 16 / Redis 7 / Mailpit v1.30, Chromium-only default).

**Test outcomes**: Chromium 11/11 PASS in 9.4s + Firefox 5/5 PASS in 7.0s + WebKit 5/5 PASS in 7.2s.

**Discoveries empiriche** (#32-35) + 7 nuovi TD (TD-AJ → TD-AP) + TD-7 ADR-0012 update empirical evidence: [ADR-0016](./docs/architecture/ADR-0016-playwright-e2e-frontend-ci.md).

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
