# ADR-0013 — Auth E2E hardening (parte 1): rate limiting + lockout

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Macro-task:** B1 (split di B Auth E2E hardening; B2 = email theft notification + E2E test full Nest bootstrap programmato sessione 9)
- **Branch:** `feature/auth-e2e-hardening-b1`
- **Related:** [ADR-0008](./ADR-0008-auth-module.md) §3 "Rate limiting POSTERGATO" + [ADR-0010](./ADR-0010-tenant-bootstrap.md) tech debt #4 "Rate limiting POST /tenants" + [ADR-0012](./ADR-0012-frontend-auth-flow.md) sezione Security "No rate limiting login attempts"

## ✅ Status finale

**B1 completato**: rate limiting Redis + lockout sliding window + audit action `auth.account_locked` operativi end-to-end.

- 3 named throttlers attivi: `default` (60/min global) + `auth-strict` (5/min login+login-pin, opt-in) + `tenant-create` (3/h POST /tenants, opt-in con custom tracker userId-or-IP)
- LockoutService Redis sliding window: 10 fail in 15min → blocco 15min. Reset su login success (Redis + DB counter).
- LockoutExceptionFilter `Retry-After: 900` fissi (anti user-enumeration).
- Smoke E2E A/B/C/D/E/F/G/H tutti verdi (rate-limit + lockout + isolation + reset + Redis fail-open).
- Test Vitest: **25/25 PASS** (+17 vs baseline 8/8), zero regression.
- Audit action enum (string-based) totale: 11 (`auth.account_locked` aggiunta).

## Context

Pre-B1 lo stack auth aveva 3 gap di sicurezza tracciati come tech debt **postergati** in ADR precedenti, tutti riconducibili al "macro-task Auth hardening" che è oggi questo B1:

1. **ADR-0008 §3 — Rate limiting POSTERGATO**: niente `@nestjs/throttler` in D2a per disciplina tempi. Mitigazione baseline: `users.failed_login_attempts` counter persistente, ma **niente lockout/throttling reale**. Brute force su `/auth/login` non bloccato a livello applicativo.
2. **ADR-0010 tech debt #4 — Rate limiting `POST /tenants`**: attacker autenticato con permission `sistema.tenant.gestisci` può spam creates (anche con permission valida, abuso possibile). Raccomandazione esplicita: `@nestjs/throttler` + Redis bucket per `userId` su questo endpoint specifico.
3. **ADR-0012 Security "Contro" — No rate limiting login attempts**: carry-over esplicito ADR-0008.

Inoltre ADR-0008 D2b §8 documentava una decisione architetturale specifica per `/auth/login-pin`: il counter `failed_login_attempts` **NON** è incrementato (counter è semanticamente legato a `(email, password)`; PIN non identifica univocamente prima del match argon2). Tech debt: rate limit dedicato per `(tenantId, deviceId, ip)`.

**Stato pre-B1**: 10 endpoint operativi, JWT 15min + refresh 7d con rotation + theft detection FULL (D2-vitest), audit log 10 actions, ma zero protezione brute-force / spam tenant-create / lockout. Scope F1 NOT-production, ma qualità senior dal giorno 1.

## Decisions

### D1 — Stack rate limiting: `@nestjs/throttler` + Redis storage + ioredis

- **Package**: `@nestjs/throttler@6.5.0` (peer NestJS ^11 ✅, peer reflect-metadata ^0.2.0 ✅)
- **Storage**: `@nest-lab/throttler-storage-redis@1.2.0` (peer `@nestjs/throttler >=6.0.0` ✅, peer `ioredis >=5.0.0` ✅, peer `reflect-metadata ^0.2.1` ✅ — installed 0.2.2)
- **Client Redis**: `ioredis@5.10.1`
- **3 named throttlers** (NON 1 unico) per granularità per-endpoint:

| Name            | TTL        | Limit  | Target endpoint                                                | Tracker                                         |
| --------------- | ---------- | ------ | -------------------------------------------------------------- | ----------------------------------------------- |
| `default`       | 60s        | 60 req | global fallback (tutti gli endpoint non opt-in)                | IP (default ThrottlerGuard)                     |
| `auth-strict`   | 60s        | 5 req  | `/auth/login` + `/auth/login-pin` (opt-in via `@AuthStrict()`) | IP (pre-auth, no userId disponibile)            |
| `tenant-create` | 3600s (1h) | 3 req  | `POST /tenants` (opt-in via `@TenantCreate()`)                 | **userId** via JWT decode minimale, fallback IP |

Limit/TTL letti da env (`THROTTLE_DEFAULT_TTL_MS/LIMIT`, `THROTTLE_AUTH_TTL_MS/LIMIT`, `THROTTLE_TENANT_CREATE_TTL_MS/LIMIT`) per tuning senza re-deploy.

### D2 — RedisModule `@Global` shared (1 connection pool)

Pre-decision lockata: invece di istanziare `ioredis` inline in `ThrottlerModule.forRoot`, esiste un `RedisModule` (`@Global`) che espone `RedisService` come wrapper riusabile.

**Razionale**:

