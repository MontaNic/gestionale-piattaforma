# ADR-0008 — Auth module D2a (email/password + JWT + refresh rotation)

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** `PROJECT_BRIEF.md` §B1 (auth/ruoli/permessi), §C2 (API design), §C5 (sicurezza), [ADR-0005](./ADR-0005-prisma-data-layer.md) (data layer), [ADR-0007](./ADR-0007-nestjs-api-scaffold.md) (NestJS scaffold)

## Context

D2 (Auth module) richiede: argon2 password hashing, JWT con refresh rotation, sessioni stateful per device, PIN login per POS, audit log, rate limiting baseline.

Per disciplina sui tempi (calibrazione realistica 5h vs preventivo 3h), si è scelto di **splittare il macro-task in 3 PR coordinate**:

- **D2a** (questa PR): email/password login + JWT pair + refresh rotation base + logout + `/me` + tenant middleware + ADR
- **D2-vitest** (prossima): setup Vitest + 3 test essential AuthService + theft detection completa (revoke all sessions su token rotato re-used)
- **D2b** (successiva): PIN setup endpoint + `/auth/login-pin` + uniqueness PIN applicativa + 2 test PIN

Questo ADR documenta le decisioni di D2a, con sezioni esplicite per le parti rimandate.

## Decisions

### 1. Argon2id per password (e in D2b per PIN)

`argon2.hash` / `argon2.verify` con default parameters (`m=65536 KiB, t=3, p=4`). Argon2id è OWASP-recommended 2023+, resistente sia a GPU/ASIC sia a side-channel.

### 2. JWT HS256 con secret simmetrico (single-service)

`@nestjs/jwt` + `JwtModule.register({ secret: env.JWT_SECRET })`. HS256 è sufficiente in F1 (un solo backend NestJS firma + verifica). Quando arriveranno servizi separati che vogliono validare i JWT senza condividere il secret (es. edge worker, microservizio), valuteremo RS256 (chiave asimmetrica). Reversibility documentata in sezione "Reversibility".

### 3. Rate limiting POSTERGATO

Niente `@nestjs/throttler` / Redis storage in D2a. Mitigazione baseline: `users.failed_login_attempts` counter incrementato su password sbagliata (zero su login success). Lockout/throttling reale in macro-task dedicato "Auth hardening" (insieme a theft detection completa).

### 4. Tenant resolution via header `X-Tenant-Slug`

Email unique per tenant (`@@unique([tenantId, email])`), quindi serve disambiguazione al login. Tre opzioni considerate:

| #   | Opzione                               | Esito                                                                                      |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| (a) | **Header `X-Tenant-Slug`**            | **Chosen** — esplicito, no DNS setup, no SSL wildcard, frontend lo passa sempre            |
| (b) | Subdomain `tenant.api.gestionale.com` | Rejected — richiede DNS wildcard + SSL wildcard, complicato pre-prod                       |
| (c) | Body field `tenantSlug` nel DTO login | Rejected — header e' più ergonomico per backend middleware, body inquina la response shape |

Implementazione: `TenantMiddleware` scoped a `/auth/login` only (D2b aggiungera `/auth/login-pin`). `/auth/refresh` deriva tenantId dal payload JWT del refresh token (non serve header). Endpoint protetti derivano tenantId dal JWT payload via `JwtStrategy.validate()` (anti-spoofing — vedi decisione B).

### 5. Seed dev data opt-out (production), not opt-in

`packages/db/prisma/seed.ts` aggiunge tenant "demo" + sede + admin `admin@demo.local` + role + 32 mappings + assignment quando `NODE_ENV !== 'production'`. Pattern: dev convenience by default, prod safety via env explicit. Verificato che `prisma db seed` con default `NODE_ENV` undefined crea i dati di test; con `NODE_ENV=production` esplicito li skippa.

### 6. JWT_SECRET in `.env` (gitignored) + `.env.example` placeholder

64-byte base64-encoded secret in `.env` reale (generato `openssl rand -base64 48`). `.env.example` ha placeholder + comando di generazione. Stessa policy di `DATABASE_URL` consolidata.

### 7. JWT payload MINIMAL + lookup runtime per roles/permissions

Claims: `{ sub: userId, tenantId, sessionId, type: 'access'|'refresh', iat, exp }`. Niente roles/permissions inline.

**Pro:**

