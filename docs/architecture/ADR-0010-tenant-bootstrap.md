# ADR-0010 — Bootstrap tenant logic (POST /tenants)

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0005](./ADR-0005-prisma-data-layer.md) (data layer + bootstrap pattern), [ADR-0008](./ADR-0008-auth-module.md) (auth + permissions lazy), [ADR-0009](./ADR-0009-rls-real.md) (RLS active + Atomic helpers introdotti in D4)

## ✅ Status finale

**D4 completato: endpoint `POST /api/v1/tenants` funzionante.**

- Protected by JwtAuthGuard globale + inline permission check `sistema.tenant.gestisci`
- 1 transaction atomic via `withSystemContextAtomicTx` (helper aggiunto in D4 dopo discovery atomicity break del `$transaction` esplicito su client extended)
- 8 operazioni bootstrap in una sola tx: tenant + sede + admin user + 6 roles cloned from system_role_templates + 104 role_permissions + admin → Super Admin assignment tenant-wide + audit log `tenant.created`
- Smoke E2E 5/5 PASS, delta DB esatto (+1/+1/+6/+104/+1/+1/+1)

## Context

Macro-task D4 implementa il flusso applicativo di bootstrap che mancava: creazione di un nuovo tenant via endpoint API. Quando arriva un nuovo cliente, il chiamante (con permission `sistema.tenant.gestisci`) crea tenant + struttura RBAC base in 1 chiamata, eliminando il pattern manuale (seed/script).

Pre-requisiti soddisfatti dai macro-task precedenti:

- ADR-0005: schema multi-tenant + `system_role_templates` con `isDefault: true`
- ADR-0008: auth flow + permission catalog (32 perms) + `Super Admin` role template (32 perms)
- ADR-0009: RLS attivo e enforced runtime → bootstrap pre-tenant girabile in `withSystemContext` (bypass via `is_super_admin = true`)

## Decisions

### 1. `withSystemContextAtomicTx` per bootstrap pre-tenant

Il tenantId non esiste fino a quando non lo creiamo. Tutte le operazioni runnano in system context (`is_super_admin = true`, `tenant_id = null`) per bypassare le policy RLS reali. Atomic helper introdotto in D4 dopo discovery F2 (vedi sezione "Discoveries").

### 2. Permission check FUORI dal `$transaction`

Anti-pattern: check dentro tx tiene una connection pool occupata durante una query di authorization che non e' parte della transazione di creazione. La guardia di entrata e' la prima cosa: se manca `sistema.tenant.gestisci` → throw 403 prima di consumare risorse DB.

### 3. `UsersService.hasPermission` lazy lookup

Coerente con ADR-0008 decisione 7 (JWT payload minimal). Helper riusabile: query Prisma con `findFirst` + chain `user.roles.some → role.permissions.some → permission.code` + `select: {id: true}` minimale. Postgres genera EXISTS sub-select, stop al primo match (~5ms).

2 test essential mock-based aggiunti a `users.service.spec.ts` (8/8 Vitest totali).

### 4. Inline permission check nel controller, NO Guard generico

D4 ha 1 endpoint che richiede permission check. Inline check via `usersService.hasPermission` in TenantsService e' sufficiente. Generic Guard `@RequirePermissions('...')` rimandato a macro-task RBAC enforcement futuro (sara' necessario quando F1 avra' 10+ endpoint protetti da permission diverse).

### 5. Slug forbidden list hardcoded

Array `FORBIDDEN_SLUGS` in `apps/api/src/tenants/dto/forbidden-slugs.ts` (11 voci: `api/www/admin/system/app/public/static/health/auth/me/tenants`). Pattern simmetrico `FORBIDDEN_PINS` D2b. Hardcoded → no fetch DB/rete, revocabile/estendibile in-source.

### 6. Default sede service-side (NOT @Transform nel DTO)

DTO `CreateTenantDto` ha `sedeName/sedeCity/sedePostalCode` come `@IsOptional`. Default applicati in `TenantsService` (`SEDE_DEFAULT_NAME = 'Sede Principale'`, etc.) via `??`. Single source of truth (default valgono anche se chiamiamo `createTenant` da seed/CLI bypassando il DTO).

### 7. Audit log `tenant.created` con `afterValue` filtrato

Nuova audit action enum (totale 10). `afterValue: { slug, name, adminEmail }` — **NO password** (security leak). `tenantId` del nuovo tenant + `userId = createdBy`. Visibile a Super Admin del nuovo tenant + system queries.

## D4 — Endpoint finale

| Endpoint          | Method | Auth      | Body              | Response                                              |
| ----------------- | ------ | --------- | ----------------- | ----------------------------------------------------- |
| `/api/v1/tenants` | POST   | 🔒 + perm | `CreateTenantDto` | 201 + `{data: {tenant, sede, admin, superAdminRole}}` |