- LockoutService (D4) avrebbe richiesto un secondo client Redis → 2 connection pool ridondanti.
- 1 connection pool > 2 (saving su file descriptors, latenza, monitoring).
- Pattern riusabile (futuro cache layer, session store, pub/sub F1+).
- `RedisService.onModuleInit` fa PING al boot (dev-tolerant: warn + continue se Redis down).
- `onModuleDestroy` graceful `quit()` + fallback `disconnect()` su error.

Inoltre `@nestjs/config@4.0.4` aggiunto in retrofit incrementale: i nuovi moduli (Redis, Throttler, Lockout) usano `ConfigService`; main.ts / auth.module / db.module legacy restano su `process.env` diretto (asimmetria accettata, TD-C).

### D3 — Custom tracker `AppThrottlerGuard` per `tenant-create` (userId-or-IP)

Default ThrottlerGuard usa **solo IP** come tracker. Insufficiente per `tenant-create`: un attacker autenticato con `sistema.tenant.gestisci` può fare IP rotation per bypassare il bucket. Tracker userId è la soluzione.

**Constraint architetturale scoperto empiricamente** (discovery #18): `APP_GUARD: AppThrottlerGuard` gira **PRIMA** dei guard per-controller (`JwtAuthGuard`) → `req.user` è `undefined` al momento di valutazione del tracker.

**Strategia 3-livelli** (vedi `app-throttler.guard.ts`):

1. `req.user?.sub` se popolato (improbabile pre-JwtAuthGuard, ma defensive)
2. **Decode JWT minimale** dall'`Authorization` header (NO verify firma, NO DB lookup) — siamo solo identificando il caller per bucket, non autorizzando. Firma verificata poi da JwtAuthGuard al passaggio successivo.
3. Fallback `ip:<req.ip>`

Token forgiato/scaduto → fallback IP, ma JwtAuthGuard rifiuta poi con 401. Worst case: attacker con JWT forgiato consuma bucket di un sub a sua scelta — accettabile (limit 3/h + lockout). Trade-off documentato in TD-E.

**Implementation**: override `handleRequest(requestProps)` (NON `getTracker`, che in v6.5.0 è single-arg senza context — discovery #19), wrappa `requestProps.getTracker` con custom function SOLO quando `requestProps.throttler.name === 'tenant-create'`.

Verifica empirica (Smoke C STOP 2): log `tenant-create tracker=user:019e1e40-... (source=jwt)` confermato — path JWT decode è la strada effettiva (mai source=req.user).

### D4 — LockoutService Redis sliding window

Secondo strato di difesa oltre al rate limiting: blocco temporaneo dopo N fail nella window.

**Chiavi Redis**:

- `lockout:attempts:<id>` (Sorted Set, member = `<timestamp>-<random>`)
- `lockout:locked:<id>` (string, TTL = duration)

**Algoritmo `recordFailedAttempt`** (atomicità via pipeline 1 round-trip):

1. `ZADD timestamp_ms now <member>` (timestamp + random suffix per uniqueness)
2. `ZREMRANGEBYSCORE attempts -inf (now - window)` (cleanup vecchi attempt fuori finestra)
3. `ZCARD attempts` → count
4. `PEXPIRE attempts <window_ms>` (TTL auto-cleanup se utente smette)
5. Se `count >= threshold`: `SET locked '1' PX <duration_ms>` → `promotedToLockout: true`

**Identificatore lockout** (decisione lockata Claude strategico):

| Endpoint          | Key format                                | Rationale                                                                                    |
| ----------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `/auth/login`     | `tenant:<tenantId>:email:<email>`         | **TD-H RESOLVED (PR 2 sessione 12)** — cross-tenant isolation, vedi paragrafo dedicato sotto |
| `/auth/login-pin` | `pin:tenant:<tenantId>:device:<deviceId>` | ADR-0008 D2b §8 raccomandazione                                                              |

**Soglie env-driven**: `LOCKOUT_THRESHOLD=10`, `LOCKOUT_WINDOW_MS=900000` (15min), `LOCKOUT_DURATION_MS=900000` (15min). Default fallback hardcoded.

**Integrazione AuthService** (punto critico):

- `checkLockout` chiamato **PRIMA** del DB lookup user → evita timing leak fra utenti esistenti e non.
- Su fail (user non trovato OR password errata OR PIN mismatch): `recordFailedAttempt(key)` + audit `auth.login.failure`. Se `promotedToLockout` → audit `auth.account_locked` + throw 429 immediato (UX coerente: l'utente vede il blocco subito).
- Su success: `resetAttempts(key)` (DEL Redis) + `recordSuccessfulLogin(userId)` (reset DB counter, già da D2a).
- **`/auth/login-pin` NO DB counter increment** per design D2b §8 (TD-K, solo Redis tracking).

**Dev-tolerant Redis errors** (fail-open): `checkLockout` ritorna `null` su Redis throw, `recordFailedAttempt` ritorna `{promotedToLockout: false}` + log warn. Rate limiting via Throttler (D1) è primo strato; lockout secondo. Redis down ≠ porta aperta agli attacker → auth continua a funzionare senza lockout finche' Redis si riprende.

### D5 — `Retry-After: 900` fissi via `LockoutExceptionFilter` (anti user-enumeration)

`AuthService.throwAccountLocked()` lancia `HttpException(429)` con body `{code: 'E_AUTH_ACCOUNT_LOCKED', message: ...}`. `LockoutExceptionFilter` (extends `BaseExceptionFilter`, registrato come `APP_FILTER`) sniffa `body.code === 'E_AUTH_ACCOUNT_LOCKED'` e setta header `Retry-After: 900` **fisso**.

**Razionale anti user-enumeration (TD-J)**: un attacker che osserva `Retry-After` decrescente reale può triangolare quando l'account è stato bloccato per primo tentativo, inferendo che `email`/`deviceId` esiste nel sistema. Valore costante elimina questa side-channel.

`LockoutService.checkLockout` ritorna comunque `retryAfterSec` **reale** (per logging/audit), ma il filter sovrascrive a 900 sull'header response.

Discovery #20 catturata: `BaseExceptionFilter` registrato come `APP_FILTER` rompe la DI se ha custom constructor → omettere il constructor lascia che NestJS risolva `HttpAdapterHost` automaticamente.

## Considered Alternatives

| #     | Decisione                                                 | Alternativa                                                | Esito                     | Rationale                                                                                                                  |
| ----- | --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| D1    | named throttlers                                          | 1 throttler unico                                          | Rejected                  | Granularità impossibile (login != tenant-create != global)                                                                 |
| D1    | `@nest-lab/throttler-storage-redis@1.2.0`                 | `nestjs-throttler-storage-redis` (legacy)                  | Rejected                  | nest-lab maintained 2024+, ioredis-based, peer aligned con throttler v6                                                    |
| D1    | named throttlers via skipIf opt-in                        | `@SkipThrottle({name:true})` su ogni controller non-target | Rejected                  | Rumoroso (decorator su molti endpoint); skipIf metadata cleaner                                                            |
| D2    | RedisModule `@Global` shared                              | ioredis client inline ThrottlerModule                      | Rejected                  | Refactor forzato Fase 3 (LockoutService), 2 connection pool ridondanti                                                     |
| D2    | `@nestjs/config` retrofit completo                        | mantenere `process.env` ovunque                            | Rejected                  | ConfigService più testabile per nuovi moduli; retrofit incrementale meno invasivo del big-bang                             |
| D3    | userId-or-IP tracker                                      | IP-only                                                    | Rejected                  | Attacker autenticato spam da IP diversi → bypass IP-bucket                                                                 |
| D3    | Override `getTracker(req)` single-arg                     | Override `handleRequest(requestProps)`                     | Rejected (v6.5.0)         | `getTracker` non riceve context → impossibile distinguere `tenant-create` da altri                                         |
| D3    | JWT decode con verify firma                               | Decode minimale base64url (no verify)                      | Rejected                  | Rate limit ≠ autorizzazione; verify aggiunge dep su `JwtService` e latenza; JwtAuthGuard rifiuta token forgiato downstream |
| D4    | Redis sliding window (ZADD/ZREMRANGEBYSCORE)              | DB-only counter                                            | Rejected                  | No time-window query efficiente in DB; high write contention su `failed_login_attempts`                                    |
| D4    | Lockout key per-tenant (`tenant:<id>:email:<email>`)      | email-only                                                 | **Accepted (PR 2)**       | TD-H RESOLVED post TD-2 ADR-0012: composition opaque identifier (LockoutService API stabile), no scope creep refactor      |
| D4    | Lockout check POST-auth                                   | Lockout check PRE-DB lookup                                | Rejected                  | Timing leak utenti esistenti vs non — anti-enumeration                                                                     |
| D4    | `failed_login_attempts` DB counter su login-pin           | Solo Redis (no DB)                                         | Rejected                  | D2b §8 carry-over (counter semanticamente legato a `(email, password)`)                                                    |
| D5    | `Retry-After` reale residuo                               | 900 fissi                                                  | Rejected                  | User enumeration via timing analysis                                                                                       |
| D5    | Custom `ExceptionFilter` con constructor `(httpAdapter?)` | Senza constructor                                          | Rejected (empirical, #20) | DI `UnknownDependenciesException` su APP_FILTER                                                                            |
| Audit | Audit log su ogni failed attempt                          | Solo su `promotedToLockout: true` (transizione)            | Rejected                  | Verbose, log noise; transizione è il segnale rilevante per SOC                                                             |
| Audit | Audit `afterValue` con email plain text                   | Hash sha256[0:8] (`lockoutKeyHash`)                        | Rejected                  | Audit leggibile da Super Admin; PII masking pattern (ADR-0005 carry-over)                                                  |

## Empirical discoveries (+6 in B1, totale 21 cumulative)

### #16 — NestJS Throttler v6 named throttlers globali by default

**Sintomo (STOP 1)**: smoke iniziale 60 req /health → 2x 200 + 58x 429 (atteso 60x 200 + 1x 429). Causa: tutti i named throttlers registrati nella `forRootAsync` vengono applicati globalmente, e il limite più basso (`tenant-create=3`) triggera prima.

**Fix**: pattern `skipIf` callback con metadata flag. Throttler `auth-strict` e `tenant-create` registrati globalmente MA con `skipIf: skipIfMetadataAbsent(KEY)` che ritorna `true` (skip) se l'handler/class non ha il metadata `@AuthStrict()` o `@TenantCreate()`. Confermato empiricamente: Smoke D STOP 2 mostra solo `:default:hits` in Redis per `/health` (no chiavi `auth-strict` / `tenant-create`).

**Lesson generalizzabile**: opt-in scope per named throttlers richiede consumer-side pattern (skipIf o SkipThrottle), non è nativo del package.

### #17 — Container Redis docker-compose NON host-exposed di default

**Sintomo (STOP 1)**: `RedisService.onModuleInit` PING fail con `ECONNREFUSED` su `127.0.0.1:6379`. `docker compose ps` mostra container healthy, ma `bash -c '</dev/tcp/127.0.0.1/6379'` → "Connection refused".

**Causa**: `docker-compose.dev.yml` aveva `redis` service senza `ports:` directive — esposto SOLO sulla network bridge interna `gestionale_network`. apps/api gira sull'host con ts-node-dev, non sulla network bridge.

**Fix**: aggiunto `ports: ['127.0.0.1:6379:6379']` simmetrico al pattern Postgres. TD-D: rimuovere binding quando API verrà containerizzata.

### #18 — `req.user` undefined in `APP_GUARD AppThrottlerGuard`

**Sintomo (STOP 2 verifica critica)**: log custom mostra `tenant-create tracker=user:<sub> (source=jwt)` — mai `source=req.user`. Significa che al momento di valutazione del tracker, `req.user` è `undefined` (JwtStrategy.validate() non ancora eseguita).

**Causa**: in NestJS, `APP_GUARD` registrato come provider globale gira PRIMA dei guard per-controller. `JwtAuthGuard` (anch'esso APP_GUARD globale) ha `@Public()` decorator opt-out, quindi l'ordering effettivo è non deterministico per gli endpoint pubblici.

**Fix**: decode JWT minimale dall'Authorization header (no verify). Sufficiente per rate-limiting (≠ autorizzazione). Implementazione in `apps/api/src/throttler/utils/jwt-decode.util.ts`.

### #19 — `@nestjs/throttler` v6.5.0 `getTracker(req)` single-arg

**Sintomo (STOP 2)**: typecheck error `Property 'getTracker' in type 'AppThrottlerGuard' is not assignable to the same property in base type 'ThrottlerGuard'. Target signature provides too few arguments. Expected 2 or more, but got 1.`

**Causa**: la signature ufficiale documentata di `getTracker` è `(req, context)` ma la classe `ThrottlerGuard` in v6.5.0 ha `(req)` single-arg. Il `context` arrivato come arg al `getTracker` factory in `ThrottlerOptions` è una funzione separata.

**Fix**: override `handleRequest(requestProps: ThrottlerRequest)` invece di `getTracker`. `requestProps` contiene `context`, `throttler` (con `.name`), e `getTracker` (factory). Wrap `requestProps.getTracker` con custom function quando `throttler.name === 'tenant-create'`.

### #20 — `BaseExceptionFilter` APP_FILTER DI break con custom constructor

**Sintomo (STOP 3)**: app crash con `Nest can't resolve dependencies of the LockoutExceptionFilter (?). Please make sure that the argument at index [0] is available in the current module.`

**Causa**: `LockoutExceptionFilter` aveva `constructor(applicationRef?: HttpAdapterHost['httpAdapter'])` che chiama `super(applicationRef)`. NestJS APP_FILTER tenta di iniettare il primo arg via DI ma non sa cosa passargli (HttpAdapterHost non è un provider standard nei moduli).

**Fix**: omettere il constructor. `BaseExceptionFilter` risolve `HttpAdapterHost` internamente al runtime (lookup globale). Pattern poco documentato — catturato come commento inline per future filter.

### #21 — ValidationPipe filtra PRE-controller → lockout counter non incrementato

**Sintomo (STOP 3 Smoke F)**: 2 fail con `{"email":"admin@demo.local","password":"Wrong!"}` → 2x 400 (BadRequest, password <8 char). ZCARD=0 in Redis. Atteso 2x 401 + ZCARD=2.

**Causa**: `ValidationPipe` globale gira PRIMA del controller handler. Input malformato (password troppo corta) → 400 ValidationError → mai entra in `AuthService.login` → `recordFailedAttempt` mai chiamato.

**Implicazione**: anti-DoS via input invalido (validation errors non consumano counter), ma attacker con password "ben formata" (8+ char) ma sbagliata consuma counter normalmente. Fix smoke: usare `'WrongPass1!'` (10 char) — `Bcryptpassword1!` qualsiasi >=8 OK.

**Lesson generalizzabile**: ordering NestJS = Guard → Pipe → Interceptor → Handler → Filter (per exceptions). I counter di sicurezza app-side devono considerare quale stage del pipeline filtra cosa.

## Tech Debt Accepted (21 voci nuove, B1 — 14 STOP + 7 cleanup review)

| ID           | Categoria     | Descrizione                                                                                                                                                                                                                                                                                           | Trigger fix                                                                                                          | Stima            |
| ------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **TD-A**     | Redis         | `RedisService` no retry/reconnect strategy customizzata (default ioredis `maxRetriesPerRequest:3` + exponential backoff built-in)                                                                                                                                                                     | Pre-production circuit breaker + alerting su disconnect prolungato                                                   | ~1h              |
| **TD-B**     | Redis         | `ThrottlerStorage` comportamento se Redis down mid-request **non testato empiricamente** (boot tollerante OK; mid-request behaviour incerto)                                                                                                                                                          | Test + decisione fail-open/fail-closed + documentare                                                                 | ~30min           |
| **TD-C**     | Config        | Asimmetria `process.env` (legacy: main.ts, auth.module, db.module) vs `ConfigService` (nuovi: redis, throttler, lockout)                                                                                                                                                                              | Refactor incrementale low-priority                                                                                   | ~1h              |
| **TD-D**     | Docker        | `127.0.0.1:6379:6379` aggiunto a `docker-compose.dev.yml` per ts-node-dev sull'host; quando API containerizzata, rimuovere (parla via service name `redis`)                                                                                                                                           | API containerization                                                                                                 | ~5min            |
| **TD-E**     | Security      | Custom tracker non distingue session-stolen JWT (tracker = vittima del furto)                                                                                                                                                                                                                         | Accettato — mitigato da `auth-strict` (limita brute-force pre-steal) + lockout (limita post-steal) + email-notify B2 | n/a              |
| **TD-F**     | Throttler     | Default `generateKey` di NestJS Throttler crea bucket **per-handler** (controller+method), non per-tracker globalmente → un client può consumare `default=60/min` × N route                                                                                                                           | Cross-endpoint DoS osservato                                                                                         | ~30min           |
| **TD-G**     | Throttler     | `handleRequest` override richiede import `ThrottlerGetTrackerFunction` da subpath `@nestjs/throttler/dist/throttler-module-options.interface` (non in package main entry)                                                                                                                             | Monitor CHANGELOG @nestjs/throttler — upgrade break potenziale                                                       | n/a              |
| ~~**TD-H**~~ | ~~Lockout~~   | ~~`/auth/login` lockout key = `email:<email>` only (non per-tenant) → DoS-by-account-name accettato~~ — **RESOLVED PR 2 sessione 12** ([feat/pr2-td-h-td-aj-lockout-pertenant-errorcode](#td-h-resolution-pr-2)). Lockout key ora `tenant:<id>:email:<email>` → cross-tenant DoS isolation garantito. | ✅ DONE                                                                                                              | ~15min effettivi |
| **TD-I**     | Lockout       | Race condition reset counter DB tra login simultanei multi-device (Prisma `update {failedLoginAttempts: 0}` last-write-wins benigno, ma counter increment race può doppiare)                                                                                                                          | Transactional update + version se osservato in metrics F1                                                            | ~1h              |
| **TD-J**     | Lockout       | `Retry-After: 900` fissi vs reale residuo — trade-off anti-enumeration accettato                                                                                                                                                                                                                      | n/a (decisione lockata)                                                                                              | n/a              |
| **TD-K**     | Lockout       | `/login-pin` NO DB counter (solo Redis tracking) — D2b §8 design carry-over confermato                                                                                                                                                                                                                | n/a (design accettato F1)                                                                                            | n/a              |
| **TD-L**     | Filter        | `BaseExceptionFilter` APP_FILTER no custom constructor pattern (#20) — documentato                                                                                                                                                                                                                    | Future filter dovranno seguire stesso pattern                                                                        | n/a              |
| **TD-M**     | Test          | Sliding window cleanup empirico (advance fake timer + ZREMRANGEBYSCORE oltre window) NON in unit test — smoke STOP 3 lo copre indirettamente via TTL=900s                                                                                                                                             | B2 Testcontainers (full Redis reale)                                                                                 | ~30min           |
| **TD-N**     | Refactor      | `lockoutKeyDigest` in `AuthService` duplica `hashId` in `LockoutService` (entrambi `sha256[0:8]`)                                                                                                                                                                                                     | Shared utility (3-LOC each, low value)                                                                               | ~15min           |
| **TD-O**     | DevOps        | `gh` CLI non installato sul server + Deploy Key only (no API token) → PR creation manuale via UI GitHub ad ogni macro-task                                                                                                                                                                            | Workflow optimization: install `gh` + `GITHUB_TOKEN` read/write su CI, oppure accettare manual UI come standard      | ~15min           |
| **TD-P**     | Lockout       | Redis memory pressure su email-enumeration spray attack: attacker che invia 1000 email random crea 1000 key con TTL 15min. Mitigato in single-IP da `auth-strict` (75 key/IP/15min cap); distributed via botnet potenziale                                                                            | Monitor Redis memory pre-production; valutare cap su key length nel namespace `lockout:attempts:`                    | ~30min           |
| **TD-Q**     | Config        | Env var validation: `Number(config.get('REDIS_PORT') ?? '6379')` ritorna `NaN` se env malformato (es. `REDIS_PORT=abc`). Stesso pattern per tutti i `THROTTLE_*_TTL_MS/LIMIT` e `LOCKOUT_*`                                                                                                           | Pre-production: aggiungi `isNaN()` check con fallback esplicito + log warn                                           | ~30min           |
| **TD-R**     | Redis         | TLS support per Redis production (Redis Cloud / AWS ElastiCache TLS-only). Oggi `new Redis({host, port})` senza opzione `tls: {}`                                                                                                                                                                     | Pre-production deploy con managed Redis service                                                                      | ~20min           |
| **TD-S**     | Observability | Error listener `client.on('error', ...)` può spammare log warn su connection retry storm (ioredis exponential backoff). Nessun rate-limit dei log                                                                                                                                                     | Strutturato logging + rate-limit log (es. log primo + ogni N retry)                                                  | ~30min           |
| **TD-T**     | Edge case     | IPv6 `req.ip` può contenere `:` come separatore (es. `[::1]:54321`). Custom tracker `ip:<req.ip>` produce key Redis con doppi `:` → namespace ambiguo. F1 dev quasi sempre IPv4                                                                                                                       | Verifica empirica con `curl -6` su server con IPv6 + escape `:` in tracker                                           | ~30min           |
| **TD-U**     | Observability | `RedisService` nessun `client.on('connect'\|'ready', ...)` listener → no log su reconnessione post-drop. Solo PING su `onModuleInit` (boot-time)                                                                                                                                                      | Structured logging connect/reconnect events per monitoring                                                           | ~30min           |

**Nota**: TD-O → TD-U emersi durante check pre-merge di Claude strategico (revisione rigorosa dei 10 file della PR B1). Tutti low-priority, nessuno bloccante per F1 NOT-production. Documentati qui per traccia completa pre-production review (~2-3h totali fix se attivati prima di deploy reale).

## Reversibility

| Scenario                                        | Cost                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rollback completo B1 (revert PR pre-merge)      | ~5min: `git checkout main + git branch -D feature/auth-e2e-hardening-b1`. Deps rimovibili via `pnpm remove`. Container Redis resta (era già attivo pre-B1 per future use).                                         |
| Disabilitare rate limiting (mantenendo lockout) | ~10min: rimuovi `APP_GUARD: AppThrottlerGuard` provider in `app.module.ts`. Lascia ThrottlerModule import (provider DI resta valido per future re-enable).                                                         |
| Disabilitare lockout (mantenendo rate limiting) | ~10min: rimuovi `LockoutService` provider in `auth.module.ts` + revert chiamate in `auth.service.ts` (3 punti: `checkLockout`, `recordFailedAttempt`, `resetAttempts`).                                            |
| Switch storage Redis → in-memory                | ~15min: sostituisci `ThrottlerStorageRedisService` con default `ThrottlerStorageService` (in-memory) nella `forRootAsync`. **NB**: perdita persistenza counter su restart + no multi-instance ready. Sconsigliato. |
| Tuning soglie senza re-deploy                   | Modifica env vars + restart dev/container. Niente code change.                                                                                                                                                     |

## Security considerations

### Cosa è ENFORCED (B1)

- **Rate limit `/auth/login` + `/auth/login-pin`**: 5 tentativi/min per IP. 6° → 429.
- **Rate limit `POST /tenants`**: 3 creazioni/h per **userId** (decode JWT, no verify). Attacker autenticato non bypassa con IP rotation.
- **Account lockout `/auth/login`**: 10 tentativi falliti in 15min → blocco 15min. Sliding window Redis.
- **Account lockout `/auth/login-pin`**: stessa logica con key `(tenantId, deviceId)`.
- **Anti-timing-leak**: lockout check PRE-DB lookup user → attacker non distingue email esistente vs non esistente via response time.
- **Anti user-enumeration**: `Retry-After: 900` fissi sempre, retryAfterSec reale solo in log.
- **Audit log**: `auth.account_locked` su transizione → locked (totale audit actions 11). `afterValue` con `lockoutKeyHash` sha256[0:8] (no email/deviceId plain text — PII masking).
- **Reset doppio** su login success: Redis (`resetAttempts`) + DB (`recordSuccessfulLogin` azzera `failedLoginAttempts`).
- **Fail-open Redis**: se Redis down, lockout disattivato ma auth continua a funzionare (rate-limiting via Throttler resta primo strato).

### Cosa NON è enforced (tech debt B2/F1+)

- **Email notification on lockout/theft** (B2 sessione 9): user non sa che il proprio account è stato bloccato/rubato.
- **Rate limit dedicato login-pin** per `(tenantId, deviceId, ip)` triplet (B2): oggi `auth-strict` IP-only su login-pin è ragionevole ma non ottimale.
- ~~**DoS-by-account-name** (TD-H)~~: **RESOLVED PR 2 sessione 12**. Lockout key ora include `tenantId` — un attacker che conosce un'email blocca SOLO il tenant target, NON cross-tenant. Captcha post-3-fail rimane backlog F1+.
- **Session-stolen JWT** (TD-E): rate-limit + lockout proteggono il login originale; theft detection D2-vitest protegge refresh; ma JWT access rubato (15min) consuma bucket vittima fino a scadenza naturale. Email notify B2 mitiga.
- **Cross-endpoint DoS** (TD-F): client legittimo può consumare `default=60/min` × N route diverse → 60×N totali. Mitigato in pratica da limite IP-level (rete dev locale), ma da risolvere con custom `generateKey` pre-production.

## Test summary (STOP 4)

```
Test Files  4 passed (4)
     Tests  25 passed (25)
  Duration  ~681ms
```

- `auth.service.spec.ts`: 6 PASS (zero regression vs baseline D2a+D2-vitest+D2b)
- `lockout.service.spec.ts`: **8 PASS** (checkLockout x2, recordFailedAttempt x3, resetAttempts, fail-open x2)
- `throttler.module.spec.ts`: **9 PASS** (skipIfMetadataAbsent x3, extractSubFromAuthHeader x6)
- `users.service.spec.ts`: 2 PASS (zero regression)

Helper estratti per testability (refactor minimal, zero behaviour change):

- `apps/api/src/throttler/utils/jwt-decode.util.ts` (extractSubFromAuthHeader)
- `apps/api/src/throttler/utils/skip-if-metadata.util.ts` (skipIfMetadataAbsent higher-order)

## Smoke summary (STOP 2 + 3)

| Smoke | Scenario                                                                                                                                      | Verdetto |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A     | `/auth/login` rate limit: 5x 401 + 6° 429                                                                                                     | ✅       |
| B     | `/auth/login-pin` rate limit: 5x 401 + 6° 429 (hash bucket distinto)                                                                          | ✅       |
| C     | `tenant-create` custom tracker: 3x 400 + 4° 429, key `user:019e1e40-...` (NON ip:fallback)                                                    | ✅       |
| D     | Cross-endpoint isolation: `/health` 200 dopo lockout su `/auth/login`                                                                         | ✅       |
| E     | Lockout `/auth/login` (THRESHOLD=3 temp): 2x 401 + 3° 429 (promosso in-flight) + 4°+ 429 con `Retry-After: 900` + audit `auth.account_locked` | ✅       |
| F     | Reset su success: 2 fail → ZCARD=2 + DB counter=2 → login OK → ZCARD=0 + DB counter=0                                                         | ✅       |
| G     | Lockout `/auth/login-pin`: key `pin:tenant:<uuid>:device:smoke-pin-device` + NO DB counter increment (D2b §8)                                 | ✅       |
| H     | Key isolation: A blocked, B (email diversa) → 401 NOT 429                                                                                     | ✅       |

## TD-H resolution (PR 2 sessione 12)

**Data:** 2026-05-16  
**Branch:** `feat/pr2-td-h-td-aj-lockout-pertenant-errorcode`  
**Scope:** lockout key `/auth/login` da `email:<email>` a `tenant:<tenantId>:email:<email>`.

### Decisione implementativa (Sub-DP B1 lockata)

Pattern composition opaque-identifier conservato: `LockoutService` API (`recordFailedAttempt(identifier)`, `checkLockout(identifier)`, `resetAttempts(identifier)`) NON modificata. La composition `tenant:<id>:email:<email>` avviene in `auth.service.ts` (helper `LOCKOUT_KEY_LOGIN`).

**Rejected alternativa**: refactor signature `LockoutService.recordFailedAttempt(email, tenantId)` come parametri espliciti. Motivazione reject: SRP-violation (LockoutService non deve conoscere multi-tenancy), API churn inutile, login-pin già usa pattern composito `pin:tenant:<id>:device:<id>` con stesso approccio.

> **Note:** Discovery #39 (frontend `noUncheckedIndexedAccess` strict + `FALLBACK_MESSAGE` const literal pattern) emersa durante l'implementazione TD-AJ — semanticamente è frontend TS, quindi documentata in [ADR-0016 §Discovery #39](./ADR-0016-playwright-e2e-frontend-ci.md). Cross-link corretto in cleanup post-merge PR 2.

### Lesson learned: lockout key naming convention per-tenant

1. **Multi-tenant security keys vanno SEMPRE composte con tenantId** anche se l'identifier semantico (email, device) ha unicità globale apparente. Senza tenant scope, un attacker cross-tenant può abusare il bucket per fare DoS-by-account-name sopra account su tenant diversi.
2. **Pattern composition opaque vs explicit param**: per servizi infrastrutturali (lockout, rate-limit, cache key), preferire identifier opaque-string + composition al caller. Mantiene il servizio agnostico al modello dominio e permette evoluzione independente delle key (es. aggiungere `sedeId:`, `deviceId:` senza touch al servizio).
3. **Test cross-tenant via composition**: i 3 test unit cross-tenant vivono in `auth.service.spec.ts` (livello composition), NON in `lockout.service.spec.ts`. Test integration su key composition è più espressivo del test su signature.

### Migration note Redis (deploy environments)

Le key esistenti pre-PR 2 (`lockout:locked:email:*`, `lockout:attempts:email:*`) restano nel cluster Redis ma diventano dead key (15min TTL le auto-pulisce). Per cleanup esplicito post-deploy:

```bash
redis-cli --scan --pattern "lockout:locked:email:*" | xargs -r redis-cli DEL
redis-cli --scan --pattern "lockout:attempts:email:*" | xargs -r redis-cli DEL
```

Operation read-safe (DEL key inesistenti = no-op). Eseguire DOPO deploy nuova versione per evitare race vs login flow concorrente.

### Discovery #42 — LockoutExceptionFilter naming inconsistency (`code` vs `errorCode`)

**Macro-task:** PR cleanup post-merge sessione 12 (formalizzazione empirica di nota già presente in [ADR-0016 §TD-AJ resolution](./ADR-0016-playwright-e2e-frontend-ci.md#td-aj-resolution-pr-2) lesson learned point 4).

**Root cause:** `LockoutExceptionFilter` (B1 sessione 8, [apps/api/src/auth/filters/lockout-exception.filter.ts](../../apps/api/src/auth/filters/lockout-exception.filter.ts)) emette body 429 con field `code: 'E_AUTH_ACCOUNT_LOCKED'`. Naming legacy precedente alla taxonomy `errorCode` introdotta da [TD-AJ PR 2](./ADR-0016-playwright-e2e-frontend-ci.md#td-aj-resolution-pr-2) (`apps/api/src/common/error-codes.ts` enum centralizzato). Smoke browser post-merge Nicolò ha confermato la divergenza visiva: alert 401 mostra "Email o password non corrette" (mapping `messageForErrorCode(errorCode)`), alert 429 mostra raw message "Account temporaneamente bloccato..." (parseError frontend non riconosce `code` → fallback `E_UNKNOWN` → però `body.message` è già localizzato in italiano, quindi UX non rotta, solo non i18n-ready per future locale switch).

**Fix applicato in PR 2:** nessuno (out of scope DP3.1 lockato su `/auth/login` 401). Scope allargato in TD-AY ADR-0016 — vedi sezione dedicata.

**Lesson generalizzabile:** ogni nuovo exception filter che emette error body strutturato deve usare la taxonomy `errorCode` standardizzata definita in [apps/api/src/common/error-codes.ts](../../apps/api/src/common/error-codes.ts). Pattern senior NestJS: enum centralizzato + DTO type → no field naming drift cross-endpoint (`code` vs `errorCode` vs `error` ecc.) → frontend `parseError()` legge UN solo field con fallback semantico predicibile.

### Tech debt cross-link

- **TD-AY ADR-0016** (scope espanso post-PR cleanup sessione 12): allineamento taxonomy `errorCode` unificata cross-endpoint, include LockoutExceptionFilter (`code` → `errorCode` rename) come 1 dei 3 punti scope. Vedi [ADR-0016 §TD-AY](./ADR-0016-playwright-e2e-frontend-ci.md#tech-debt-registrato-8--1-update--7-nuovi).

## Related ADRs

- [ADR-0008](./ADR-0008-auth-module.md) — Auth module D2a/D2b (carry-over §3 rate limiting + D2b §8 login-pin counter design)
- [ADR-0010](./ADR-0010-tenant-bootstrap.md) — Tenant bootstrap (carry-over tech debt #4 rate limit POST /tenants)
- [ADR-0012](./ADR-0012-frontend-auth-flow.md) — Frontend auth flow (carry-over Security "No rate limiting")
- [ADR-0016](./ADR-0016-playwright-e2e-frontend-ci.md) — Playwright frontend CI (TD-AJ resolution PR 2 co-merged)

## Next: B2 (sessione 9 programmata)

- **Email notification on theft detection**: `auth.theft_detected` (esistente D2-vitest) + `auth.account_locked` (nuova B1) → email all'utente "abbiamo bloccato/rubato la tua sessione". Stack: `nodemailer` + MailHog (dev MTA in container).
- **Rate limit `/auth/login-pin` per `(tenantId, deviceId, ip)`**: ADR-0008 D2b §8 carry-over completo. Custom tracker pattern simile a `tenant-create` ma triplet.
- **E2E test full Nest bootstrap**: primo test E2E del progetto. `supertest` + `Test.createTestingModule(AppModule)` + Testcontainers Postgres + Redis reale. Verifica integrazione completa (no più mock).
- **Verify TD-B empiricamente**: spegnere Redis a runtime + osservare comportamento ThrottlerStorage (fail-open vs fail-closed) + decidere strategia + documentare.

## Notes

- Versioni installate (2026-05-13):
  - `@nestjs/throttler@6.5.0`, `@nest-lab/throttler-storage-redis@1.2.0`, `ioredis@5.10.1`, `@nestjs/config@4.0.4`
  - reflect-metadata già a 0.2.2 (peer satisfied)
- LOC totali B1 (effettivi post-Prettier, conta `wc -l` + git diff stat):
  - Production code: ~700 LOC (redis 86 + throttler module 75 + guards 83 + decorators 38 + utils 79 + lockout 153 + filter 53 + edits auth.service.ts +97 + wiring app.module.ts/auth.module.ts ~36)
  - Test code: 303 LOC (lockout 197 + throttler helpers 106)
  - Docs: ADR-0013 (~37KB post cleanup follow-up con 7 TD aggiunti), PROGRESS update, README update
- Audit action enum (string-based, no Postgres enum) totale 11: 9 esistenti + `tenant.created` (D4) + `auth.account_locked` (B1). Nessuna migration necessaria.
- Soglia per registro centralizzato `audit-actions.ts` (decisione D2-vitest) ancora non raggiunta (11 < 15). Re-evaluation in B2.