- Revoca permessi istantanea (cambia in DB, prossima query `/me` o policy guard riflette subito)
- Token piccoli (~250 byte vs 2-5KB con permissions inline)
- Niente "stale token" con privilegi rimossi che ancora autorizzano

**Con:**

- 1-2 query Prisma per ogni request autenticato (session lookup + user lookup in `JwtStrategy.validate()`)
- F1 acceptable (latenza < 10ms su DB locale)

**Mitigazione futura tracciata in tech debt**: cache Redis TTL=30s di session→user lookup quando il throughput diventerà bottleneck.

### 8. PIN POS rimandato a D2b

PIN login non implementato in D2a per disciplina tempi. Schema `users.pin_hash` esiste e seed admin **non** imposta PIN (resta `NULL`). Endpoint `/auth/pin-setup` e `/auth/login-pin` arriveranno in D2b.

**Scoperta importante D2a**: il prompt originale prevedeva una migration `unique_pin_per_tenant` (`CREATE UNIQUE INDEX ... ON users(tenant_id, pin_hash) WHERE pin_hash IS NOT NULL`). **Rimossa** dopo analisi: argon2 usa salt random → l'hash di `"1234"` per user A e' diverso dall'hash di `"1234"` per user B → la unique constraint sull'hash non scatta mai per duplicati real-world clear-text. Falsa sicurezza.

**Soluzione in D2b**: verifica applicativa in `pinSetup()`:

```typescript
const usersWithPin = await prisma.user.findMany({ where: { tenantId, pinHash: { not: null } } });
for (const u of usersWithPin) {
  if (u.id !== userId && (await argon2.verify(u.pinHash, pin))) {
    throw new ConflictException('E_AUTH_PIN_TAKEN');
  }
}
```

Per F1 OK (poche user per tenant, scan veloce). Per F2/F3 ottimizzazione possibile con HMAC deterministico come lookup index — tracciato in tech debt.

### 9. Audit log best-effort

`auth.service.recordAuditLogin()` scrive in `audit_logs` su login success/failure e logout. Wrapped in try/catch: il fallimento dell'audit log **non blocca** l'auth (resiliency by design). Errore loggato a livello Logger ma non rilanciato.

Razionale: l'audit log e' importante per compliance ma non e' una primary feature. Se PostgreSQL e' parzialmente degraded ma puo' ancora autenticare, accettiamo audit "miss" per non bloccare l'utente.

### 10. Vitest setup RIMANDATO a D2-vitest

Niente Vitest setup in D2a. Lo abbiamo riservato a una micro-PR dedicata `D2-vitest` (~1.5h) che imposta:

- `vitest.config.ts` root + per-workspace
- `apps/api/test/setup.ts`
- 3 test essential su `AuthService` con mock di `DbService`:
  1. login success → returns JWT pair + creates session
  2. login wrong password → throws + `failed_login_attempts++`
  3. tenant non esiste (resolution upstream nel middleware) → throws

Ragione del rinvio: setup framework di test + scrittura mock + assertion utili = ~1.5h non comprimibili. Meglio una PR dedicata che dimostra "primo Vitest setup" che mischiare con auth core.

## D2a — Endpoint finali

| Endpoint               | Method | Public | Note                                                 |
| ---------------------- | ------ | ------ | ---------------------------------------------------- |
| `/api/v1/`             | GET    | ✅     | "Gestionale API" (root)                              |
| `/api/v1/health`       | GET    | ✅     | DB ping, 200 / 503 ServiceUnavailableException       |
| `/api/v1/auth/login`   | POST   | ✅     | email + password + `X-Tenant-Slug` header → JWT pair |
| `/api/v1/auth/refresh` | POST   | ✅     | refresh token → JWT pair (rotation)                  |
| `/api/v1/auth/logout`  | POST   | 🔒     | invalida session corrente, 204                       |
| `/api/v1/me`           | GET    | 🔒     | user + roles + permissions fresh dal DB              |

## Decisione architetturale B — TenantMiddleware scoped pre-auth only

Il middleware `TenantMiddleware` e' applicato SOLO a endpoint pre-auth (`POST /auth/login`, in futuro `POST /auth/login-pin`). Sugli endpoint protetti, `tenantId` viene dal payload JWT via `JwtStrategy.validate()` — fonte autorevole, anti-spoofing.