Body DTO (vedi `create-tenant.dto.ts`):

- `name` (3-100), `slug` (`^[a-z][a-z0-9-]{2,49}$` + not in FORBIDDEN_SLUGS)
- `adminEmail` (email), `adminPassword` (min 8), `adminFirstName/LastName` (1-50)
- `sedeName?/sedeCity?/sedePostalCode?` (default applicati in service)

Error codes:

- 401 `E_AUTH_SESSION_INVALID` — JWT mancante/invalid
- 403 `E_AUTH_INSUFFICIENT_PERMISSIONS` — manca `sistema.tenant.gestisci`
- 400 ValidationError — DTO validation fail (incl. `E_TENANT_SLUG_*` per slug)
- 409 `E_TENANT_SLUG_EXISTS` — slug gia' in uso

## Discoveries D4 (architectural fixes RLS extension)

### F1 — `$queryRaw` regression in `$allOperations`

**Sintomo**: health endpoint torna 503 con `RLS: $allOperations received empty model name` quando DATABASE_URL = gestionale_app (NOSUPERUSER).

**Root cause**: `$queryRaw / $executeRaw / $queryRawUnsafe / $executeRawUnsafe` in Prisma 6.19.3 **passano comunque attraverso `$allOperations` con `model=undefined`**, contrariamente all'assunzione D3a. Una guard non voluta in `rls.ts` throwava su empty model → tutte le raw queries rotte (es. `health.service.ts` ping).

**Latenza**: non rilevato durante D3a/D3b perche':

- Smoke RLS E2E usa solo model operations (count/findUnique)
- 6 test Vitest mock-based bypassano il client Prisma reale
- Health endpoint funzionava finche' DATABASE_URL = postgres (superuser bypassa RLS, ma anche il throw inflightStorage non rilevava perche'... wait, in realta' il throw andava SEMPRE indipendentemente da super)
- In D3a/D3b post-fix il fix R3 (`tx[model][operation]`) richiedeva `model` non-empty → era cosi gia' rotto, ma il health check + ts-node-dev silenziavano l'errore in stack catch-and-rethrow ("Healthcheck DB ping failed" come Logger.error, non causa crash app)

**Fix** in `rls.ts` (STEP 0 D4): early-return pass-through quando `model === undefined` (raw queries). 5 LOC. Documentato in ADR-0009 v3 Notes.

### F2 — `$transaction` esplicito non atomico con RLS extension

**Sintomo**: durante design di `TenantsService.createTenant`, verifica empirica con throw mid-tx scopre che il tenant **NON** rolla back. Orphan rows in DB.

**Root cause**: la RLS extension auto-wrappa ogni operazione model in un `client.$transaction(...)`. Il `client` nel closure dell'extension e' il client BASE, non il `tx` dell'utente. Quindi:

- `prisma.$transaction(async (userTx) => userTx.tenant.create(...))`
- Extension fires → opens NEW separate `client.$transaction(async (innerTx) => innerTx.tenant.create(args))`
- innerTx COMMITS independently
- userTx rolls back → ma innerTx e' gia' committato → **orphan**

**Fix architetturale** in `rls.ts`: 2 helper Atomic introdotti in D4:

- `withSystemContextAtomicTx(client, fn)`: single `$transaction` atomic + system context. SET LOCAL una volta sull'inizio tx + `inflightStorage.run(true, ...)` previene re-wrap dell'extension sulle ops dentro `fn(tx)`.
- `withTenantContextAtomicTx(client, tenantId, fn)`: simmetrico, tenant context (`is_super_admin=false`, RLS attivo, atomic).

`inflightStorage` da `const` private → `export const` con commento "internal, used by Atomic helpers".

**Verifica empirica**: 4/4 atomicity test PASS (S1 system+throw=rollback, S2 system happy=created, S3 tenant read RLS attivo, S4 tenant+throw=rollback).

### F3 — `forceDelete` + RLS bypass in `withSystemContext`

**Sintomo**: durante regression check post-smoke D4, lo smoke RLS E2E S4/S5 fallisce con `user.count = 3` invece di 2 (test tenants residui). Tentativo di cleanup con `prisma.tenant.forceDelete({id})` wrappato in `withSystemContext` non rimuove le righe.

**Root cause**: la softDelete extension `forceDelete` usa `$executeRawUnsafe` → bypassa l'extension RLS (raw queries pass-through dopo F1 fix) → SET LOCAL **NON** applicato → policy RLS reali filtrano la `DELETE` → **0 rows affected** (silenzioso, no error). `forceDelete` in `withSystemContext` non funziona perche' `withSystemContext` setta l'ALS ctx ma la SET LOCAL viene fatta solo da operations model che passano per `$allOperations`.

