# ADR-0009 — RLS reali (tenant isolation runtime)

- **Status:** Accepted (D3a complete, D3b pending activation)
- **Date:** 2026-05-13
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0005](./ADR-0005-prisma-data-layer.md) (data layer, RLS placeholder), [ADR-0007](./ADR-0007-nestjs-api-scaffold.md) (NestJS scaffold), [ADR-0008](./ADR-0008-auth-module.md) (auth module, tenant resolution)

## 🚨 Status critico

**D3a status (questa PR): framework RLS operativo a livello applicativo, ma policy DB ancora placeholder `USING(true)`.** Significa: l'AsyncLocalStorage context e la Prisma extension funzionano end-to-end, ma le policy reali sul DB e l'app role non-superuser arrivano in **D3b**.

**Senza D3b, il framework e' no-op**: postgres user (superuser) bypassa RLS sempre, le policy sono `USING(true)`. **D3b OBBLIGATORIO prima di production deploy.**

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
- `$queryRaw` / `$executeRawUnsafe` bypassano l'extension by design (Prisma `$allOperations` intercetta solo model operations). Chiamanti responsabili: documentati nel docstring di `rls.ts`.
- `current_setting('app.tenant_id', true)` ritorna NULL se non settato; NULL = anything → NULL → false → row excluded. Fail-safe by PostgreSQL semantics, non serve fallback policy.
- `tenant_id = text` policy (no `::uuid` cast): scoperto a STOP 1 — `tenant_id` e' TEXT in DB (Prisma String mapping), no cast necessario. Le policy reali in D3b useranno text comparison.