Senza questo scoping, l'header `X-Tenant-Slug` sarebbe richiesto da ogni request autenticata (rumoroso lato client) E un client malicioso post-auth potrebbe **inviare un X-Tenant-Slug diverso dal tenantId del proprio JWT**, tentando di accedere a dati di altro tenant. Trust source-of-truth: JWT firmato dal nostro secret.

Verificato durante smoke test: `/auth/refresh` senza header funziona (tenantId dal payload); `/auth/login` senza header restituisce 401 E_AUTH_TENANT_REQUIRED.

## Decisione architetturale E — JwtAuthGuard globale + `@Public()` opt-out

Registrato come `APP_GUARD` globale in `AuthModule`. Ogni endpoint richiede JWT valido di default. Endpoint pubblici dichiarano `@Public()` decorator (root, /health, /auth/login, /auth/refresh).

Pattern security-by-default: dimenticare `@Auth()` su un endpoint nuovo = endpoint **protetto** by default (errore safe), non aperto. L'inverso (guard per-controller + opt-in) e' rejected perche' un controller nuovo non decorato sarebbe pubblico — errore unsafe.

## Considered Alternatives (full table)

| Decisione            | Alternativa                                                        | Esito                    | Razionale                                                                                                                      |
| -------------------- | ------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Hash password        | bcrypt                                                             | Rejected                 | argon2id e' moderno (vincitore Password Hashing Competition 2015), OWASP 2023+ raccomanda                                      |
| Hash password        | scrypt                                                             | Rejected                 | Argon2 dominio piu' attivo, libreria Node mantenuta                                                                            |
| JWT algo             | RS256 (asymmetric)                                                 | Rejected (F1)            | Inutile complessita' single-service; vale la pena con microservizi                                                             |
| Validation           | Zod                                                                | Rejected                 | class-validator e' NestJS-idiomatic, integrazione ValidationPipe immediata. Zod e' opzione futura quando shared FE/BE schemas. |
| Tenant resolution    | Subdomain                                                          | Rejected                 | DNS + SSL wildcard pre-prod overhead                                                                                           |
| Tenant resolution    | Body field                                                         | Rejected                 | Header piu' ergonomico, response shape pulita                                                                                  |
| JWT payload          | Roles/permissions inline                                           | Rejected                 | Stale token problem + token grande                                                                                             |
| Session              | Stateless JWT only                                                 | Rejected                 | Niente logout immediato, niente revoca                                                                                         |
| Rate limiting        | @nestjs/throttler + Redis                                          | Postergato               | Macro-task dedicato Auth hardening                                                                                             |
| Refresh rotation     | Stateless (no DB)                                                  | Rejected                 | Niente theft detection, niente lifecycle                                                                                       |
| Theft detection      | Full revoke-all-on-reuse                                           | **Postergato D2-vitest** | Implementazione + test richiede setup test framework                                                                           |
| PIN POS              | Tutto in D2a                                                       | **Postergato D2b**       | Calibrazione tempi                                                                                                             |
| Migration unique PIN | `CREATE UNIQUE INDEX ON users(tenant_id, pin_hash) WHERE NOT NULL` | **Rimossa**              | Argon2 salt random vanifica la constraint (falsa sicurezza)                                                                    |
| Vitest setup         | In D2a                                                             | **Postergato D2-vitest** | PR dedicata che dimostra primo test framework setup                                                                            |

## Consequences

### Positive

- **Login funzionante end-to-end** in dev: admin@demo.local + password Admin123! + tenant demo → JWT pair + session record + audit log
- **Refresh rotation base**: vecchia session disattivata, nuova creata. Re-use vecchio token → 401 (theft detection BASE, no revoke-all)
- **Logout** invalida session: `/me` subito dopo logout = 401
- **Pattern security-by-default**: JwtAuthGuard globale + `@Public()` opt-out
- **Anti-spoofing tenant**: tenantId dal JWT payload sugli endpoint protetti, header trust solo pre-auth
- **No info leak su credenziali**: single `E_AUTH_INVALID_CREDENTIALS` per email-non-esiste + password-errata + utente-disabilitato
- **Audit log entries**: login.success / login.failure / logout in `audit_logs` con ip + user_agent
- **Argon2id**: standard OWASP, robusto su CPU/GPU/ASIC

### Negative / Trade-off