**Workaround D4**: usare DIRECT_URL (postgres superuser bypassa RLS per design) per il cleanup one-shot. Esempio:

```typescript
const p = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
await p.tenant.delete({ where: { id } }); // CASCADE delete deps
```

**Fix proper futuro** (tech debt #1): nuovo helper `withSystemContextRaw(fn)` in `rls.ts` che wrappa in `$transaction` + SET LOCAL manuale + chiama `fn(tx)` con `tx` che ha access a `$executeRawUnsafe` e tutti i model. Pattern simile agli Atomic helpers ma per raw queries. Stima: ~30 LOC.

## Considered Alternatives

| Decisione                 | Alternativa                                                          | Esito                 | Razionale                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Tenant creation pattern   | Stored procedure DB-side (`CREATE FUNCTION bootstrap_tenant(...)`)   | Rejected              | Business logic in app layer per testability + portability cross-DB. SQL function difficile da unit testare                        |
| Flow                      | 2-step API (create tenant, POI bootstrap roles in chiamata separata) | Rejected              | Race condition (chi clone i template tra step 1 e 2?), client complexity, no atomicity                                            |
| Permission check          | Guard generico `@RequirePermissions('sistema.tenant.gestisci')`      | Rejected (per ora)    | D4 ha 1 endpoint. Quando F1 avra' 10+ endpoint con permission diversi, macro-task RBAC enforcement dedicato. Per ora inline check |
| Permission check delivery | Eager via JWT payload extension (`permissions: [...]` in payload)    | Rejected              | Viola ADR-0008 decisione 7 (JWT minimal + lazy lookup). Token ballooned, revoca permessi non istantanea                           |
| Slug uniqueness check     | Solo DB UNIQUE constraint (catch Prisma error)                       | Rejected              | DB error → 500 generic. Early check upfront → 409 user-friendly con error code dedicato `E_TENANT_SLUG_EXISTS`                    |
| DTO defaults sede         | `@Transform({value}) value                                           |                       | 'Sede Principale'` nel DTO                                                                                                        | Rejected | Default validi solo per request HTTP, non se `createTenant` chiamato da seed/CLI. Service-side = single source of truth |
| Audit log shape           | Include `adminPassword` in `afterValue` per troubleshooting          | **Strongly rejected** | Security leak. Audit log readable da Super Admin + system queries. Password mai loggata in chiaro NE in hash.                     |
| Atomicity F2              | HTTP-scoped tx (S3 di ADR-0009)                                      | Rejected              | Stesso motivo di ADR-0009 (R5 argon2 bloccherebbe pool). Atomic helpers e' il pattern coerente                                    |
| F3 forceDelete            | Modificare softDelete `forceDelete` per fare SET LOCAL prima del raw | Rejected (per ora)    | Coupling cross-extension. Workaround DIRECT_URL e' acceptable per ops one-shot. Fix con `withSystemContextRaw` futuro             |

## Reversibility

Rimozione completa D4 in ~5 min:

1. Rimuovere `TenantsModule` da `apps/api/src/app.module.ts` imports
2. Rimuovere directory `apps/api/src/tenants/`
3. Rimuovere `hasPermission` method + `users.service.spec.ts` (opzionale: la fn e' indipendente, puo' restare per uso futuro)

Atomic helpers (`withSystemContextAtomicTx`, `withTenantContextAtomicTx`) restano in `rls.ts` — riusabili per macro-task futuri (D5+ plugin install, bulk operations). Non vanno rimossi anche se D4 viene reversato.

## Tech debt registrato (D4)

1. **F3 — `forceDelete` + RLS bypass in `withSystemContext`** (carry-over discovery D4): aggiungere `withSystemContextRaw(fn)` helper in `rls.ts` che wrappa `$transaction` + SET LOCAL manuale + chiama `fn(tx)`. Stima ~30 LOC. Priorita': bassa finche' raw ops in withSystemContext sono ops one-shot (cleanup, debug); critical se `forceDelete` finisce in service runtime con RLS attivo.

2. **Cleanup pattern in test script** (lesson learned D4): test che creano dati DB devono fare cleanup verificato. 2 pattern accettabili:
   - Usare DIRECT_URL nel cleanup script (bypassa RLS, sempre funziona)
   - Wrappare l'INTERO test in una tx + `tx.rollback()` intenzionale alla fine (no orphan possibile)
     Lo smoke D3a `/tmp/d3a-smoke-limited.ts` (cleanup via DROP ROLE) era OK. Lo smoke D4 `/tmp/d4-smoke.sh` ha lasciato orfani che hanno rotto smoke RLS S4/S5 regression. Pattern futuro: usare DIRECT_URL OR tx rollback per cleanup smoke scripts.

3. **Generic `@RequirePermissions` Guard** — ✅ **RESOLVED 2026-05-15 (sessione 11)** — [ADR-0017](./ADR-0017-rbac-permissions-guard.md), PR #27.

   **Originale**: macro-task RBAC enforcement futuro. Trigger: quando F1 avra' 10+ endpoint protetti da permission diverse, inline check duplica troppo. Suggerimento: `@RequirePermissions('code1', 'code2')` decorator + `PermissionsGuard` che fa N `hasPermission` checks. Caching opzionale.

   **Resolution highlights**:
   - Anticipato il trigger (chiusura foundation pre-F1) — pattern senior "chiudi foundation prima di scalare"
   - `@RequirePermissions(...)` decorator AND default + opt-in OR via `{ mode: 'OR' }` signature overload
   - `PermissionsGuard` APP_GUARD globale con cache Redis TTL 60s + fallback DB (Pattern fail-open layered 4° livello, coerente B1/B2a/B2b)
   - Audit action `auth.permission_denied` (12° TS union) + dedupe Redis 60s anti-flood
   - POST /tenants refactor: inline check rimosso da `tenants.service.ts:58-63`, decorator controller single source of truth (-15 LOC net)
   - 3 nuove discoveries empiriche (#36 APP_GUARDs cross-module order, #37 Guard stage RLS no-context wrap, #38 seedMinimal gap createTenant)
   - Outcome: 20/20 unit rbac + 45/45 unit totali + 7/7 e2e Testcontainers PASS, zero regression
   - 3 TD nuovi tracked: TD-AS/AT/AU (vedi ADR-0017)

4. **Rate limiting `POST /tenants`** (carry-over ADR-0008): attacker autenticato con `sistema.tenant.gestisci` potrebbe spam creates. Anche con permission valida, abuso possibile. Fix futuro: `@nestjs/throttler` + Redis bucket per `userId` su questo endpoint specifico (1 tenant/min/user?). Tracciato in ADR-0008 tech debt "Auth E2E hardening".

5. **Race condition slug uniqueness** (mitigazione gia' attiva): early check `tx.tenant.findUnique` dentro tx + `@@unique` DB constraint come fallback. Race window microscopica (ms tra check e create). Postgres lock su INSERT con UNIQUE garantisce no duplicati anche con concorrenza. Acceptable F1.

## Security considerations

### Cosa è ENFORCED

- **Endpoint protetto**: JwtAuthGuard globale rifiuta richieste senza JWT valido (401)
- **Permission check**: `sistema.tenant.gestisci` enforced via inline `usersService.hasPermission` (403 se manca)
- **No password in audit log**: `afterValue` filtrato (slug, name, adminEmail only)
- **Atomic transaction**: rollback completo se qualunque step fallisce → no orphan rows mai
- **Slug validation**: regex + FORBIDDEN_SLUGS + uniqueness DB → no collisione route, no slug riservati, no duplicati
- **Password hash**: argon2id per admin user (coerente ADR-0008 decisione 1)
- **defense-in-depth `user` undefined check** nel controller (paranoid, sia il guard globale che il check inline)

### Cosa NON e' enforced (tech debt F2)

- **Rate limiting** su `/tenants` endpoint (vedi tech debt #4)
- **Idempotency** della richiesta (es. retry safe via `Idempotency-Key` header): rimandato a macro-task "API hardening"
- **CAPTCHA / proof of work**: out of scope F1
- **Email verification** del nuovo admin: rimandato a macro-task "Auth flows" (oggi `emailVerifiedAt: null` di default, niente flow di verifica)

## Notes

- Lo schema Prisma `assignedById` (con `Id` suffix) e' il field name corretto su `UserRole` (non `assignedBy`). User reminder lo aveva come "assignedBy", verificato e corretto.
- `tx.systemRoleTemplate.findMany({include: {permissions: true}})` legge `SystemRoleTemplatePermission[]` (relation `permissions` ma il modello e' join, non Permission diretto). Loop `tp.permissionId` per il `roleId_permissionId` di `RolePermission`.
- `Sede` ha `country/timezone/currency` con `@default` Postgres (`IT / Europe/Rome / EUR`). Service-side non li specifica → schema defaults kick in.
- Audit action enum totale 10 dopo D4: `auth.login.success/failure`, `auth.logout`, `auth.refresh.success`, `auth.theft_detected`, `auth.pin.setup/reset`, `auth.login_pin.success/failure`, **`tenant.created`** (nuovo).
