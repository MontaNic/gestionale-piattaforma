# ADR-0014 — Auth E2E hardening B2a: email notifications + login-pin per-tenant rate limit

- **Status:** Accepted
- **Date:** 2026-05-14
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Macro-task:** B2a (split di B2 deciso sessione 9; B2b = sessione 10 con E2E full Nest bootstrap + TD-B integration test)
- **Predecessor:** [ADR-0013](./ADR-0013-auth-e2e-hardening-b1.md) (B1 rate limit + lockout Redis sliding window)
- **Branch:** `feature/b2a-email-notification-login-pin-throttler`

## ✅ Status finale

**B2a completato**: email notification security + rate-limit `/auth/login-pin` per-tenant + TD-B verify empirico.

- **Email security signal**: `nodemailer@8.0.7` + Mailpit v1.30 dev MTA. 2 metodi (`sendAccountLockedEmail` + `sendRefreshTokenTheftEmail`) fail-open layered (`transporter.verify` + `sendSafe` wrapper). Content zero-PII (hashed identifier, IP, user-agent).
- **Audit immutability**: single-row con `emailSent: boolean` + `emailReason: enum | null` nel payload. Riuso `auth.theft_detected` esistente (D2-vitest) → **NO nuova action** (Discovery #23).
- **Rate-limit `/auth/login-pin`**: 4° named throttler `auth-pin` (10/60s per `(tenantId, ip)` triplet). Decorator `@LoginPinThrottle()` opt-in env-driven (pattern coerente B1).
- **Smoke E2E**: 8/8 verdi (lockout + email Mailpit + theft detect + 25 session revoked + per-tenant isolation acme vs demo).
- **TD-B verify**: LockoutService fail-open OK; ThrottlerStorage fail-CLOSED 500 → nuovo TD-AD follow-up.
- **Test Vitest**: 25/25 PASS (~720ms), zero regression.

## Context

[ADR-0013 B1](./ADR-0013-auth-e2e-hardening-b1.md) ha consolidato rate limiting + account lockout via Redis sliding window con audit log integrato. B2a chiude la parte "user-facing security signal" del hardening auth:

1. **Email notification** su eventi security (account locked, refresh token theft) — l'utente legittimo deve sapere quando il suo account viene bloccato o quando viene rilevata attività sospetta.
2. **Rate-limit dedicato `/auth/login-pin`** (carry-over TD-K ADR-0013, parziale: deviceId rimandato a TD-Y per F1 PWA).
3. **TD-B verify** comportamento ThrottlerStorage + LockoutService con Redis down (era TODO esplicito in ADR-0013 Notes).

B2b (sessione 10) coprirà E2E test full Nest bootstrap con Testcontainers Postgres + Redis reale + TD-B integration test automatizzato.

## Decisions

### D1 — Stack email: `nodemailer@8.0.7` + Mailpit `v1.30`

- **Package**: `nodemailer@8.0.7` (0 deps, ESM+CJS, MIT-0, peer-free)
- **Types**: `@types/nodemailer@8.0.0` devDep
- **Dev MTA**: Mailpit (NON MailHog — Discovery #22) v1.30 pinned (NO `:latest` per reproducibility)
  - Container `axllent/mailpit:v1.30`
  - Ports `127.0.0.1:1025` SMTP + `127.0.0.1:8025` Web UI + REST API
  - Env `MP_MAX_MESSAGES=500`, `TZ=Europe/Rome`
  - No volume (in-memory + `/tmp` ephemeral → restart = inbox vuota by design)
- **Production**: TD-Z provider esterno (Postmark/SES/Resend) trigger production deploy

### D2 — `MailService` pattern: fail-open layered a 2 livelli

- **Livello 1** — `transporter.verify()` in `onModuleInit`: PING SMTP al boot. **NO throw** se fail (log warn, app continua). Coerente con `RedisService.onModuleInit` B1.
- **Livello 2** — `sendSafe(...)` wrapper privato: `try/catch` su `transporter.sendMail`, log warn, return `Promise<boolean>` (true=sent, false=fail).
- **Razionale**: security notification è supportiva, MAI deve bloccare auth flow. Email persa ≠ porta aperta agli attacker (lockout/audit DB sono persistenti).

### D3 — Email content: zero-PII + identifierHash + i18n IT

- Lingua: italiano (UI lang `it`, PROJECT_BRIEF coerenza)
- Subject prefisso `[Gestionale]` per filtro client
- Body: solo `identifierHash` (sha256 first 8 chars, coerente pattern audit log B1 `lockoutKeyHash`), `attackerIp`, `userAgent`, count revoked
- **MAI** in email: password, JWT, refresh token, session id, lockout key plain, email plaintext
- HTML inline + `escapeHtml()` helper privato per i campi dinamici (no engine — TD-AA se >3 template)
- Auth conditional in `createTransport`: `auth: smtpUser && smtpPass ? {user, pass} : undefined` (Mailpit no-auth OK, provider strict tipo Postmark non rifiuta SASL vuoto)

### D4 — Audit immutability: single-row con `emailSent` + `emailReason` enum

- Schema `AuditLog` semanticamente append-only (no `updated_at` field)
- Pattern: `mail.sendXyzEmail()` ritorna `Promise<boolean>`, chiamato PRIMA di `recordAudit`, booleano confluisce nel payload `afterValue`
- `emailReason` enum: `null` (sent) | `'no_user'` | `'no_email'` | `'send_failed'` | `'no_user_pin_lockout'`
- Alternativa scartata: 2 audit rows (`*.email_sent`) — rumore in audit log, semantica meno chiara

### D5 — Audit action `auth.theft_detected` riuso (Discovery #23)

- `auth.theft_detected` esiste già da D2-vitest, copre semanticamente refresh-token reuse
- **NO nuova action `auth.refresh_token_theft`** (sarebbe duplicate)
- **NO migration** (`audit_logs.action` è String text-based, già confermato B1 STOP 5)
- **Lesson**: prima di aggiungere enum value, grep semantic equivalents esistenti

### D6 — Rate-limit `/auth/login-pin` per-tenant `(tenantId, ip)` triplet

- 4° named throttler `auth-pin` (default 10 req / 60 sec, env-overridable)
- Env vars: `THROTTLE_AUTH_PIN_LIMIT=10` + `THROTTLE_AUTH_PIN_TTL=60000`
- Decorator `@LoginPinThrottle()`: solo `SetMetadata(LOGIN_PIN_METADATA, true)` — pattern coerente B1 (`@AuthStrict()` + `@TenantCreate()`)
- `customGetTracker` branch in `AppThrottlerGuard.handleRequest`:
  - `req.tenantId` populated da TenantMiddleware (verifica empirica STEP 4.1)
  - tracker `pin:${tenantId}:${ip}` (source `tenant-ip`)
  - fallback `pin:unknown:${ip}` (source `ip-fallback`) defense-in-depth (in pratica irraggiungibile: TenantMiddleware fail-fast pre-guard)
- **deviceId NON incluso** → TD-Y per F1 PWA cameriere
- **`@AuthStrict()` rimosso da `loginPin`** (Discovery #25 subsumption)

| Endpoint                   | Throttler            | Limit / TTL  | Tracker                      | Decorator                 |
| -------------------------- | -------------------- | ------------ | ---------------------------- | ------------------------- |
| POST `/auth/login`         | `auth-strict` (B1)   | 5 / 60s      | userId-or-IP (JWT decode B1) | `@AuthStrict()`           |
| POST `/tenants`            | `tenant-create` (B1) | 3 / 1h       | userId-or-IP (JWT decode B1) | `@TenantCreate()`         |
| **POST `/auth/login-pin`** | **`auth-pin` (B2a)** | **10 / 60s** | **`(tenantId, ip)` triplet** | **`@LoginPinThrottle()`** |

### D7 — TD-B Redis down behavior (Discovery #26, verifica empirica STOP 5)

| Componente                                             | Redis DOWN                                                                                                                 | Recovery                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `LockoutService` (B1)                                  | **fail-open** ✅ (`try/catch` interno → `null` su `checkLockout`, `{promotedToLockout:false}` su `recordFailedAttempt`)    | auto, latency ~normale                                    |
| `ThrottlerStorage` (@nest-lab/throttler-storage-redis) | **fail-CLOSED** → 500 `MaxRetriesPerRequestError` dopo `maxRetriesPerRequest:3` exponential backoff (~1018ms primo errore) | auto a ~121ms post-restart Redis (ioredis auto-reconnect) |
| Audit log (Prisma)                                     | indipendente, funziona                                                                                                     | n/a                                                       |
| User legitimate login                                  | **bloccato durante DOWN** (ThrottlerGuard 500 prima del controller)                                                        | recovery auto                                             |

**Decisione**: TD-B parzialmente risolto. LockoutService MIO è fail-open verificato (B1 unit test STOP 4 simulava esattamente questo via mock). Il fail-CLOSED del **ThrottlerStorage** è responsabilità del package esterno e blocca tutto. Nuovo **TD-AD** follow-up: wrap `AppThrottlerGuard.handleRequest` con try/catch che, su Redis error, lascia passare la request + log warn (fail-open total).

## Discoveries (+5 in B2a → totale 26 cumulative)

### #22 — MailHog abbandonato, Mailpit drop-in replacement

MailHog ultimo release 2020, ecosistema dev (Laravel Sail, DDEV, Drupal VM) migrato a Mailpit. Migrazione drop-in protocol-level: SMTP standard, stessi port 1025/8025, zero impatto su `nodemailer` config o codice applicativo. Mailpit `v1.30` pinned (NON `:latest`) per reproducibility — anti-pattern silent breaking change tra deploy. Breaking minore irrilevante al nostro use case: API REST endpoint passa da `/api/v2/messages` (MailHog) a `/api/v1/messages` (Mailpit) — usiamo SMTP only.

**Lesson**: pre-coding verifica empirica maintenance status di dev tools considerati "standard de facto" — anche tooling consolidato può essere abbandonato.

### #23 — Semantic equivalent audit action già esistente

Pre-aggiunta di una nuova `auth.refresh_token_theft` (proposta originale del prompt B2a), grep su `apps/api/src/auth/auth.service.ts` ha rivelato `auth.theft_detected` già definita nella union TS (D2-vitest, riferito al refresh-token reuse case). NO nuova action, NO migration: aggiungerla sarebbe duplicate noise nell'audit log.

**Lesson**: prima di aggiungere enum value, sempre `grep` per semantic equivalents esistenti (anti-pattern proliferation).

### #24 — Interleaving lockout + throttler con limit identici

Lockout `LOCKOUT_THRESHOLD=10` e `auth-pin` throttler `limit=10` coincidono sul `/auth/login-pin` flow. Risultato empirico:

- Attempt 1-9: 401 (`E_AUTH_INVALID_CREDENTIALS`)
- Attempt 10: **429** con body `E_AUTH_ACCOUNT_LOCKED` ← **lockout** vince (audit `auth.account_locked` firato)
- Attempt 11: **429** con body `ThrottlerException` ← **throttler** finalmente blocca

Apparente off-by-one risolto: i due strati di defense-in-depth si sovrappongono coerentemente. Body distingue chiaramente quale strato ha bloccato.

**Lesson**: defense-in-depth con limiti identici è legittimo ma può confondere debug. TD-AC: valutare default discrasati (es. throttler 10/min, lockout 20/15min) OR documentare pattern interleaving come intenzionale.

### #25 — Decorator throttler subsumption

Doppio decorator `@AuthStrict() + @LoginPinThrottle()` su `loginPin` → throttler più stretto vince. `auth-strict` (5/min IP-only) bloccava al 6° prima che `auth-pin` (10/min per-tenant) potesse manifestare il suo comportamento → tracker per-tenant invisibile, smoke 3 isolation impossibile. Fix: rimosso `@AuthStrict()` da `loginPin` (subsumed da `@LoginPinThrottle()` più granulare e più permissivo). `/auth/login` (email/password) mantiene `@AuthStrict()` — quel flow non ha tenant-scope per-tracker (TD-H carry-over B1).

**Lesson**: prima di stackare decorator throttler, valutare se uno subsume l'altro. Decoratori più granulari (per-tenant) > più generici (IP-only) quando entrambi proteggono lo stesso endpoint.

### #26 — TD-B Redis down: ThrottlerStorage fail-CLOSED, LockoutService fail-open

Verifica empirica STOP 5: 4 attempt con Redis stoppato → tutti 500 `MaxRetriesPerRequestError` (incluso login VALID admin@demo.local!). LockoutService MIO è fail-open correttamente (try/catch interno verificato unit test B1 STOP 4), MA ThrottlerGuard fail-CLOSED via `@nest-lab/throttler-storage-redis` non gestisce Redis unavailable. Recovery auto in ~121ms post-restart Redis (ioredis built-in reconnect). User legittimo NON può loggarsi durante Redis DOWN.

**Lesson**: fail-open testato a livello componente NON garantisce fail-open end-to-end. ThrottlerGuard (esterno) bypassa LockoutService (mio). Total fail-open richiede wrapping a livello guard. TD-AD nuovo.

## Considered Alternatives

| #   | Decisione                                         | Alternativa                           | Esito                  | Razionale                                                                                                  |
| --- | ------------------------------------------------- | ------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| D1  | nodemailer@8                                      | `node-mailgun` / `node-postmark-sdk`  | Rejected               | nodemailer è SMTP-agnostic (dev Mailpit + prod provider via stesso codice)                                 |
| D1  | Mailpit v1.30                                     | MailHog `:latest`                     | Rejected (#22)         | MailHog abbandonato 2020; ecosistema dev moved to Mailpit                                                  |
| D1  | Mailpit `:latest`                                 | Mailpit `v1.30` pinned                | Rejected               | reproducibility (silent breaking change tra deploy)                                                        |
| D2  | `verify()` throw                                  | `verify()` fail-open warn             | Rejected               | dev sviluppatore senza Mailpit deve poter bootare API                                                      |
| D2  | `sendMail` throw                                  | `sendSafe` wrapper fail-open          | Rejected               | email persa < auth bloccato                                                                                |
| D3  | template engine (Handlebars)                      | inline HTML + escapeHtml              | Rejected (per ora)     | 2 template totali, no valore aggiunto. TD-AA se >3                                                         |
| D3  | email plaintext (no HTML)                         | HTML                                  | Rejected               | mailbox moderne renderizzano HTML by default; plaintext fallback non implementato (TD futuro low priority) |
| D4  | 2 audit rows (`*.email_sent`)                     | single row con `emailSent` flag       | Rejected               | rumore audit, semantica meno chiara, audit immutability rispettata via single emission                     |
| D5  | nuova `auth.refresh_token_theft` action           | riuso `auth.theft_detected` esistente | Rejected (#23)         | duplicate semantic, no migration necessaria                                                                |
| D6  | `auth-strict` + `auth-pin` entrambi su `loginPin` | solo `auth-pin`                       | Rejected (#25)         | auth-strict subsume auth-pin → per-tenant invisibile                                                       |
| D6  | deviceId nel tracker triplet                      | `(tenantId, ip)` solo                 | Rejected (per ora)     | TD-Y trigger F1 PWA cameriere                                                                              |
| D6  | `Throttle({...})` inline nel decorator            | env-driven `forRootAsync`             | Rejected               | pattern coerente B1 (single source of truth env vars)                                                      |
| D7  | TD-B fail-closed accettato                        | TD-AD wrap ThrottlerGuard fail-open   | **Rejected (per ora)** | sviluppato come TD follow-up: production deploy trigger                                                    |

## Tech Debt (7 nuove, B2a → totale repo ~28 dopo B1 21 + B2a 7)

| ID        | Categoria | Descrizione                                                                                                                                                                                                                                                                        | Trigger fix                                                          | Stima  |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| **TD-V**  | Mail      | `LOCKOUT_DURATION_MIN = 15` hardcoded in `AuthService` per UI message email. Disallineabile se `LOCKOUT_DURATION_MS` env cambia                                                                                                                                                    | Recalc runtime da `ConfigService.get('LOCKOUT_DURATION_MS') / 60000` | ~10min |
| **TD-Y**  | Throttler | `deviceId` NON nel tracker `auth-pin` triplet → un device legittimo con molti retry può consumare bucket per tutti gli altri device dello stesso tenant                                                                                                                            | F1 PWA cameriere offline-first                                       | ~30min |
| **TD-Z**  | Mail      | SMTP production provider integration (Postmark/SES/Resend). Mailpit solo dev                                                                                                                                                                                                       | Production deploy                                                    | ~1h    |
| **TD-AA** | Mail      | Template engine (Handlebars/EJS) se >3 template inline                                                                                                                                                                                                                             | 3° template aggiunto                                                 | ~1.5h  |
| **TD-AB** | Throttler | Documentare matrix decorator throttler subsumption (`@AuthStrict` vs `@LoginPinThrottle` vs `@TenantCreate`)                                                                                                                                                                       | Prossimo decorator throttler aggiunto                                | ~20min |
| **TD-AC** | Lockout   | Default lockout threshold e throttler limit identici (10) → interleaving confusion debug. Considerare default discrasati o documentare pattern                                                                                                                                     | Discussion only, monitoring osservazioni dev                         | ~10min |
| **TD-AD** | Throttler | **ThrottlerStorage Redis DOWN fail-CLOSED 500** (#26). LockoutService MIO è fail-open, ma `AppThrottlerGuard.handleRequest` propaga `MaxRetriesPerRequestError` esterno. Soluzione: try/catch in handleRequest, su Redis error log warn + lascia passare request (total fail-open) | Production deploy OR osservazione downtime Redis                     | ~30min |

## Reversibility

| Scenario                                          | Cost                                                                                                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rollback completo B2a (revert PR pre-merge)       | ~5min: `git revert <SHA-B2a>`. Deps removable (`pnpm remove nodemailer @types/nodemailer`). Mailpit container removable (`docker compose stop mailpit; docker image rm axllent/mailpit:v1.30`). |
| Disabilitare email senza rollback rate-limit      | ~10min: rimuovi `MailModule` da `app.module.ts`, sostituisci `this.mail.sendXyzEmail(...)` con stub `Promise.resolve(false)`. `auth-pin` resta operativo.                                       |
| Disabilitare rate-limit `/auth/login-pin`         | ~5min: rimuovi `@LoginPinThrottle()` da `loginPin` handler. ThrottlerModule config `auth-pin` resta (skipIf opt-in lo disattiva).                                                               |
| Switch Mailpit → MailHog (rollback Discovery #22) | ~15min: rivertire docker-compose mailpit → mailhog. **Sconsigliato** (MailHog abbandonato).                                                                                                     |
| Switch dev → prod SMTP provider                   | ~30min con TD-Z: configurare `SMTP_HOST/PORT/USER/PASS/SECURE` env vars per provider. Codice MailService invariato (nodemailer-agnostic).                                                       |

## Security considerations

### Cosa è ENFORCED (B2a)

- **Email notification security signal**: account locked + theft detect → utente legittimo informato (ne può reagire cambiando password, contattando admin)
- **Per-tenant rate-limit `/auth/login-pin`**: 10/min per `(tenantId, ip)` → attacker con IP rotation NON bypassa (deve ottenere accesso a un tenant diverso, che è fuori scope brute force PIN)
- **Anti-PII email content**: `identifierHash` sha256[0:8] (pattern audit log), MAI password/token/JWT in email
- **Audit immutability**: `emailSent: boolean` + `emailReason: enum` nel payload single-row
- **`Retry-After` header** su `auth-pin` 429: 60s (TTL throttler, NOT lockout 900s — diversi strati)
- **TenantMiddleware fail-fast** pre-guard: tenant slug invalido → 401 prima del throttler (verificato smoke 5)
- **Defense-in-depth**: lockout + throttler operativi simultaneamente (#24)

### Cosa NON è enforced (TD-Y/Z/AD)

- **deviceId nel tracker** (TD-Y): un singolo device legittimo con molti retry può consumare bucket per altri device stesso tenant. Mitigato in pratica da `(tenantId, ip)` separazione fra tenants.
- **SMTP provider production** (TD-Z): Mailpit solo dev. Production deploy richiede config provider esterno.
- **ThrottlerStorage Redis DOWN fail-open total** (TD-AD): durante Redis downtime, user legittimo NON può loggarsi (500). LockoutService fail-open ma ThrottlerGuard fail-CLOSED. Trigger fix: production deploy OR observed downtime.
- **Email content plaintext fallback**: rendering HTML-only. Mailbox legacy potrebbero non visualizzare. Low priority (modern UX assumption).
- **Rate-limit `/auth/refresh`**: nessun throttler dedicato. Mitigato da theft detection D2-vitest (revoke all on reuse). Carry-over per macro-task hardening successivo.

## Smoke summary (STOP 3+4+5)

| Smoke   | Scenario                                                                                                                                    | Verdetto |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 3-A     | `/auth/login` lockout (THRESHOLD=3 temp): 2x 401 + 3° 429 + 4° 429 + Mailpit email account_locked                                           | ✅       |
| 3-B     | `/auth/refresh` theft (refresh token reuse): 401 `E_AUTH_THEFT_DETECTED` + Mailpit email + 25 session revoked + audit `auth.theft_detected` | ✅       |
| 3-Audit | Audit row con `emailSent: true, emailReason: null, lockoutKeyHash sha256[0:8]`                                                              | ✅       |
| 4-1+2   | `/auth/login-pin` rate-limit auth-pin (10/60s): 9x 401 + 10° lockout + 11° throttler (#24 interleaving)                                     | ✅       |
| 4-3     | Per-tenant isolation: demo saturated, acme stessa IP → 401 NOT 429                                                                          | ✅       |
| 4-5     | TenantMiddleware fail-fast: slug invalido → 401 `E_AUTH_TENANT_REQUIRED` PRE-throttler                                                      | ✅       |
| 5-TD-B  | Redis DOWN: 500 `MaxRetriesPerRequestError` su login (incluso valido) + recovery auto 121ms post-restart                                    | ✅ (#26) |

## Related ADRs

- [ADR-0008](./ADR-0008-auth-module.md) — auth module D2a/D2b (D2-vitest `auth.theft_detected` riuso)
- [ADR-0013](./ADR-0013-auth-e2e-hardening-b1.md) — B1 rate limit + lockout (predecessor)
- ADR-0015 (planned) — B2b E2E full Nest bootstrap + Testcontainers + TD-B integration test (sessione 10)

## Next: B2b (sessione 10 programmata)

- **E2E test full Nest bootstrap**: `Test.createTestingModule(AppModule)` + Testcontainers Postgres + Redis reale + `supertest` HTTP
- **TD-AD integration test**: spegnere Redis container durante test, verificare 500 attuale → implementare wrap fail-open in `AppThrottlerGuard.handleRequest` → ri-test
- **TD-B follow-up totale**: documentare strategia fail-open layered (Redis + Postgres + SMTP) in production runbook
- **TD-Y opzionale**: deviceId nel tracker auth-pin triplet (se F1 PWA cameriere parte sessione 10)

## Notes

- **Versioni installate** (2026-05-14):
  - `nodemailer@8.0.7` + `@types/nodemailer@8.0.0`
  - `axllent/mailpit:v1.30` (digest `sha256:0059ef81e492a7192af3816281eed6859eb078bd7bdc58b76757c13e10e53a7d`)
  - `@nestjs/throttler@6.5.0` (invariato da B1)
- **LOC empirici** (da `wc -l`, NON stima):
  - `apps/api/src/mail/mail.service.ts`: **198**
  - `apps/api/src/mail/mail.module.ts`: **19**
  - `apps/api/src/throttler/decorators/login-pin.decorator.ts`: **25**
  - Total file nuovi: **242 LOC**
  - Delta `git diff main --stat`: **+204 / -5** su 10 file modificati
  - **Total B2a: ~441 LOC** (242 nuovi + 199 net insertions delta)
- **KB empirici** (da `wc -c`, file nuovi solo): `mail.service.ts` 8755, `mail.module.ts` 776, `login-pin.decorator.ts` 1374 → **totale ~10.9KB**
- **ADR-0014 size**: post-Prettier, da verificare `wc -c` POST commit (lesson #7 ADR-0013).
- **Audit action enum totale**: 11 (invariato — riuso `auth.theft_detected` esistente, Discovery #23). Schema `audit_logs.action` resta `String` text-based (Caso B B1 STOP 5 confermato).
- **Endpoint rate-limited**: 4 (era 3 in B1): `auth-strict` su `/auth/login` (+ era login-pin, rimosso #25), `tenant-create` su POST `/tenants`, `auth-pin` su `/auth/login-pin`, `default` 60/min globale.