- **Theft detection BASE**: token rotato re-used da attaccante → 401 sull'attaccante MA la session rubata resta attiva. Detection FULL (revoke ALL sessions on token reuse) rimandata a D2-vitest. Mitigazione: refresh token hashed in DB, attaccante deve avere accesso al token cleartext fresh.
- **Rate limiting assente**: brute force su `/auth/login` non bloccato a livello applicativo. `failed_login_attempts` viene incrementato ma niente lockout. Mitigato in dev/staging da rete locale; in produzione richiede Auth hardening macro-task.
- **PIN POS non implementato**: D2b futuro
- **JWT_SECRET single value**: rotation richiede invalidation di tutti i token esistenti. Per produzione con N istanze API, rotation graceful richiede dual-secret (validate-old + sign-new) — tracciato per macro-task Production prep.
- **1-2 query DB per request autenticata**: stateful pattern, mitigato in F1 da DB locale. Cache Redis tech debt.
- **`/auth/login` senza header X-Tenant-Slug**: 401 generic. Frontend deve sempre sapere il tenant prima del login. Possibile pattern: pagina di login chiede sub-tenant prima delle credenziali, o tenant inferito da subdomain in produzione.

### Neutral

- **`packages/db` con argon2 dep**: il seed lo richiede per hash admin password. Argon2 e' anche dep di apps/api. pnpm hoist deduplica.
- **Audit log come `Json` per before/after**: campi `beforeValue` / `afterValue` JSONB su `audit_logs`. Pattern open per future entity diff tracking.

## Reversibility

| Scenario                                  | Cost                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Switch da HS256 a RS256                   | Medium — generate keypair, modify JwtModule config, distribute public key, rotate. ~1-2h                                                                                                         |
| Switch da class-validator a Zod           | Medium — riscrivere DTO + validator integration in NestJS. ~2-3h                                                                                                                                 |
| Aggiungere rate limiting                  | Low — `@nestjs/throttler` + Redis storage, apply guard a `/auth/*`. ~1h                                                                                                                          |
| Implementare theft detection FULL         | Low — modify `AuthService.refresh()` per detect "token gia' rotato": se trova `refresh_token_hash` matching su session `is_active=false`, → revoke all sessions del user. ~30 min + test ~30 min |
| Sostituire stateful session con stateless | High — perdiamo logout immediato. Sconsigliato.                                                                                                                                                  |

## Security considerations

### Brute force on `/auth/login`

- **Mitigazione D2a**: `failed_login_attempts` counter su user. Reset su login successo.
- **Mitigazione futura**: rate limiting (Auth hardening macro-task), lockout temporaneo dopo N tentativi, ban IP via Redis.

### Refresh token theft

- **Detection BASE D2a**: refresh token hashed in DB. Re-use post-rotation → 401. Vecchia session disattivata immediately su rotation success.
- **Detection FULL postergata D2-vitest**: se un refresh token gia' usato (session `is_active=false`) torna a riapparire, REVOKE ALL sessions del user (attaccante e legittimo). User costretto a re-login.

### Token in transit

- HS256 con secret 64 byte base64 (`openssl rand -base64 48` → 64 caratteri = 384 bit entropy). Robusto contro HMAC brute force.
- Trasporto: in F1 dev HTTP locale, in produzione HTTPS via Caddy (ADR-0001). Token mai loggato.

### Tenant cross-pollination

- JWT payload contiene `tenantId`. `JwtStrategy.validate()` confronta `payload.tenantId === user.tenantId` (lookup DB). Mismatch → 401 E_AUTH_USER_INVALID.
- Tenant resolution pre-auth via header `X-Tenant-Slug` solo su `/auth/login` (and future `/auth/login-pin`). Su endpoint protetti, header ignorato.

### Audit gaps

- Audit log e' best-effort: se la write fallisce (PG down momentaneo), l'auth procede e logga warning. Pattern accettato per F1, da rivalutare con observability hardening (alerting su audit log write failure).

## Notes

