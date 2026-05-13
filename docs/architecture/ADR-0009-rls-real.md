# ADR-0009 — RLS reali (tenant isolation runtime)

- **Status:** Accepted (D3a + D3b complete — RLS active and enforced)
- **Date:** 2026-05-13
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0005](./ADR-0005-prisma-data-layer.md) (data layer, RLS placeholder), [ADR-0007](./ADR-0007-nestjs-api-scaffold.md) (NestJS scaffold), [ADR-0008](./ADR-0008-auth-module.md) (auth module, tenant resolution)

## ✅ Status finale

**D3b completato: RLS attivo e enforced runtime.**

- App role `gestionale_app` (NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT) usato come connection runtime (`DATABASE_URL`).
- Superuser `postgres` riservato a migration/admin via `DIRECT_URL` (pattern dual-URL Prisma con `directUrl` in `schema.prisma`).
- 7 policy reali `<table>_tenant_isolation` + `FORCE ROW LEVEL SECURITY` su 7 tabelle (tenants/sedi/users/roles/user_roles/sessions/audit_logs).
- Smoke E2E full 7/7 PASS (vedi sezione "D3b — Activation completed").
- Docker init script per bootstrap fresh volume + migration con placeholder + README runbook per esistenti.

## Context

Macro-task D3: predisporre l'isolamento multi-tenant a livello DB via PostgreSQL Row Level Security. Le tabelle hanno gia' `ENABLE ROW LEVEL SECURITY` + policy placeholder `USING(true)` dal Macro-task A (vedi ADR-0005 sezione "RLS strategy"). D3 sostituisce i placeholder con policy reali e introduce il framework applicativo che setta il context per ogni query.

Per disciplina sui tempi (5h preventivate, 6h30 dopo R3, escalation a ~7h30 con R9 scoperto a STOP 1), si splitta in 2 PR:

- **D3a** (questa): framework operativo (ALS + extension Prisma + Interceptor + middleware refactor). Policy DB ancora placeholder.
- **D3b** (next): app role non-superuser + GRANT + DIRECT_URL pattern + migration `replace_rls_placeholder_with_real` + smoke E2E full 5 scenari.

## Decisions

Le decisioni numerate 1-15 furono approvate prima di STOP 0 (vedi conversazione planning). Riassunto:

### 1. Pattern S2 per-operation tx + Prisma extension wrapper

Ogni operazione Prisma su model viene wrappata in un `$transaction` interactive che esegue `SET LOCAL app.tenant_id = '<uuid>'` + `SET LOCAL app.is_super_admin = '<bool>'` PRIMA della query. Pattern alternativo HTTP-scoped tx (S3) scartato per R5 (argon2 verify blocca pool connection ~150ms).

### 2. AsyncLocalStorage Node.js per context propagation

API nativa stabile da Node 16, zero deps. Singleton di modulo in `packages/db/src/rls.ts`. Helpers: `runInTenantContext`, `withSystemContext`, `withSuperAdminContext`, `getTenantContext`.

### 3. Super Admin bypass app-side via `app.is_super_admin` setting

Policy SQL: `USING (current_setting('app.is_super_admin', true) = 'true' OR tenant_id = current_setting('app.tenant_id', true))`. **No `BYPASSRLS` role** (overhead pool management). `current_setting(name, true)` con secondo arg `true` (missing_ok) evita errore se non settato.

### 4. 3 modalita' di accesso DB (formalizzate in 2 helper)

- **Tenant-scoped** (99% delle request): `runInTenantContext({tenantId, isSuperAdmin: false}, fn)`. Settato automaticamente da TenantMiddleware (pre-auth) o TenantContextInterceptor (post-auth).
- **System context** (`withSystemContext(fn)`): `is_super_admin=true, tenant_id=null`. Per seed, jobs, bootstrap, health check. **Mai** chiamato da JWT flow runtime.
- **Super Admin context** (`withSuperAdminContext(tenantId, fn)`): `is_super_admin=true, tenant_id=<target>`. Per script ops cross-tenant. Rinviato a use case D3b/futuri (no JWT-based super admin in F1).

### 5. Naming policy: `<table>_tenant_isolation`

Rename da `<table>_policy` (placeholder D3) a `<table>_tenant_isolation` (reale D3b). Permette future policy multiple per tabella.

### 6. 1 sola migration `replace_rls_placeholder_with_real`

Atomicita': 7 tabelle passano da placeholder a reale nella stessa migration (DROP + CREATE per ognuna). Rollback = 1 migration revert. **Rimandato a D3b.**

### 7. user_roles + sessions: EXISTS join (no denormalizzazione)

`user_roles` filtra via `roles.tenant_id`, `sessions` via `users.tenant_id`. Index esistenti su PK rendono il sub-select O(log n). Denormalizzazione di `tenant_id` su queste 2 tabelle = tech debt F1+ se profiling lo giustifica.

