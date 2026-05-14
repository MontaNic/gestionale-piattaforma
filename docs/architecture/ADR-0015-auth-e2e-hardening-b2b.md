# ADR-0015 — Auth E2E hardening B2b: E2E full bootstrap Testcontainers + TD-AD fix

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Macro-task:** B2b (split di B2 deciso sessione 9; B2a chiuso PR #21+#22; B2b chiude B2)
- **Predecessor:** [ADR-0014](./ADR-0014-auth-e2e-hardening-b2a.md) (B2a email + login-pin per-tenant rate-limit)
- **Branch:** `feature/b2b-e2e-full-bootstrap-td-ad-fix`

## ✅ Status finale

**B2b completato**: primo E2E test full Nest bootstrap del progetto + TD-AD RESOLVED end-to-end (verifica empirica integration test Redis container stop mid-test).

- **E2E framework**: Vitest 3.2.4 + `supertest@7.2.2` + `@testcontainers/postgresql@11.14.0` + `@testcontainers/redis@11.14.0` + `pg@8.20.0` (raw SQL truncate/seed). Container shared per file test (Promise.all start ~6-10s).
- **TD-AD fix verified**: `AppThrottlerGuard.handleRequest` outer try/catch + `isRedisError` regex → fail-open verified integration test (Redis container stop mid-test → request 201 NON 500).
- **Pattern fail-open layered consolidato**: LockoutService (B1) + MailService (B2a) + ThrottlerGuard (B2b) tutti coerenti. Durante Redis DOWN: rate-limit + lockout disattivati, audit log Postgres continua a tracciare, ThrottlerGuard fail-open. Trade-off accettato F1.
- **2 E2E spec**: `auth-login.e2e-spec.ts` (3 scenari happy + error cases) + `td-ad-throttler-redis-down.e2e-spec.ts` (1 scenario fail-open).
- **Test totali**: 25 unit (fast, ~700ms) + 4 e2e (slow, ~13s) = **29/29 PASS**, zero regression.
- **B2 closure**: B2a + B2b complete → "Auth E2E hardening" macro-task 100% chiuso.

## Context

[ADR-0013 B1](./ADR-0013-auth-e2e-hardening-b1.md) ha consolidato rate limiting + lockout sliding window. [ADR-0014 B2a](./ADR-0014-auth-e2e-hardening-b2a.md) ha aggiunto email notification + login-pin per-tenant rate-limit + TD-B verify empirico, lasciando aperti:

1. **E2E test full Nest bootstrap** (primo del progetto): foundation critica per F1+ regression testing automation
2. **TD-AD**: ThrottlerStorage Redis DOWN fail-CLOSED 500 verificato in B2a Discovery #26 → fix definitivo + integration test

B2b chiude entrambi i punti.

## Decisions

### D1 — E2E framework: Vitest projects + Testcontainers

- **Vitest 3.2.4** (esistente da D2-vitest): pattern `projects` array separa `unit` (fast, `src/**/*.spec.ts`) da `e2e` (slow, `test/e2e/**/*.e2e-spec.ts`)
- **Scripts split**: `pnpm test` (unit only) vs `pnpm test:e2e` (e2e only) vs `pnpm test:all` (entrambi)
- **Testcontainers**: `@testcontainers/postgresql@11.14.0` + `@testcontainers/redis@11.14.0` + `supertest@7.2.2` + `pg@8.20.0` (raw SQL truncate/seed più veloce di Prisma)
- **Container strategy**: shared per file test (`beforeAll start` / `afterAll stop`) + `beforeEach` TRUNCATE 11 tabelle CASCADE + `seedMinimal` (tenant demo + admin)
- **Razionale**: Vitest 4-ready, coerenza monorepo (no Jest), Promise.all start parallelizza Postgres+Redis (~6s totali vs ~12s serial)

### D2 — Helpers separati per testability

- **`test-containers.ts`**: `startTestContainers()` (Promise.all + Prisma migrate via `execSync`) + `stopTestContainers()`
- **`test-app.ts`**: `createTestApp()` (env override + **lazy import AppModule** + ValidationPipe + setGlobalPrefix) + `truncateDatabase()` (raw `pg`, CASCADE 11 tabelle) + `seedMinimal()` (tenant demo + admin con argon2)
- **`setup-env.ts`**: setupFile Vitest project e2e, env vars defaults + `reflect-metadata` import PRE-module-load
- **Razionale**: helpers riusabili per futuri E2E test F1+ (tenants CRUD, RLS isolation, ecc.)

### D3 — TD-AD fix pattern: outer try/catch + `isRedisError` regex

```typescript
protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
  try {
    // existing logic B1+B2a (tenant-create branch, auth-pin branch, default)
    return await super.handleRequest(requestProps);  // ⭐ await CRITICO
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : '';
    const isRedisError = /MaxRetriesPerRequestError|ECONNREFUSED|Redis|ioredis/i.test(
      `${errName} ${errMsg}`,
    );
    if (isRedisError) {
      this.log.warn(`[FAIL-OPEN] ThrottlerGuard Redis unavailable, allowing request (throttler=${requestProps.throttler.name}): ${errMsg}`);
      return true; // fail-open
    }
    throw err; // non-Redis → preserva semantica originaria
  }
}
```

**Implementation detail correctness-critical**: `await super.handleRequest(...)` invece di `return super.handleRequest(...)` — **senza `await`, la Promise rejection scappa al chiamante** (middleware esterno) come unhandled rejection, NON intercettata dal try/catch locale. Pattern JS che sembra cosmetic ma è semantic-critical per fail-open correctness. Lesson generalizzabile: ogni outer try/catch su async logic richiede `await` esplicito (reviewer junior facilmente missato).

**Razionale `isRedisError` regex**: catch-all `instanceof Error` ribalterebbe ANY error a fail-open (bug app, ValidationPipe, ecc.); regex su `${errName} ${errMsg}` cattura `MaxRetriesPerRequestError` (ioredis exhaustion) + `ECONNREFUSED` (connection refused) + generic `Redis`/`ioredis` pattern. Case-insensitive (`/i`) defensive.

### D4 — Trade-off fail-open total durante Redis DOWN

Durante Redis DOWN, **sia rate-limit sia lockout sono disattivati simultaneously** (entrambi Redis-backed). Audit log Postgres continua a tracciare attempts. Mitigation production futura (TD-AF nuovo):

- Redis monitoring + alerting (DataDog/Prometheus)
- Multi-AZ Redis replication (Sentinel/Cluster)
- Circuit breaker pattern (ioredis built-in retry esiste, ma TD-AD = fail-open complete)

F1 NOT-production: accettabile.

### D5 — `seedMinimal` inline vs full `seed.ts`

- **Inline raw SQL**: `seedMinimal()` crea solo tenant demo + sede + admin (~3 INSERT statements)
- **Full `seed.ts` skip**: 32 permessi + 6 system role templates + 104 mappings = lento (~3-5s extra per ogni test file con `beforeEach` seed)
- **Razionale**: E2E test verificano auth flow, NON RBAC completo. F1 test futuri possono importare `seed.ts` se servono mapping completi.

### D6 — Recovery test post-Redis-restart: SKIP empirico

- Recovery automatico verified manualmente B2a STOP 5 (~121ms post-restart, ioredis auto-reconnect built-in)
- Testcontainers `containers.redis.start()` dopo `stop()` NON garantisce stesso host:port mapping → flaky test
- Decisione: skip recovery automation, manual verify sufficient per B2b scope

## Empirical discoveries (+4 in B2b → totale 30 cumulative)

### #27 — `ssh2` native crypto binding optional fail durante install

`ssh2@1.17.0` (transitive dep di `@testcontainers/*` via `dockerode`) tenta build native crypto binding via `node-gyp` → fail durante `pnpm add` ma `Failed to build optional crypto binding` (optional, NON blocca install). ssh2 funziona con pure-JS fallback. Docker locale via Unix socket non triggera ssh2 SSH path → zero impact runtime.

**Lesson**: warning install transitive optional binding può sembrare critico ma è acceptable se runtime path non lo richiede. Verifica empirica end-to-end (test run) > warning install.

### #28 — `JWT_SECRET` letto al MODULE LOAD TIME (top-level statement)

`apps/api/src/auth/auth.module.ts:14` legge `process.env.JWT_SECRET` come top-level constant. Vitest carica moduli PRIMA di `beforeAll` → env override in `createTestApp()` arriva troppo tardi.

**Fix**: setupFile dedicato `apps/api/test/e2e/setup-env.ts` con env defaults PRE-import + `reflect-metadata` import top-level.

**Lesson**: code che legge env vars al module-load-time è anti-pattern testability. F1+ refactor candidato (TD-AG): leggere env via `ConfigService` runtime, non top-level statements.

### #29 (PERMANENTE) — Vitest+SWC+`Test.createTestingModule`: NestJS DI non risolve class deps

Web research industry standard: `unplugin-swc` + `.swcrc` con `legacyDecorator: true` + `decoratorMetadata: true` + `keepClassNames: true` dovrebbe risolvere emit metadata gap.

**Verifica empirica STOP 3 sub-prompt rollback (~25 min, time-box 60 rispettato)**:

1. `.swcrc` completo creato con tutti i flag standard (`keepClassNames` + `decoratorMetadata` + `legacyDecorator` + `dynamicImport` + `module.type: commonjs`)
2. `vitest.config.mts` refactor con `tsconfigFile: false` per forzare lettura `.swcrc` + config inline ridondante
3. Rollback `@Inject` su 1 file pilota (`auth.service.ts`, 5 deps)
4. Empirical evidence: `TypeError: Cannot read properties of undefined (reading 'checkLockout')` — `this.lockout` undefined in `AuthService.login`

**Verdetto**: SWC metadata emit ≠ NestJS testing DI resolution complete chain. Tooling Vitest+NestJS+SWC ha gap residuo NON risolto da config standalone.

**Fix mantenuto**: `@Inject(ClassName)` esplicito su **14 file production code** come pattern defensive. Production: zero impact (annotazione esplicita registra token in `PARAMTYPES_METADATA`, ridondante quando metadata reflection funziona). Test: deterministico (bypass `design:paramtypes` lookup brittle).

**File con `@Inject` permanente** (14): `auth.service.ts` (5 deps), `lockout.service.ts` (2), `redis.service.ts` (1), `mail.service.ts` (1), `tenant.middleware.ts` (1), `jwt-auth.guard.ts` (1), `me.controller.ts` (1), `users.service.ts` (1), `tenants.service.ts` (2), `tenants.controller.ts` (1), `health.service.ts` (1), `health.controller.ts` (1), `auth.controller.ts` (1), `jwt.strategy.ts` (1).

**Lesson generalizzabile**: pattern empirical evidence > authority anche su tooling NestJS docs ufficiali. Industry standard pattern (Suites, Ablo blog post) probabilmente usano Jest+swc-jest, NON Vitest+unplugin-swc+`Test.createTestingModule`. Different tooling chain = different gaps.

### #30 — `@gestionale/db` singleton eager `prisma` legge `DATABASE_URL` al MODULE REQUIRE TIME

`packages/db/src/index.ts` esporta `prisma` singleton eager — costruito al primo `import` del modulo. Import statico di `AppModule` in `test-app.ts` → istanzia PrismaClient con env placeholder → `Authentication failed` quando container DATABASE_URL non ancora settata.

**Fix**: lazy `await import('AppModule')` dentro `createTestApp()` POST env override:

```typescript
process.env.DATABASE_URL = containers.databaseUrl;
// ... altri env
const { AppModule } = await import('../../../src/app.module'); // ⭐ lazy
const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
```

**Lesson**: singleton eager + env-driven runtime config è anti-pattern testability. Pattern simmetrico Discovery #28 (top-level env reads). F1+ refactor candidato (TD-AH): factory pattern per Prisma client, instanziato via DI in DbModule con runtime env access.

## Considered Alternatives

| #   | Decisione                            | Alternativa                             | Esito                   | Razionale                                                                                               |
| --- | ------------------------------------ | --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| D1  | Vitest projects (unit + e2e split)   | Single project mix                      | Rejected                | E2E slow ~13s, unit fast ~700ms — mix in default CI feedback loop frustrating                           |
| D1  | Vitest 3.2.4                         | Jest                                    | Rejected                | coerenza monorepo (D2-vitest scelta), Vitest 4-ready pattern `projects`                                 |
| D1  | Testcontainers shared per file       | Fresh per `beforeEach`                  | Rejected                | startup ~6-10s × N test = minutes; TRUNCATE between describe è O(1) Postgres su tabelle vuote           |
| D1  | Testcontainers shared per file       | Globale per intera test run             | Rejected                | leak risk tra file test, harder debug, parallelism Vitest sacrificed                                    |
| D3  | outer try/catch + regex isRedisError | wrap ogni Redis call con try/catch      | Rejected                | sprawl, less DRY, hard to maintain                                                                      |
| D3  | regex `isRedisError` robusto         | catch generic `instanceof Error`        | Rejected                | ribalterebbe ANY error a fail-open (bug app, ValidationPipe, ecc.)                                      |
| D3  | `await super.handleRequest(...)`     | `return super.handleRequest(...)`       | Rejected (#correctness) | senza `await`, Promise rejection scappa try/catch → unhandled rejection                                 |
| D5  | `seedMinimal` inline (~3 INSERT)     | full `seed.ts` (32 perm + 6 templates)  | Rejected                | E2E test auth flow non richiede RBAC completo; ~3-5s overhead per file                                  |
| D6  | Recovery test skip                   | start container dopo stop               | Rejected                | Testcontainers port mapping flaky, manual verify B2a sufficient                                         |
| #29 | `@Inject` 14 file (defensive)        | Rollback completo + SWC config standard | **Rejected empirico**   | rollback 1 file pilota → `Cannot read properties of undefined` → fix non funziona, tooling gap upstream |

## Tech debt update (1 RESOLVED + 4 nuovi)

| ID        | Categoria | Descrizione                                                                                                                 | Trigger fix                                                                 | Stima          |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------- |
| **TD-AD** | Throttler | ~~ThrottlerStorage Redis DOWN fail-CLOSED~~                                                                                 | ✅ **RESOLVED B2b** (Fase 4 fix + Fase 5 integration test verified)         | —              |
| **TD-AE** | Tooling   | `@Inject(ClassName)` esplicito su 14 file production code per testability E2E Vitest+NestJS DI gap (#29 permanente)         | Bump Vitest 4+, NestJS 12+, SWC 2.x — re-evaluation upstream tooling change | ~30min cleanup |
| **TD-AF** | DevOps    | Redis monitoring + alerting + multi-AZ replication (Sentinel/Cluster) per production deploy (#26 + D4 trade-off)            | Production deploy                                                           | ~2-4h          |
| **TD-AG** | Refactor  | `JWT_SECRET` top-level env read in `auth.module.ts:14` (#28). Refactor to `ConfigService` runtime read                      | F1+ refactor wave OR bump NestJS major                                      | ~30min         |
| **TD-AH** | Refactor  | `prisma` singleton eager in `@gestionale/db/src/index.ts` (#30). Refactor to factory pattern instanziato via DI in DbModule | F1+ refactor wave OR TD-2 multi-tenant routing                              | ~1h            |

Totale tech debt repo: ~29 (B1 21 + B2a 7 + B2b 4 nuovi - TD-AD RESOLVED).

## Reversibility

| Scenario                                             | Cost                                                                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rollback completo B2b (revert PR pre-merge)          | ~5min: `git revert <SHA-B2b>`. Deps removable (`pnpm remove -D supertest @testcontainers/postgresql @testcontainers/redis @types/supertest pg @types/pg unplugin-swc @swc/core uuidv7`). |
| Disabilitare TD-AD fail-open                         | ~5min: rimuovi outer try/catch in `app-throttler.guard.ts`. Comportamento Redis DOWN torna fail-CLOSED 500 (pre-B2b state). Non raccomandato.                                            |
| Rimuovere E2E test framework (mantenere unit)        | ~10min: rimuovi `apps/api/test/e2e/` + `vitest.config.mts` projects → single, `package.json` script `test:e2e` removable. Unit tests invariati.                                          |
| Rimuovere `@Inject` 14 file (TD-AE) post-fix tooling | ~30min: search/replace pattern `@Inject(ClassName) private readonly` → `private readonly` + remove unused `import { Inject }`. Verifica E2E test pass.                                   |

## Security considerations

### Cosa è ENFORCED (B2b)

- **TD-AD fail-open verified end-to-end**: Redis DOWN → request continua (audit log Postgres tracking persiste)
- **E2E test foundation**: regression auth flow coperta da test automation (login OK, wrong password, no tenant)
- **Mocked Mailpit in test env** (`SMTP_PORT=1` closed): `MailService.verify()` fail-open log warn, NO real email sent durante test (privacy + speed)
- **Container isolation**: ogni test run usa container fresh, no data leakage tra test run

### Cosa NON è enforced (TD-AE/AF/AG/AH)

- **Production Redis monitoring** (TD-AF): trigger production deploy
- **Refactor anti-pattern testability** (TD-AG + TD-AH): top-level env reads + singleton eager. Workaround test-side OK per ora.
- **`@Inject` 14 file** (TD-AE): pattern defensive, codice più verboso, re-evaluation upstream tooling

## Smoke + Test summary

| Test                                      | Tipo | Esito                               |
| ----------------------------------------- | ---- | ----------------------------------- |
| Unit (existing B1+B2a)                    | Unit | ✅ 25/25 PASS (~700ms)              |
| `auth-login.e2e-spec.ts` — login OK       | E2E  | ✅ 201 + JWT pair                   |
| `auth-login.e2e-spec.ts` — wrong password | E2E  | ✅ 401 `E_AUTH_INVALID_CREDENTIALS` |
| `auth-login.e2e-spec.ts` — no tenant      | E2E  | ✅ 401 `E_AUTH_TENANT_REQUIRED`     |
| `td-ad-throttler-redis-down.e2e-spec.ts`  | E2E  | ✅ Redis DOWN → 201 fail-open       |
| **Total**                                 | —    | **29/29 PASS (~13.93s)**            |

## Related ADRs

- [ADR-0008](./ADR-0008-auth-module.md) — auth module D2a/D2b (D2-vitest pattern test base)
- [ADR-0013](./ADR-0013-auth-e2e-hardening-b1.md) — B1 rate limit + lockout (predecessor)
- [ADR-0014](./ADR-0014-auth-e2e-hardening-b2a.md) — B2a email + login-pin per-tenant (predecessor)

## Notes

- **Versioni installate** (2026-05-14/15):
  - `supertest@7.2.2` + `@types/supertest@7.2.0`
  - `@testcontainers/postgresql@11.14.0` + `@testcontainers/redis@11.14.0`
  - `pg@8.20.0` + `@types/pg@8.20.0`
  - `unplugin-swc@1.5.9` + `@swc/core@1.15.33`
  - `uuidv7` (devDep apps/api per `seedMinimal` raw SQL)
- **LOC empirici** (da `wc -l`, NON stima):
  - `apps/api/test/e2e/helpers/test-containers.ts`: **69 LOC**
  - `apps/api/test/e2e/helpers/test-app.ts`: **144 LOC**
  - `apps/api/test/e2e/setup-env.ts`: **36 LOC**
  - `apps/api/test/e2e/auth-login.e2e-spec.ts`: **73 LOC**
  - `apps/api/test/e2e/td-ad-throttler-redis-down.e2e-spec.ts`: **81 LOC**
  - `apps/api/.swcrc`: **20 LOC**
  - Total file nuovi: **423 LOC**
  - `apps/api/src/throttler/guards/app-throttler.guard.ts` (delta TD-AD fix): +25 LOC
  - 14 file `@Inject` retrofit: delta ~2-6 LOC per file (~40-50 LOC totali)
- **Delta `git diff main --stat`**: `22 files changed, 1331 insertions(+), 94 deletions(-)` (include pnpm-lock 1110 LOC deps transitive)
- **Test totali**: 29 (25 unit + 4 e2e), zero regression dal predecessor B2a
- **B2 closure**: B2a (PR #21, #22 cleanup) + B2b (questo PR) = "Auth E2E hardening" macro-task **100% chiuso**