- Versioni installate (2026-05-13):
  - `@nestjs/jwt@11.x`, `@nestjs/passport@11.x`
  - `passport@0.7.x`, `passport-jwt@4.x`
  - `argon2@0.44.0` (gia' in packages/db per seed)
  - `class-validator@^0.14`, `class-transformer@^0.5`
- Schema `sessions` gia' completo da Macro-task A: `device_id`, `device_type` enum (web/pos_tablet/pos_desktop/mobile), `refresh_token_hash` (argon2id), `expires_at`, `is_active`, `last_seen_at`. D2a usa `device_type: 'web'` (user-agent come `device_id`). D2b distinguera' `pos_tablet`/`pos_desktop` per PIN login.
- ESLint root config aveva gia' override scoped per `apps/api/**/*.ts` da ADR-0007. Niente modifiche in D2a.
- `TenantMiddleware` registrato in `app.module.ts` con `RequestMethod.POST` esplicito su `/auth/login`. Endpoint futuri pre-auth (es. `/auth/login-pin`, `/auth/password-reset`) si aggiungeranno alla lista.

## D2-vitest implementation (2026-05-13 update)

Estensione D2-vitest: Vitest baseline + theft detection FULL + 4 test essential su `AuthService`. Decisione 10 dell'ADR originale (Vitest setup rimandato) viene chiusa qui.

### Vitest setup

- **Vitest 3.2.4** (downgrade da 4.1.6 — bug noto `rolldown@1.0.0` native binding non risolto da pnpm)
- **Pattern `projects` array** in root `vitest.config.mts` (Vitest 4-ready API moderna, niente `workspace` field deprecato)
- **`.mts` extension** per i config Vitest: `vitest.config.mts` root + `apps/api/vitest.config.mts`. Vite 7 richiede ESM-only e `apps/api` ha CJS package.json, `.mts` forza loading ESM senza toccare il `type` del package
- **`apps/api/test/setup.ts`** placeholder (vuoto) per future global mocks/fixtures
- **`--passWithNoTests`** flag sugli script `test`/`test:coverage`: workspace senza spec files non rompono CI (utile per `packages/db` finche' non ha test)
- **Turbo task `test`**: rimosso `dependsOn: ["^build"]` (decisione E nel piano D2-vitest). Test indipendenti, no upstream build dependency. `outputs: ["coverage/**"]` mantenuto per cache coverage future
- **Root script `test`** da `echo no tests yet && exit 0` a `turbo run test` (propaga ai workspace come `typecheck`/`lint`)

### Mock strategy (decisione D nel piano D2-vitest)

**Bypass del DI container NestJS** per i test: `AuthService` instanziato manualmente con `new AuthService(mockDb, mockUsers, mockJwt)`. Motivo: Vitest+esbuild non emette `emitDecoratorMetadata` (stesso problema scoperto in D1 con tsx, vedi ADR-0007 sezione "course corrections"). `Test.createTestingModule().compile()` fallisce risoluzione DI senza metadata reflection.

Approccio:

- `vi.mock('argon2', ...)` module-level: `verify` configurabile per test, `hash` ritorna stub deterministico (evita CPU cost del KDF reale durante test)
- `vi.mock('@gestionale/db', ...)` module-level: stubs di `id()`, `prisma`, `uuidv7`, `createPrismaClient` (alcuni non-chiamati ma richiesti per non rompere import statici)
- **Mock providers per-test** via `vi.fn()`: `users` (con findByTenantEmail/incrementFailedAttempts/recordSuccessfulLogin), `prisma` (session.{create,findUnique,update,updateMany}, auditLog.create), `jwt` (signAsync/verifyAsync)
- **Cast `as unknown as DbService` / `UsersService` / `JwtService`**: type-safe abbastanza per testing, evita istanziazione classi reali

Trade-off vs Test.createTestingModule(): perdiamo testing del DI tree (es. moduleInit ordering), guadagniamo velocita' + zero setup compiler. Per business logic test e' la scelta giusta. E2E test (futuro macro-task) useranno full Nest bootstrap.

### Theft detection FULL (Decision C/D nel piano D2-vitest)

`AuthService.refresh()` ora distingue 5 scenari nel decision tree:

1. **JWT signature/expiry invalid** → 401 generic
2. **Session absent / userId mismatch / expired** → 401 generic
3. **Hash mismatch** (token forged) → 401 generic
4. **Session ACTIVE + hash matches** → rotation D2a flow (vecchia `is_active=false`, nuova creata, audit `auth.refresh.success`)
5. **Session NOT ACTIVE + hash matches** → **THEFT TRIGGER**:
   - `updateMany` su tutte le user sessions con `isActive: true` → tutte revocate
   - `auditLog.create` con `action: 'auth.theft_detected'` + payload forense: `{revokedSessionCount, suspectedSessionId, attackerIp, attackerUserAgent}`
   - `throw UnauthorizedException('E_AUTH_THEFT_DETECTED')`

**Verifica empirica E2E** (2026-05-13 00:41 UTC):

```
1. login → refresh_A
2. refresh(refresh_A) → refresh_B (rotation OK)
3. refresh(refresh_A) re-use → 401 E_AUTH_THEFT_DETECTED
4. SELECT * FROM sessions WHERE user_id = admin AND is_active = true → 0 rows
5. SELECT * FROM audit_logs WHERE action = 'auth.theft_detected' → 1 row
   afterValue = {
     "attackerIp": "::ffff:127.0.0.1",
     "attackerUserAgent": "curl/7.81.0",
     "suspectedSessionId": "019e1e59-...",
     "revokedSessionCount": 1
   }
```

### Audit log enum espanso

`AuditAction` type union ora include 5 actions:

- `auth.login.success` — issueTokensAndCreateSession (incluso anche post-refresh, ma con seguente)
- `auth.login.failure` — wrong password / user not found / inactive (reason discriminante in afterValue)
- `auth.logout` — explicit logout endpoint
- `auth.refresh.success` — successful rotation (con `previousSessionId` in afterValue per join tracking)
- `auth.theft_detected` — refresh token reuse rilevato (payload forense completo)

### 4 test essential (apps/api/src/auth/auth.service.spec.ts)

| #   | Test                                                                                               | Cosa copre                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `login success: returns JWT pair + creates session + records audit`                                | Happy path: argon2.verify OK, session.create chiamato, auditLog `auth.login.success`, recordSuccessfulLogin chiamato, incrementFailedAttempts NON chiamato                                                                                         |
| 2   | `login wrong password: throws + increments failed_login_attempts`                                  | argon2.verify false → throws UnauthorizedException, incrementFailedAttempts chiamato, session.create NON chiamato, audit `auth.login.failure` con `reason: 'wrong_password'`                                                                       |
| 3   | `login user not found: throws E_AUTH_INVALID_CREDENTIALS (no info leak)`                           | findByTenantEmail null → throws con stesso messaggio di test 2 (no enumeration), incrementFailedAttempts NON chiamato (no user da incrementare), audit con `reason: 'user_not_found_or_inactive'`                                                  |
| 4   | `refresh with rotated token: triggers theft detection, revokes all user sessions, audit forensics` | session.findUnique ritorna session con `isActive: false` + hash match → updateMany chiamato con `{userId, isActive: true}` + audit `auth.theft_detected` con payload forense completo + throws E_AUTH_THEFT_DETECTED + session.create NON chiamato |

Tempo run: ~8ms (4 tests). Setup totale ~380ms (transform/collect/prepare).

### Considered Alternatives (D2-vitest update)

| Decisione             | Alternativa                               | Esito              | Razionale                                                           |
| --------------------- | ----------------------------------------- | ------------------ | ------------------------------------------------------------------- |
| Vitest version        | 4.1.6 (latest)                            | Rejected           | Bug rolldown native binding non risolto da pnpm                     |
| Config file extension | `.ts` con package type:module su apps/api | Rejected           | Romperebbe NestJS CJS interop                                       |
| DI testing            | Test.createTestingModule                  | Rejected (per ora) | esbuild no emit metadata, stesso problema D1 tsx                    |
| DI testing            | swc-node + unplugin-swc Vite              | Rejected (per ora) | Setup overhead non giustificato per 4 test                          |
| Mock argon2           | argon2 reale + clean DB                   | Rejected           | CPU cost KDF reale rallenta test (~100ms/verify)                    |
| Theft action          | Solo audit, no revoke                     | Rejected           | Defense in depth: il legittimo user deve re-login, attacco rilevato |
| Theft action          | Revoke + force email notification         | Rejected (per ora) | Email service ancora non setupato; F1+                              |

### Notes (D2-vitest)

- Coverage non misurato in CI (script `test:coverage` disponibile localmente). Tracciato come follow-up: aggiungere step CI `pnpm test:coverage` quando ci saranno piu' di 10 test e vorremo soglia minima
- E2E test (vero Nest bootstrap, DB reale via Testcontainers o postgres dev) RIMANDATI a macro-task dedicato "Auth E2E hardening" insieme a rate limiting + theft detection enhancement (email notify)
- Le 5 azioni audit (`auth.*`) sono il primo enum strutturato di azioni. Quando arriveranno B/B/B... modules domain (comande, cassa, ecc.), valuteremo un registro centralizzato `audit-actions.ts` per coerenza