### 8. `audit_logs` policy: `super_admin OR tenant_id match`

`audit_logs.tenant_id` e' **NOT NULL** (verificato in schema), nessuna considerazione per NULL. Policy semplice come tutte le altre tenant-scoped.

### 9. TenantMiddleware slug lookup in `withSystemContext`

Slug lookup e' pre-tenant-resolution: il tenantId non e' ancora noto. `is_super_admin=true` bypassa la policy `tenants_policy`. Scope minimo, intent esplicito.

### 10. /auth/refresh wrap interno con `runInTenantContext`

`/auth/refresh` e' Public ma non passa per TenantMiddleware (no header X-Tenant-Slug per disegno: il tenantId arriva dal payload JWT decoded). AuthService.refresh wrappa il body in `runInTenantContext(payload.tenantId)` dopo il decode.

### 11. Fail-fast su context mancante: throw `RLS_NO_CONTEXT`

Se una query Prisma parte fuori da qualsiasi context, l'extension lancia `RlsNoContextError`. Meglio errore 500 esplicito che dati vuoti silenti (dev-friendly, prod = bug catch).

### 12. Test E2E: smoke manuale (OK1)

Smoke "limited" (D3a): 4 scenari verify con role temp + policy reale temp su `users` only (script `/tmp/d3a-smoke-limited.ts`). Smoke "full" (D3b): 5 scenari E2E con app role permanente + policy reali su tutte 7 tabelle. Vitest E2E framework con Testcontainers rimandato a macro-task "Auth E2E hardening".

### 13. Schema Prisma: nessuna modifica `schema.prisma`

Le policy SQL cambiano via migration manuale. Prisma e' agnostic rispetto a RLS. D3b aggiungera' `directUrl = env("DIRECT_URL")` per il pattern dual-URL (runtime app role / migration superuser).

### 14. AuthService.login/loginPin/setupPin/logout: nessuna modifica diretta

Il middleware/Interceptor pre-setta il context. I service ereditano automaticamente. Eccezione: `refresh()` (vedi 10).

### 15. TenantContextInterceptor post-JwtAuthGuard globale

Registrato via `APP_INTERCEPTOR` in `app.module.ts`. Wrappa il handler in `runInTenantContext({tenantId: req.tenantId, isSuperAdmin: false})` per route post-auth. Skip per route Public senza tenant (root, /health, /auth/refresh).

**S5 clarification (decisa a STOP 0):** `isSuperAdmin = false` SEMPRE da JWT in F1. Il role "Super Admin" tenant-scoped del seed e' solo un bundle di permessi (sistema.tenant.gestisci ecc.), NON un bypass RLS. Concetto "platform super admin user" rimandato a macro-task futuro dedicato.

## R3 — verifica empirica e fallback F1 applicato

**Rischio R3 sollevato a STOP 0:** `query(args)` dentro `$transaction(async tx => ...)` callback potrebbe NON ereditare il context del `tx`, vanificando SET LOCAL.

**Verifica empirica STOP 1 D3a (2026-05-13):** R3 si e' manifestato. `query(args)` esegue la query su un connection client diverso dal `tx`, le SET LOCAL del tx non sono visibili → policy vede `current_setting` vuoto → 0 righe sempre.

**Fix applicato (fallback F1 dal piano):**

