# ADR-0017 — RBAC enforcement Guard `@RequirePermissions(...)` (carry-over ADR-0010 TD #3)

- **Status:** Accepted
- **Date:** 2026-05-15 (sessione 11)
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Macro-task:** RBAC enforcement Guard generico (carry-over ADR-0010 tech debt #3)
- **Predecessor:** [ADR-0010](./ADR-0010-tenant-bootstrap.md) (tenant bootstrap D4 — TD #3 originato qui), [ADR-0008](./ADR-0008-auth-module.md) (auth module JWT lazy lookup design)
- **Branch:** `feature/rbac-permissions-guard`

## ✅ Status finale

**RBAC enforcement Guard generico completato**: carry-over da sessione 4 (ADR-0010) risolto dopo 7 sessioni. Foundation security/scaling per F1 (ogni endpoint business avrà 1-5 permission diverse — menu, tavoli, ordini, cassa).

- **`@RequirePermissions(...)` decorator** con AND default + opt-in OR via `{ mode: 'OR' }` signature overload
- **PermissionsGuard APP_GUARD globale** con cache Redis TTL 60s + fallback DB (Pattern fail-open layered 4° livello)
- **Audit action `auth.permission_denied`** nuovo (12° action TS union) + dedupe rate-limit Redis (60s) per anti-flood
- **POST /tenants refactor** mirato: inline check service rimosso, decorator controller single source of truth
- **3 nuove discoveries empiriche** (#36-38) catturate pre-production via E2E test reale

## Context

[ADR-0010 sessione 4](./ADR-0010-tenant-bootstrap.md) tracciava da subito TD #3 "Generic @RequirePermissions Guard" con trigger esplicito: "quando F1 avra' 10+ endpoint protetti da permission diverse". Sessione 11 anticipa il trigger:

1. **Foundation pre-F1**: ogni endpoint business futuro (menu, tavoli, ordini, cassa, reports) avrà 1-5 permission diverse → inline check D4 (`hasPermission` ogni endpoint) non scala oltre 10-15 endpoint
2. **Pattern senior**: ultimo tassello foundation security (auth ✅ + multi-tenant ✅ + audit ✅ + rate limit ✅ + lockout ✅ + email ✅ + RLS ✅ + E2E backend+frontend ✅ + RBAC ✅)
3. **Quick win 1-2h** vs F1 jump (4-8h per macro-task) — pattern senior "chiudi foundation prima"

## Decisions

5 decision points lockati STOP 1 sessione 11:

### DP1 — Logic mode permission check: AND default + opt-in OR

- **AND default**: `@RequirePermissions('p1', 'p2')` = user deve avere ENTRAMBE (least-privilege)
- **OR opt-in esplicito**: `@RequirePermissions({ mode: 'OR' }, 'admin', 'manager')` = ALMENO UNA
- Default sicuro + flessibilità per casi multi-ruolo
- Implementazione: signature overload con `PermissionOptions` object first-arg rilevato runtime (ramo 3-vie object/string/undefined per gestire zero-arg edge case)

### DP2 — Source permissions: lazy lookup via UsersService + cache Redis 60s

- **JWT lazy lookup confermato empirico** (ADR-0008 dec.7 + ADR-0010 rejected eager): JWT minimal, no permissions in payload
- **Cache Redis TTL 60s**: bilanciamento revoke-speed vs DB-load
  - Key: `permissions:user:<userId>:perm:<permissionCode>`
  - Value: `"1"` (true) o `"0"` (false) — string coerente con Redis defaults
  - HIT (~95% atteso per workload tipico): zero DB query
  - MISS: DB lookup via `usersService.hasPermission(userId, perm)` → cache SET con `'EX'` TTL
  - **Revoke permission max 60s lag** vs immediato (trade-off accettato)
- **Fail-open Pattern layered** (Lockout B1 + Mail B2a + Throttler B2b + ora RBAC = 4° livello):
  - Redis DOWN su GET → fallback DB lookup, log warn
  - Redis DOWN su SET → silent (cache miss prossima request, retry)
  - Comportamento degraded ma non bloccante

### DP3 — Audit denied events: `auth.permission_denied` + dedupe Redis 60s

- **Audit action nuovo**: `'auth.permission_denied'` aggiunto a TS union `AuditAction` (12° action). NO migration Prisma (campo `action: String` libero in `AuditLog`).
- **Dedupe rate-limit Redis**: key `audit:permdenied:<userId>:<endpoint>` TTL 60s con `SET NX` atomic. Anti-flood pattern (un attaccante che martella endpoint = 1 audit row/min/userId+endpoint).
- **Log warn SEMPRE** (real-time visibility ops), audit insert solo se non dedupato.
- Redis DOWN su dedupe → fail-open: audit insert SEMPRE (better double audit than missing).
- Audit insert direct via `DbService` (DbModule è `@Global()`, no coupling RbacModule → AuthModule). AuditService NON esiste come module separato — pattern simmetrico a `AuthService.recordAudit` (private inline). Decisione emersa da letture empiriche STOP 3 (vedi tabella Considered Alternatives 8° alternative scartata).
- **Considerata e scartata**: estrazione `AuditService` standalone da `AuthService.recordAudit` (vedi Considered Alternatives). Coupling RbacModule → AuthModule unnecessary per scope corrente, DbService global insert inline più cleaner.

### DP4 — Scope refactor: solo POST /tenants (sub-DP4 = A)

- **Sub-DP4 A**: rimuovi inline check service, solo decorator controller single source of truth
- Refactor mirato POST /tenants (`tenants.service.ts:58-63` rimosso + cleanup imports)
- Inline check rimosso: -15 LOC net (cleanup `ForbiddenException` import + `UsersService` import + DI constructor line)
- Decorator `@RequirePermissions('sistema.tenant.gestisci')` su `TenantsController#create()`
- TD candidato: refactor altri endpoint inline check se emergono (TD-AT futuro F1+)

### DP5 — Test strategy: unit guard isolato + E2E Testcontainers

- **Unit test isolato** (Vitest mock): UsersService + Reflector + Redis + ConfigService + DbService tutti mockati. Copre branch decision: no metadata, no user, AND pass/fail, OR pass/fail, cache HIT/MISS, Redis DOWN fail-open, audit dedupe NX/null.
- **E2E Testcontainers** (3 scenari real Postgres+Redis): admin allow 201, limited deny 403, audit row inserita post-deny.
- Smoke browser NON necessario (RBAC è backend-only enforcement, frontend non cambia in PR 1).

## Implementation

**Files chiave (~973 LOC totali nuovi):**

| File                                                                 | LOC | Scope                                                                                |
| -------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------ |
| `apps/api/src/rbac/interfaces/permissions-metadata.interface.ts`     | 20  | METADATA_KEY const + PermissionsMode type + PermissionsMetadata interface            |
| `apps/api/src/rbac/decorators/require-permissions.decorator.ts`      | 66  | Signature overload AND/OR + SetMetadata + edge case empty throw                      |
| `apps/api/src/rbac/decorators/require-permissions.decorator.spec.ts` | 70  | 6 unit test decorator                                                                |
| `apps/api/src/rbac/guards/permissions.guard.ts`                      | 259 | Guard + cache Redis + audit + dedupe + `runInTenantContext` wrap (#37)               |
| `apps/api/src/rbac/guards/permissions.guard.spec.ts`                 | 283 | 14 unit test guard (7 base + 7 cache+audit)                                          |
| `apps/api/src/rbac/rbac.module.ts`                                   | 29  | UsersModule + RedisModule + ConfigModule imports + PermissionsGuard provider         |
| `apps/api/test/e2e/rbac-permissions.e2e-spec.ts`                     | 246 | 3 scenari E2E + helper `seedRbacFixtures` + `loginAs` + `queryAuditPermissionDenied` |

**Files modificati (+51 / -30):**

- `apps/api/src/auth/auth.service.ts`: +1 voce `'auth.permission_denied'` TS union + `export type AuditAction` (era `type` privato)
- `apps/api/src/tenants/tenants.controller.ts`: +import `RequirePermissions` + decorator su `create()`
- `apps/api/src/tenants/tenants.service.ts`: -15 LOC inline check (const TENANT_BOOTSTRAP_PERMISSION + permission call + ForbiddenException) + cleanup imports + commento esplicativo
- `apps/api/src/auth/auth.module.ts`: `JwtAuthGuard` rimosso da APP_GUARD locale, esportato come provider regolare (Discovery #36 fix)
- `apps/api/src/app.module.ts`: tutti gli APP_GUARD centralizzati (Throttler → JwtAuth → Permissions) ordine deterministico
- `.env.example`: +sezione RBAC + `RBAC_CACHE_TTL_S=60`

**Test outcomes:**

- Unit test rbac: **20/20 PASS** in <22ms (14 guard + 6 decorator)
- Unit test totale: **45/45 PASS** zero regression
- E2E Testcontainers: **7/7 PASS** in 13.3s (4 prev + 3 nuovi RBAC)
  - Admin demo allow (POST /tenants 201): 800ms
  - Limited deny (POST /tenants 403 E_AUTH_INSUFFICIENT_PERMISSIONS): 571ms
  - Audit row `auth.permission_denied` inserita: 533ms

## Empirical discoveries (3 in sessione 11 PR 1 → 35+3 = 38 cumulative)

### Discovery #36 — NestJS APP_GUARDs cross-module order non-deterministico

**Macro-task:** STOP 4 Fase 4.3 (E2E smoke setup)

**Pattern:** ogni nuovo Guard globale può rivelare gap di ordering pre-esistenti (10° caso cumulative del pattern "ogni nuovo tipo di componente rivela gap latente").

**Root cause:** JwtAuthGuard era registrato come `APP_GUARD` in `auth.module.ts:35`, PermissionsGuard in `app.module.ts`. NestJS instanzia provider in ordine non-deterministico tra module diversi. Empirical: PermissionsGuard runnava PRIMA di JwtAuthGuard → `req.user === undefined` → throw `E_AUTH_NOT_AUTHENTICATED` su TUTTI gli endpoint protetti (anche admin con permission valida).

**Fix:** centralizzare TUTTI gli APP_GUARDs nello stesso module (`app.module.ts`) per ordine deterministico:

```typescript
providers: [
  { provide: APP_GUARD, useClass: AppThrottlerGuard }, // 1° rate limit
  { provide: APP_GUARD, useClass: JwtAuthGuard }, // 2° auth (popola req.user)
  { provide: APP_GUARD, useClass: PermissionsGuard }, // 3° authorization (legge req.user)
];
```

**Lesson generalizzabile:** APP_GUARDs in module diversi possono avere ordine instantiation non-deterministico. Pattern senior: registrare TUTTI gli APP_GUARD nello stesso module (tipicamente `app.module.ts`) per ordine deterministico. Provider in altri module devono restare REGULAR provider (non APP_GUARD).

### Discovery #37 — Guard stage PRECEDE TenantContextInterceptor (RLS no-context error)

**Macro-task:** STOP 4 Fase 4.3 (E2E smoke run)

**Root cause:** PermissionsGuard fa query Prisma (`hasPermission` + audit insert) ma è eseguito a guard stage. TenantContextInterceptor (che popola ALS context tenantId per RLS) è interceptor stage POST-guards. Risultato: query in Guard runna con ALS context vuoto → Prisma extension RLS rileva `RlsNoContextError`.

**Empirical evidence:** scenario 2/3 ricevevano 500 `RlsNoContextError` invece di 403 deny atteso.

**Fix:** wrap body Guard in `runInTenantContext({tenantId: user.tenantId, isSuperAdmin: false}, async () => { ... })` — pattern simmetrico a [jwt.strategy.ts:62-65](../../apps/api/src/auth/strategies/jwt.strategy.ts) che fa lo stesso wrap per `validate()` (Guard stage).

**Pattern consolidato:** qualsiasi Guard che accede DB con RLS context attivo DEVE wrappare query in `runInTenantContext()`. Pattern già esistente in JwtStrategy (Discovery #4 D3b sessione 3). Sessione 11 estende la lesson a PermissionsGuard.

### Discovery #38 — `seedMinimal` insufficient per E2E `createTenant` (system_role_templates missing)

**Macro-task:** STOP 4 Fase 4.4 (E2E scenario 1 admin allow)

**Root cause:** `tenants.service.ts:125-128` durante `createTenant` clona `system_role_templates` con `isDefault=true` come template seeding role del tenant nuovo. Helper E2E `seedMinimal` (test-app.ts:25-26) seeda SOLO tenant+sede+admin user, NON i 6 system_role_templates seedati dal seed.ts dev. Empirical: scenario 1 fail con 500 `System invariant violation: 'Super Admin' system_role_template missing or not default`.

**Fix:** estendere `seedRbacFixtures` inline E2E spec con:

- 1 `SystemRoleTemplate` (Super Admin, `isDefault=true`)
- 1 `SystemRoleTemplatePermission` link (mapping minimal)

Senza full 6 templates + 104 mappings (overkill per test E2E RBAC isolato).

**Lesson:** helper E2E `seedMinimal` ha gap documentati nel commento `test-app.ts:25-26`. Per test che chiamano `createTenant` (o equivalenti API che dipendono da system seeds), serve fixture inline integrativo per-test. Pattern senior: fixture E2E minimal-by-default, integrativo on-demand per scope test.

**TD candidato implicito (TD-AU)**: documentare in `test-app.ts:25-26` la lista di "API che NON funzionano con seedMinimal solo" (createTenant, eventuali altri).

## Considered Alternatives

| Alternativa                                                | Esito    | Razionale                                                                                             |
| ---------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| OR-only logic mode                                         | Rejected | Default troppo permissivo, anti-pattern security                                                      |
| Permissions eager nel JWT payload                          | Rejected | Token ballooned (~500 bytes), revoke non istantanea, già scartato ADR-0010                            |
| Lookup DB ogni request (no cache)                          | Rejected | +5-10ms latency per request protetta. D4 inline non scalabile                                         |
| Cache in-memory (no Redis)                                 | Rejected | Cache invalidation cross-instance impossibile (Hetzner CPX32 = 1 instance dev, ma F1+ multi-instance) |
| Solo log warning, no audit                                 | Rejected | Compliance trail incompleto, no queryable                                                             |
| Refactor TUTTI inline check D4                             | Rejected | +rischio regression in endpoint stabili, +30min. Mirato POST /tenants come reference                  |
| Defense-in-depth inline + decorator (sub-DP4 B)            | Rejected | Logica duplicata, drift risk. Single source of truth nel Guard                                        |
| AuditService separato (extract da AuthService.recordAudit) | Rejected | Coupling unnecessary RbacModule → AuthModule. DbService Global + insert inline è cleaner              |

## Reversibility

Costo rollback: ~20min totali (rimozione `apps/api/src/rbac/` + revert `app.module.ts` APP_GUARDs + revert `tenants.service.ts` inline check + revert `auth.service.ts` audit union + revert `.env.example` RBAC section). Foundation pulita, no entanglement con domain code.

Reversibilità parziale (es. rimuovere solo cache Redis mantenendo Guard): ~5min (rimuove `hasPermissionCached` + revert a `usersService.hasPermission` diretto, log warn audit invariato).

## Tech Debt registrato (3 nuovi)

### TD nuovi ADR-0017

| TD    | Descrizione                                                                                                                                                                                                                    | Priorità | Stima  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| TD-AS | Refactor `AuditAction` da TS union locale `auth.service.ts` → file dedicato `apps/api/src/auth/types/audit-action.ts`. Trigger: user-cases si moltiplicano (es. F1 endpoint con audit actions multipli condivisi cross-module) | Bassa    | ~15min |
| TD-AT | Refactor altri endpoint inline check D4 a `@RequirePermissions` decorator (se esistono). Trigger: F1+ aggiungono endpoint con permission, conviene cleanup totale per coerenza                                                 | Bassa    | ~30min |
| TD-AU | Documentare in `test-app.ts:25-26` lista "API che NON funzionano con seedMinimal solo" (Discovery #38). Trigger: ogni nuovo test E2E che usa API system-seed-dependent                                                         | Bassa    | ~10min |

### TD pre-esistenti (no update sessione 11 PR 1)

- TD-7 ADR-0012 (cross-tenant token UX edge) resta tracked — fuori scope RBAC
- TD-AJ ADR-0016 (backend errorCode 401) resta tracked — candidato PR 2 sessione 11
- TD-H ADR-0013 (lockout per-tenant) resta tracked — candidato PR 2 sessione 11

## Consequences

### Positive

- **TD #3 ADR-0010 RESOLVED** dopo 7 sessioni (carry-over da sessione 4)
- **Foundation security/scaling F1 completa**: ogni endpoint business futuro avrà `@RequirePermissions(...)` come standard
- **Audit trail completo**: 12° audit action `auth.permission_denied` per compliance + real-time ops visibility
- **Pattern fail-open layered 4° livello**: coerenza architetturale RBAC con Lockout/Mail/Throttler
- **3 discoveries empiriche** catturate pre-production (#36-38), 2 con valore generalizzabile (APP_GUARD ordering + Guard RLS wrap)
- **POST /tenants single source of truth**: -15 LOC pulizia, no logica duplicata service+guard

### Negative / Trade-offs

- **Revoke permission max 60s** (cache TTL). Mitigation futuro: endpoint admin `POST /rbac/cache/invalidate/:userId` (TD candidato implicito F1+)
- **+~1ms latency cache MISS** (Redis GET + DB query + SET). Trascurabile vs DB-only ~5-10ms
- **Test E2E +800ms tempo Testcontainers** (era 12.5s → 13.3s) — accettabile, 3 nuovi scenari coperti

### Neutral

- Pattern `runInTenantContext` wrap Guard ora documentato esplicitamente (Discovery #37) — riusabile per futuri Guard che accedono DB con RLS

## Security considerations

### Cosa è ENFORCED via RBAC Guard

- **POST /tenants**: solo user con permission `sistema.tenant.gestisci` (admin demo seedato)
- **Audit auth.permission_denied**: ogni deny è tracciato (dedupe anti-flood 60s/userId+endpoint)
- **Fail-open Pattern**: Redis DOWN NON bypassa enforcement (fallback DB lookup mantiene security)
- **Audit insert wrapped in `runInTenantContext`**: RLS isolato per audit_logs (tenantId del user)

### Cosa NON è enforced (gap documentati)

- **Cross-tenant token UX edge** (TD-7 ADR-0012, già tracked): demo loggato può navigare `/t/acme/dashboard`. NON modificato in PR 1.
- **Altri endpoint inline check D4** (TD-AT): se esistono altri endpoint con `hasPermission` inline non-decorator, non sono migrati. Foundation pronta, refactor F1+.
- **Revoke immediato permission**: max 60s lag (cache TTL). Mitigation: TD candidato F1+ admin endpoint cache invalidate.

## Smoke + Test summary

| Test type                        | Result     | Tempo     |
| -------------------------------- | ---------- | --------- |
| Unit rbac (guard + decorator)    | 20/20 PASS | <22ms     |
| Unit totale apps/api             | 45/45 PASS | invariato |
| E2E Testcontainers totale        | 7/7 PASS   | 13.3s     |
| E2E rbac-permissions (3 scenari) | 3/3 PASS   | 1.9s      |

Cumulative test totali progetto post-sessione 11 PR 1:

- **Vitest unit**: 45/45 PASS (era 25/25, +20 rbac)
- **Vitest E2E (Testcontainers backend)**: 7/7 PASS (era 4/4, +3 rbac)
- **Playwright E2E (frontend)**: 11/11 PASS Chromium + cross-browser smoke (invariato sessione 10)

## Related ADRs

- [ADR-0010](./ADR-0010-tenant-bootstrap.md) — TD #3 originato qui (RESOLVED sessione 11)
- [ADR-0008](./ADR-0008-auth-module.md) — JWT lazy lookup design (decision 7) — foundation per cache layer DP2
- [ADR-0009](./ADR-0009-rls-real.md) — RLS Active D3b + `runInTenantContext` pattern (riusato Discovery #37)
- [ADR-0013](./ADR-0013-auth-e2e-hardening-b1.md) — Pattern fail-open Lockout layered (1° livello)
- [ADR-0014](./ADR-0014-auth-e2e-hardening-b2a.md) — Pattern fail-open Mail layered (2° livello)
- [ADR-0015](./ADR-0015-auth-e2e-hardening-b2b.md) — Pattern fail-open Throttler layered (3° livello) + Testcontainers backend foundation

## Notes

- **Tempo reale**: ~2h sessione 11 PR 1 (stima iniziale 1-2h, +30% per Discovery #36-38 emerse STOP 4)
- **LOC totali**: ~973 LOC nuovi (rbac/ 727 + e2e spec 246) + delta modifiche +51/-30
- **PR**: #27 (27° PR del progetto)