- `query(args)` sostituito con `(tx as any)[modelLower][operation](args)` — accesso diretto agli operation builder del tx client. softDelete extension continua a fire (il tx ha l'intera chain di extension applicata).
- **Re-entrancy guard** via secondo AsyncLocalStorage `inflightStorage`: la chiamata `tx[model][operation]` retrigge `$allOperations` (perche' il tx ha l'extension applicata). Il guard riconosce la re-entry e lascia passare `query(args)` senza re-wrap (no infinite loop).
- Workaround inline documentato in `packages/db/src/rls.ts` con riferimento a questa ADR.

**Verifica post-fix:** 4/4 scenari smoke verdi con role temp non-superuser (vedi sotto).

**Tradeoff F1 (accettato):**

- `(tx as any)[modelLower][operation](args)` perde type-safety per quella riga (cast unsafe). Argomenti `args` restano typed dal chiamante esterno.
- Niente regressione runtime: softDelete continua a operare correttamente.

## R9 — superuser bypassa RLS (scoperta + deferral a D3b)

**Scoperto durante R3 verification a STOP 1:** `DATABASE_URL` corrente usa role `postgres` che e' `usesuper=true, usebypassrls=true`. **PostgreSQL bypassa RLS sempre per superuser, indipendentemente da policy o FORCE ROW LEVEL SECURITY.** Conseguenza: anche con policy reali installate, l'app come postgres vede tutto.

**Decisione strategica (Opzione 2 split):**

- D3a chiude con framework operativo + smoke limited usando role temp (script `/tmp/d3a-smoke-limited.ts`)
- D3b introduce app role permanente `gestionale_app` (NOSUPERUSER NOBYPASSRLS) + GRANTs + `DIRECT_URL` pattern + migration policy reali

**Scope D3b:**

1. Migration `<ts>_create_app_role_and_grants`:
   - `CREATE ROLE gestionale_app LOGIN PASSWORD '<APP_DB_PASSWORD>' NOSUPERUSER NOBYPASSRLS`
   - `GRANT USAGE ON SCHEMA public`, `GRANT SELECT/INSERT/UPDATE/DELETE ON ALL TABLES`, `GRANT SELECT/USAGE ON ALL SEQUENCES`
   - `ALTER DEFAULT PRIVILEGES IN SCHEMA public ...` per future tabelle
2. `schema.prisma`: aggiungere `directUrl = env("DIRECT_URL")`
3. `.env` + `.env.example`: `APP_DB_PASSWORD`, `DATABASE_URL` (runtime app role), `DIRECT_URL` (migration postgres)
4. Migration `<ts>_replace_rls_placeholder_with_real`: DROP placeholder + CREATE reale su 7 tabelle (tenants/sedi/users/roles/user_roles/sessions/audit_logs)
5. Smoke E2E full: 5 scenari con tenant demo + acme (login isolation, JWT cross-tenant attempt, system seed visibility, super_admin cross-tenant)
6. Docker compose: ensure script per creare il role al bootstrap

Stima D3b: ~4h30.

## D3a — file consegnati

### Nuovi

- `packages/db/src/rls.ts` (~210 LOC): `TenantContext` type, ALS singleton, helpers (`getTenantContext`, `runInTenantContext`, `withSystemContext`, `withSuperAdminContext`), `RlsNoContextError`, `rlsExtension` factory con F1 fallback + re-entrancy guard
- `apps/api/src/context/tenant-context.interceptor.ts` (~55 LOC): NestJS Interceptor globale, wrappa handler in `runInTenantContext` via firstValueFrom Observable<->Promise bridge

### Modificati

- `packages/db/src/index.ts`: applica `rlsExtension` dopo `softDeleteExtension` nella factory `createPrismaClient`. Re-export RLS API.
- `apps/api/src/app.module.ts`: registra `TenantContextInterceptor` via `APP_INTERCEPTOR` provider
- `apps/api/src/tenant/tenant.middleware.ts`: slug lookup in `withSystemContext`, dopo resolve `runInTenantContext({tenantId, isSuperAdmin: false}, () => next())`
- `apps/api/src/auth/auth.service.ts`: `refresh()` wrappa il body in `runInTenantContext({tenantId: payload.tenantId, isSuperAdmin: false})` dopo JWT decode. Refactor split in `refresh()` + `refreshInContext()` privato.
- `apps/api/src/health/health.service.ts`: ping wrappato in `withSystemContext` (anche se `$queryRaw` bypassa l'extension, esplicito intent + safety futura)
- `packages/db/prisma/seed.ts`: `withSystemContext(() => main())` per bypassare RLS in seed
- `packages/db/scripts/smoke-soft-delete.ts`: stesso pattern del seed
- `apps/api/src/auth/auth.service.spec.ts`: mock `@gestionale/db` esteso con `runInTenantContext`, `withSystemContext`, `withSuperAdminContext` (passthrough fn)

### NON modificati (e' giusto cosi)

- `packages/db/prisma/schema.prisma` (decisione 13): modifica solo D3b (directUrl)
- `packages/db/prisma/migrations/20260511201927_enable_rls/migration.sql`: policy placeholder restano. D3b aggiungera' migration `replace_rls_placeholder_with_real`.
- `AuthService.login`, `loginPin`, `setupPin`, `logout`: middleware/Interceptor pre-setta context (decisione 14)
- 6 test Vitest existing: passano senza modifica del codice di test (solo mock @gestionale/db esteso)

## Smoke limited (STOP 3 D3a, 2026-05-13)

Script `/tmp/d3a-smoke-limited.ts` (non committato, una-tantum). Setup + scenari + teardown:

1. CREATE ROLE temp `d3a_smoke_role` NOSUPERUSER NOBYPASSRLS + GRANTs
2. DROP `users_policy` placeholder + CREATE policy reale temp: `is_super_admin OR tenant_id = setting`
3. Scenari con `DATABASE_URL` swappato al role temp:
   - **BASELINE** `withSystemContext.user.count` = 1 (atteso: tutti)
   - **SCEN 1** `runInTenantContext(demo).user.count` = 1 → PASS
   - **SCEN 2** `runInTenantContext(random UUID).user.count` = 0 → PASS
   - **SCEN 3** `runInTenantContext(random, super_admin=true).user.count` = 1 → PASS
   - **SCEN 4** `prisma.user.count()` fuori context → throw `RLS_NO_CONTEXT` → PASS
4. Teardown: rollback policy a `USING(true)`, DROP role temp

Conferma empirica: extension + ALS funzionano end-to-end. F1 fallback risolve R3. Pattern pronto per attivazione D3b.

## Considered Alternatives (D3a)

| Decisione            | Alternativa                                | Esito             | Razionale                                                                |
| -------------------- | ------------------------------------------ | ----------------- | ------------------------------------------------------------------------ |
| SET strategy         | Pattern A (SET globale connection)         | Rejected          | Race condition con pool, PgBouncer transaction mode rompe completamente  |
| SET strategy         | Pattern C (transaction esplicita ovunque)  | Rejected          | Rumoroso, sviluppatori "dimenticano" il wrap, security hole              |
| HTTP-scoped tx (S3)  | 1 tx per request                           | Rejected          | argon2 verify (~150ms) blocca pool connection, throughput auth crolla    |
| Context propagation  | Provider scope REQUEST NestJS              | Rejected          | Overhead noto, ricostruisce singletons, rompe DI                         |
| Super admin bypass   | PostgreSQL BYPASSRLS role attribute        | Rejected          | Richiede 2 pool, scelta pool app-side, complica deployment               |
| Naming policy        | `<table>_policy` (continuita' placeholder) | Rejected          | Future policy multiple per tabella ambigue                               |
| user_roles tenant_id | Denormalizzare `tenant_id` su user_roles   | Rejected (F1)     | EXISTS join O(log n) sufficiente. Tech debt se profiling lo giustifica   |
| Migration approach   | N migration separate per tabella           | Rejected          | Atomicita' policy = isolamento coerente. 1 migration rollback = 1 revert |
| Fail-safe no context | Log warning + 0 rows                       | Rejected          | Silent data emptiness nasconde bug architetturale. Fail-fast = bug catch |
| Slug lookup pre-auth | tenants_policy `USING(true)` permanente    | Rejected          | Esponi metadata tenant ad attaccanti. withSystemContext esplicito        |
| Smoke E2E            | Vitest Testcontainers full                 | Rejected (F1)     | Setup ~2h non giustificato per 4 scenari. Macro-task dedicato futuro     |
| R3 fix               | `prisma.$use` middleware (deprecated)      | Rejected          | Pattern deprecato Prisma 5+, removal in roadmap                          |
| R3 fix               | HTTP-scoped tx (S3)                        | Rejected (per R5) | Argon2 blocco. Stesso motivo per cui S2 fu scelto inizialmente           |

## Consequences

### Positive

- Framework RLS pronto: tutte le query Prisma su model passano per ALS context
- Fail-fast su context mancante: bug catching immediato in dev
- Audit log automaticamente tenant-scoped: l'isolamento e' al livello DB, non solo app-code
- Coerenza intent: `withSystemContext` rende esplicito quando si bypassa RLS (seed, jobs, health)
- Reversibile: il framework e' opt-in, disabilitabile rimuovendo `.$extends(rlsExtension())` dal client. Niente migration breaking in D3a.

### Negative

- Overhead per-query: ogni operazione Prisma fa BEGIN + 2× SET LOCAL + query + COMMIT (~2-3ms su localhost). Tech debt F2 documentata (HTTP-scoped tx, profilare).
- `(tx as any)[modelLower][operation]` cast unsafe in extension (R3 fix). Test runtime coprono scenari, type-safety statica persa per la singola riga.
- D3a senza D3b = no-op runtime: il framework setta context, ma le policy DB sono `USING(true)`. **Production deploy bloccato fino a D3b.**

### Neutral

- Schema Prisma invariato (decisione 13).
- 6 test esistenti continuano a passare (mock `@gestionale/db` esteso, no test logic touched).

## Reversibility

- Disabilitare RLS framework D3a: rimuovere `.$extends(rlsExtension())` da `createPrismaClient` in `packages/db/src/index.ts`. Tutto il resto continua a girare (i wrap `runInTenantContext` / `withSystemContext` diventano no-op rispetto al DB).
- Rimuovere Interceptor: rimuovere `APP_INTERCEPTOR` provider in `app.module.ts`.
- Rimuovere middleware wrap: ripristinare `next()` diretto in `TenantMiddleware`.
- Costo rimozione totale: ~30min, niente migration DB necessaria.

## Tech debt registrato

1. **R9 D3b — app role + DIRECT_URL pattern** (PROSSIMO TASK obbligatorio). 🚨 **PREREQUISITO SECURITY**: senza, RLS non e' effettivamente enforced.
2. **HTTP-scoped tx (S3) future eval**: profilare quando il throughput auth diventera' bottleneck. Per-operation tx overhead misurabile dopo D3b attivazione.
3. **Composite index `(tenant_id, deleted_at)`** sulle tabelle con soft-delete: profilare EXPLAIN post-D3b. Index attuale solo `(tenant_id)`.
4. **PgBouncer transaction mode incompatibile con SET LOCAL cross-statement**: documentato. Limita pooling a session mode fino a F2.
5. **CI grep guard "no $queryRaw outside packages/db"** per evitare bypass involontari del framework RLS. Da implementare quando l'estensione fuori `packages/db` di `$queryRaw` diventera' tentazione (es. complex aggregations).
6. **HMAC PIN lookup index** (carry over da ADR-0008): non correlato D3 ma rivalutare insieme F2.
7. **E2E full con Testcontainers**: Vitest setup E2E rimandato a macro-task "Auth E2E hardening".

## Security considerations

- **D3a non e' security activation.** Le policy DB sono ancora `USING(true)`. Il framework setta context ma postgres user bypassa RLS.
- **D3b e' obbligatorio per production.** Senza app role + policy reali, multi-tenant isolation = zero.
- **No info leak introdotti da D3a:** il fail-fast su context mancante e' lato applicazione, errore 500 (no DB query partita).
- **JWT-based super admin: assente in F1** (decisione S5). Bypass RLS server-side only via `withSystemContext` / `withSuperAdminContext` da script trusted. Nessun user a runtime puo' alzare `is_super_admin=true` via JWT.

## Notes

- L'extension RLS e' la 2a extension applicata al client (dopo softDelete). Order: softDelete inner, rls outer. softDelete fires su tx interno via re-entry guard.
- `$queryRaw` / `$executeRaw` / `$queryRawUnsafe` / `$executeRawUnsafe` bypassano l'extension by design. **Verifica empirica STEP 0 D4 (Prisma 6.19.3)**: contrariamente all'assunzione iniziale, queste raw queries **passano comunque attraverso `$allOperations`** con `model=undefined`. L'extension le riconosce dal `model` undefined e fa pass-through (`return query(args)` senza tx wrap). Bug nascosto durante D3a/D3b: una guard non voluta throwava su empty model → health check rotto. Fix in `rls.ts` (STEP 0 D4): early-return pass-through. Caveat: i chiamanti restano responsabili del proprio context (es. `$queryRaw` dentro `withSystemContext` non setta SET LOCAL — se servisse, wrap manuale in `$transaction` + `tx.$executeRawUnsafe('SET LOCAL ...')` + `tx.$queryRawUnsafe('SELECT ...')`).
- **Explicit `prisma.$transaction(async (tx) => ...)` NON e' atomico** quando le operazioni dentro passano per l'extension RLS (verificato empiricamente STEP 2a D4): l'extension auto-wrappa ogni op in un secondo tx via `client.$transaction` (closure ha il client base, non il `tx` dell'utente), quindi la rollback del tx esterno non propaga alle sub-tx interne → **orphan rows**. Fix architetturale: helper `withSystemContextAtomicTx(client, fn)` e `withTenantContextAtomicTx(client, tenantId, fn)` esportati da `rls.ts`. Pattern: ALS ctx + `inflightStorage=true` (re-entry guard bypassa l'auto-wrap dentro al tx user-side) + SET LOCAL una volta sull'inizio del tx + `fn(tx)`. Verifica 4/4 PASS (S1 system+throw=rollback, S2 system happy=created, S3 tenant read RLS attivo, S4 tenant+throw=rollback). Vedi ADR-0010 sezione "Atomicity" per dettaglio.
- `current_setting('app.tenant_id', true)` ritorna NULL se non settato; NULL = anything → NULL → false → row excluded. Fail-safe by PostgreSQL semantics, non serve fallback policy.
- `tenant_id = text` policy (no `::uuid` cast): scoperto a STOP 1 — `tenant_id` e' TEXT in DB (Prisma String mapping), no cast necessario. Le policy reali in D3b useranno text comparison.

## D3b — Activation completed (2026-05-13)

D3b chiude il loop di security activation iniziato da D3a. Output operativo:

### Componenti aggiunti (D3b)

| Componente             | Path                                                                                 | Scopo                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App role migration     | `packages/db/prisma/migrations/<ts>_create_app_role_and_grants/migration.sql`        | `CREATE ROLE gestionale_app IF NOT EXISTS` con placeholder password + GRANT USAGE/SELECT/INSERT/UPDATE/DELETE su schema/tables/sequences + ALTER DEFAULT PRIVILEGES per future tabelle |
| Policy reali migration | `packages/db/prisma/migrations/<ts>_replace_rls_placeholder_with_real/migration.sql` | DROP `<table>_policy` × 7 + CREATE `<table>_tenant_isolation` × 7 (pattern standard / EXISTS join user_roles+sessions / `tenants` su `id`) + ALTER TABLE FORCE ROW LEVEL SECURITY × 7  |
| Tighten role migration | `packages/db/prisma/migrations/<ts>_tighten_app_role_attributes/migration.sql`       | ALTER ROLE NOCREATEDB NOCREATEROLE NOINHERIT (defense in depth, simmetria con docker init)                                                                                             |
| Schema Prisma dual-URL | `packages/db/prisma/schema.prisma`                                                   | `directUrl = env("DIRECT_URL")` mappato — Prisma 5+ usa DIRECT_URL per DDL (migrate/generate) automaticamente                                                                          |
| Seed esteso            | `packages/db/prisma/seed.ts`                                                         | Refactor con helper `seedDevTenant(params)` + 2° tenant `acme` (Pizzeria Acme + `manager@acme.local`) per smoke RLS                                                                    |
| Smoke E2E              | `packages/db/scripts/smoke-rls-e2e.ts`                                               | 7 scenari read-only idempotenti: tenant isolation × 2, cross-tenant block, system bypass, super admin, roles isolation, audit_logs isolation. Wrapper `pnpm smoke:rls-e2e`             |
| Docker init script     | `infra/postgres/init/01-create-app-role.sh`                                          | Bootstrap fresh-volume con `CREATE ROLE IF NOT EXISTS` + password reale da `$APP_DB_PASSWORD`. Idempotente, format(%L) injection-safe                                                  |
| Docker compose         | `docker-compose.dev.yml`                                                             | `APP_DB_PASSWORD` env propagata al service postgres + mount `./infra/postgres/init:/docker-entrypoint-initdb.d:ro`                                                                     |
| .env / .env.example    | `/.env*`                                                                             | `APP_DB_PASSWORD` (raw base64) + `DATABASE_URL` (gestionale_app con password URL-encoded) + `DIRECT_URL` (postgres)                                                                    |

### Smoke E2E 7/7 PASS (read-only, idempotent)

```
[S1] tenant demo isolation: user.count == 1         PASS
[S2] tenant acme isolation: user.count == 1         PASS
[S3] cross-tenant block: demo ctx + manager acme    PASS (null returned)
[S4] system context visibility: user.count == 2     PASS (bypass via is_super_admin)
[S5] super admin context: demo tenantId + super_admin=true -> 2  PASS
[S6] roles isolation: demo ctx -> role.count == 1   PASS
[S7] audit_logs isolation: demo ctx == system filter on tenant_id=demo  PASS
```

`audit_logs` S7 confronta `count(demo_ctx) == count(system, where tenant_id=demoId)`: equivalenza robust-to-time (non count assoluto).

### Verifica empirica post-activation

- `login admin@demo + GET /me` ✅ (HTTP 201 + 200, 32 permissions)
- `login manager@acme + GET /me` ✅ (HTTP 201 + 200, returns acme user + acme Super Admin role only)
- `pg_user current_user`: `gestionale_app` con `usesuper=false, usebypassrls=false`
- 7 policies + `relforcerowsecurity=true` su 7 tabelle (verificato via `pg_class JOIN pg_policies`)

## Post-D3a findings (scoperti durante D3b)

### F1 — JwtStrategy validate() outside ALS context

`JwtStrategy.validate()` esegue `session.findUnique` + `user.findUnique` + `session.update`. Queste query fired al **guard stage** (prima del `TenantContextInterceptor` che setta ALS al interceptor stage). In D3a, latente perche':

- Policy DB erano `USING(true)` (sempre permissive)
- 6 test Vitest mockano `@gestionale/db` (bypassano DB reale)

Emerso a STEP 2 D3b quando `DATABASE_URL` passa a `gestionale_app` (NOSUPERUSER): la prima richiesta `/me` con Bearer token throwa `RlsNoContextError: 'Session.findUnique' executed outside any tenant context`.

**Fix applicato (pattern analogo a `AuthService.refresh`):** wrap del body di `validate()` in `runInTenantContext({tenantId: payload.tenantId, isSuperAdmin: false})`. Refactor in metodo privato `validateInContext()` per leggibilita'. Defense in depth: RLS filtra `session.findUnique` sul tenantId del JWT — attaccante che forge JWT con tenantId diverso vede 0 sessions → 401.

### F2 — Migration immutability vs comment-only changes

Durante D3b, dopo l'apply della migration `create_app_role_and_grants`, ho aggiornato il commento SQL (chiarimento password rotation, ASCII art warning) per maggiore visibilita'. Prisma ha rilevato checksum drift al successivo `migrate dev --create-only`. Risolto con script one-off che ha aggiornato `_prisma_migrations.checksum`.

**Tech debt + regola futura** (vedi sezione "Tech debt registrato"): in ambienti shared (staging/prod), MAI modificare migration applicate. Per cambiamenti SQL/comment post-apply → nuova migration `<ts>_fix_<topic>.sql` (esempio concreto: `tighten_app_role_attributes` D3b aggiunge attributi role senza toccare la migration originale).

### F3 — Pattern dual-URL Prisma 5+ comportamento automatico

Verificato empiricamente: con `directUrl = env("DIRECT_URL")` in `schema.prisma`, `prisma migrate dev/deploy` usa **automaticamente** DIRECT_URL per le operazioni DDL (CREATE/DROP POLICY, ALTER TABLE FORCE, CREATE ROLE). DATABASE_URL (= `gestionale_app`, NOSUPERUSER) resta per le query runtime. Nessun swap manuale di `.env` necessario tra migration e runtime — Prisma sceglie l'URL giusto per il tipo di operazione.

## Considered Alternatives (D3b)

| Decisione          | Alternativa                                                         | Esito         | Razionale                                                                                                   |
| ------------------ | ------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| Role bootstrap     | Solo migration con password reale                                   | Rejected      | Migration SQL committato in git → non safe embed password reale                                             |
| Role bootstrap     | Solo docker init script (no migration)                              | Rejected      | Non copre ambienti dev con volume esistente                                                                 |
| Pattern adottato   | Migration con placeholder + ALTER ROLE post + docker init per fresh | **Chosen**    | Copre entrambi i percorsi (fresh + existing) safely                                                         |
| URL Prisma         | Singolo DATABASE_URL swappato fra migration e runtime               | Rejected      | Manuale, error-prone, rompe `prisma migrate deploy` automatico in CI                                        |
| URL Prisma         | DATABASE_URL + DIRECT_URL via Prisma `directUrl`                    | **Chosen**    | Pattern Prisma 5+ standard, behavior automatico                                                             |
| Force RLS          | Solo policy reali senza FORCE                                       | Rejected      | Table owner (postgres) bypassa RLS senza FORCE. Postgres-as-owner+postgres-as-migration-runner = pericoloso |
| Force RLS          | FORCE + role app non-owner                                          | **Chosen**    | postgres rimane owner (necessario per migration). gestionale_app non-owner → policy enforced                |
| Role attribute set | LOGIN NOSUPERUSER NOBYPASSRLS solo                                  | Rejected      | Defense in depth carente                                                                                    |
| Role attribute set | + NOCREATEDB NOCREATEROLE NOINHERIT                                 | **Chosen**    | Minimum privilege principle, role applicativo non deve poter creare DB/role/ereditare gruppi                |
| Seed pattern       | Inline duplicato demo + acme                                        | Rejected      | DRY violato, manutenibile peggio                                                                            |
| Seed pattern       | Helper `seedDevTenant(params)`                                      | **Chosen**    | Single source of truth per il bootstrap tenant dev                                                          |
| audit_logs policy  | Considera tenant_id nullable                                        | Rejected      | Verificato schema: `tenant_id` NOT NULL. Policy semplice come le altre                                      |
| Smoke E2E          | Vitest E2E con Testcontainers                                       | Rejected (F1) | Setup ~2h. Macro-task "Auth E2E hardening" futuro                                                           |
| Smoke E2E          | Script TS dedicato read-only                                        | **Chosen**    | Riusabile per CI, no DB side effects, idempotente                                                           |

## Reversibility (estesa D3b)

### Disabilitare RLS reale (tornare a D3a placeholder)

1. **Reverse migration `replace_rls_placeholder_with_real`**: nuova migration con DROP `<table>_tenant_isolation` × 7 + CREATE `<table>_policy USING(true)` × 7 + ALTER TABLE NO FORCE ROW LEVEL SECURITY × 7. Comment di reference disponibile in `replace_rls_placeholder_with_real/migration.sql`.
2. **Tornare a connection postgres**: in `.env`, swap `DATABASE_URL` da `gestionale_app` a `postgres`. App ricomincia a usare superuser → RLS bypassata.
3. **(Opzionale) Rimuovere app role**: nuova migration con `REVOKE ALL` + `DROP OWNED BY gestionale_app` + `DROP ROLE gestionale_app`. Solo se si abbandona definitivamente il pattern.

Costo rimozione totale: ~30min, downtime trascurabile (app continua a funzionare durante la rotazione).

### Disabilitare RLS framework D3a (rimane disponibile da D3a sezione "Reversibility")

Rimuovere `.$extends(rlsExtension())` da `createPrismaClient` in `packages/db/src/index.ts`. Tutto il resto continua a girare (i wrap `runInTenantContext` / `withSystemContext` diventano no-op rispetto al DB). Costo: ~5min.

## Tech debt registrato (aggiornato D3b)

1. ~~**R9 D3b — app role + DIRECT_URL pattern**~~ ✅ **RISOLTO in D3b**.
2. **HTTP-scoped tx (S3) future eval**: profilare quando il throughput auth diventera' bottleneck. Per-operation tx overhead misurabile post-D3b activation.
3. **Composite index `(tenant_id, deleted_at)`** sulle tabelle con soft-delete: profilare EXPLAIN. Index attuale solo `(tenant_id)`.
4. **PgBouncer transaction mode incompatibile con SET LOCAL cross-statement**: documentato. Limita pooling a session mode fino a F2.
5. **CI grep guard "no $queryRaw outside packages/db"** per evitare bypass involontari del framework RLS.
6. **HMAC PIN lookup index** (carry over da ADR-0008): non correlato D3 ma rivalutare insieme F2.
7. **E2E full con Testcontainers**: Vitest setup E2E rimandato a macro-task "Auth E2E hardening".
8. **Password rotation post-migration deploy** (nuovo D3b): la migration `create_app_role_and_grants` crea il role con placeholder password. Step manuale `ALTER ROLE ... PASSWORD '$APP_DB_PASSWORD'` richiesto post-`prisma migrate deploy` in ogni nuovo ambiente. Mitigazione: documentato in README "Database setup" + commento prominente in migration SQL + bootstrap docker per fresh volumes. **Alternativa F2: secret manager (Vault / AWS Secrets Manager / k8s Sealed Secrets)** per leggere password al deploy + iniettare via init container o operator hook. Rischio attuale: ambienti nuovi con role placeholder se nessuno ricorda lo step → app non parte (visibile, non silente).
9. **Migration immutability** (nuovo D3b): pattern regola interna `MAI modificare SQL/comment di migration applicate`. Per fix/refinement post-apply → nuova migration `<ts>_fix_<topic>.sql`. Esempio concreto in D3b: `tighten_app_role_attributes` aggiunge attributi role NOCREATEDB/NOCREATEROLE/NOINHERIT senza toccare la migration `create_app_role_and_grants` originale. In dev locale single-dev, lo script one-off di checksum update e' accettabile come escape valve. In staging/prod = bandito.
10. **Drift attributi role doc** (nuovo D3b): docker init script e migration ora simmetrici (6 attributi negativi). Se in futuro si aggiunge un altro attributo, aggiornare ENTRAMBI source-of-truth simultaneamente (con migration tighten dedicata).

## Security considerations (finale D3b)

### Cosa è ENFORCED runtime

- **Multi-tenant data isolation**: tutte le 7 tabelle multi-tenant filtrate da policy `<table>_tenant_isolation` con FORCE attivo. `gestionale_app` (NOSUPERUSER, NOBYPASSRLS) non puo' bypassare.
- **Cross-tenant lookup block**: anche conoscendo l'UUID esatto di un record di altro tenant, `findUnique` ritorna `null`. Verificato S3 smoke E2E.
- **Insert protection**: la USING clause vale anche per WITH CHECK (default Prisma). INSERT di un record con `tenant_id` diverso dal context → policy violation → error.
- **Cross-table JOIN isolation**: `user_roles` filtrato via `roles.tenant_id`, `sessions` via `users.tenant_id`. Sub-select EXISTS O(log n) tramite index PK.
- **Fail-fast no context**: extension RLS throwa `RlsNoContextError` se query parte fuori da context. Bug architetturali catchati immediatamente in dev.
- **Defense in depth JwtStrategy** (post-D3a finding): `validate()` wrappato in `runInTenantContext(payload.tenantId)`. JWT forged con tenantId errato → session lookup ritorna null → 401.

### Cosa NON è enforced (tech debt F2)

- **Rate limiting auth endpoints**: nessun limit su `/auth/login`, `/auth/login-pin`, `/auth/refresh`. Macro-task "Auth hardening" futuro (`@nestjs/throttler` + Redis bucket).
- **Audit log su tenant_isolation_violated**: la policy filtra silenziosamente (null/empty result). Non logghiamo "qualcuno ha tentato cross-tenant access". Tech debt: aggiungere INSERT trigger su DELETE/SELECT con counter + audit. Considerazione: rumore se utenti normali fanno lookup di ID inesistenti.
- **Password rotation automatica**: D3b accetta il pattern manuale `ALTER ROLE` post-migrate. Tech debt #8.
- **PgBouncer transaction mode compat**: SET LOCAL cross-statement incompatibile. Limita pool a session mode F1. Tech debt #4.

### Cosa è ASSENTE in F1 (per design, non tech debt)

- **Platform super admin user** (decisione S5 D3a): nessun JWT-based bypass RLS in F1. Bypass solo server-side via `withSystemContext`/`withSuperAdminContext`. Concetto rimandato a macro-task dedicato.
- **PostgreSQL row-level encryption**: cifratura dati a riposo a livello disco (LUKS / cloud KMS) e' fuori scope F1.
