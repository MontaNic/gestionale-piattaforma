# ADR-0027 — Composizione del core condiviso: confine, package e ordine di estrazione

- **Status:** Proposed (da promuovere ad Accepted dopo conferma owner)
- **Data:** 2026-06-02
- **Decisori:** Nicolò (owner/arbitro), Claude strategico, Claude Code (analisi pre-estrazione)
- **Correlati:** ADR-0025 (piattaforma a verticali con core condiviso); **ADR-0026 (strategia data layer database-per-tenant)**; BRIEF §F1 (no astrazione prematura, verticali come app separate che riusano i singleton condivisi)
- **Base:** analisi pre-estrazione di Claude Code (mappatura dello stato reale del repo).

> Questo ADR copre **come è composto il core e in che ordine si estrae**. La strategia del data layer (database-per-tenant, routing, migration multi-DB) è in **ADR-0026** e non si ripete qui.

---

## Contesto

ADR-0025 ha ridefinito lo scope in piattaforma a verticali con core tecnico condiviso. Serve formalizzare **cosa** compone il core, **come** separarlo dal dominio ristorazione e in **quale ordine** estrarlo, prima di toccare codice.

Fatti strutturali emersi dall'analisi del repo:

1. **Non esiste `apps/restaurant`.** Oggi `apps/api` e `apps/web` _sono_ il verticale ristorazione: contengono sia il core tecnico sia i moduli di dominio (menu/cassa/comande/kds…). "Estrarre il core" = portare nei `packages/` la parte agnostica e lasciare il resto come scaffold ristorazione.
2. **Esiste un solo package: `packages/db`.** Gli altri non esistono ancora: l'estrazione è in gran parte _creazione di package nuovi + spostamento_.
3. **Anomalia da pulire:** directory nidificata duplicata e vuota `apps/api/apps/api/src/tenants/` — da rimuovere (cosmetica, fuori rischio).

## Decisione

### D1 — Confine core tecnico vs core di dominio

Principio-guida unico: si estrae **ciò che funziona senza conoscere cosa sia un "articolo di menu"**. Si lascia nel verticale tutto ciò che nomina entità di business ristorazione.

- **Core tecnico (estrarre ora):** RLS engine, soft-delete, helper DB; tabelle multi-tenant (Tenant/Sede/User/Permission/Role/RolePermission/UserRole/Session/AuditLog); moduli backend auth/rbac/users/tenancy; infra cross-cutting (redis/mail/throttler/health/common/error-codes); design system UI (shadcn + `cn`); auth frontend (AuthContext/AuthGate/middleware/lib auth); meccanismo i18n (non i messaggi); eslint-config; infra/CI.
- **Core di dominio (NON estrarre ora):** qualsiasi generalizzazione di Menu/Articolo/Listino/Ricetta/Anagrafica/Fatturazione. Resta scaffold nel verticale ristorazione. Si astrarrà **solo** quando il verticale commercialisti mostrerà cosa è davvero comune tra due casi reali (BRIEF §F1).

### D2 — Granularità package backend: accorpata (2 package)

- **`packages/auth`** = auth + rbac + users + tenancy. Sono il blocco multi-tenant sicuro: vivono e si rompono insieme (i 4 APP_GUARD lavorano in ordine; rbac dipende da auth; tenancy da entrambi). Tenerli insieme riduce l'attrito.
- **`packages/platform`** = infra cross-cutting (redis, mail, throttler, health, common).
- Si potrà splittare in seguito se il secondo verticale lo richiederà. **Accorpare ciò che si è già spezzato è più doloroso del contrario** → si parte accorpati.
- Package non-backend previsti: `packages/ui`, `packages/shared`, `packages/i18n`, `packages/auth-web`, `packages/eslint-config`.

### D3 — Naming del verticale: rimandato

`apps/web`/`apps/api` **non** si rinominano ora. A core estratto si deciderà come chiamare il residuo ristorazione (decisione separata). Rinominare ora aggiunge solo rumore alle PR di estrazione.

### D4 — Gate di test e prerequisito RLS (rimanda ad ADR-0026 §D5)

- Ogni passo di estrazione ha come gate la **baseline di test verde costante**.
- **Prerequisito dello step `packages/db`:** scrivere il **test RLS core-only** (isolamento su tenants/sedi/users/audit) che gira come **`gestionale_app` non-superuser** — vedi ADR-0026 §D5, dove è emerso che i test e2e attuali girano da superuser e quindi NON esercitano la RLS a livello DB. Senza questa correzione il test "core-only" non testerebbe nulla.

### D5 — Ordine di estrazione (dal più sicuro al più rischioso)

Ogni passo = feature branch + PR squash + baseline test verde come gate + un ADR dove la scelta non è ovvia.

0. (prep) Questo ADR + ADR-0026; pulizia directory stray `apps/api/apps/api/src/tenants/`; registrazione baseline test verde di riferimento.
1. `packages/eslint-config` — tooling puro, zero runtime.
2. `packages/ui` — shadcn + `cn`, agnostico. Aggiungere smoke test render (chiude un gap di copertura).
3. `packages/shared` — error-codes (unificare i duplicati FE/BE, con test di parità), tipi/utility comuni.
4. `packages/i18n` — solo meccanismo; messaggi per-app con namespacing. Aggiungere test switch/fallback.
5. `packages/auth-web` (FE) — AuthContext/AuthGate/middleware/lib auth. Coperto da Playwright.
6. `packages/platform` (BE infra) — redis/mail/throttler/health/common.
   > Nota esecuzione: scope ristretto a {redis,mail,throttler,common}; health differito — cfr. Addendum 2026-06-04.
7. `packages/auth` (BE) — auth+rbac+users+tenancy + i 4 APP_GUARD. **Massimo rischio applicativo:** ordine guard ri-verificato a ogni passo; e2e auth/rbac/tenant-consistency verdi costanti.
   > Nota esecuzione: eseguito in 7a (disaccoppia DbService) + 7b (estrazione). 39 file, health differito DP-A — cfr. Addendum 2026-06-04 (passo 7).
8. `packages/db` — separazione enum/seed core vs dominio + introduzione indirezione `getClientForTenant` (fase 1, ADR-0026 §D3). **Massimo rischio dati:** preceduto dal test RLS core-only come non-superuser (D4).
   > Nota esecuzione: prerequisito RLS chiuso in 8a (`smoke:rls-core` in CI, percorso X). Finding e2e-api-non-in-CI → TD-CB. Cfr. Addendum 2026-06-04 (passo 8a).
9. Riframe del residuo ristorazione a scaffold (naming per D3).

## Conseguenze

**Positive**

- Confine chiaro e principio-guida unico.
- Rischio dati e applicativo concentrati negli ultimi due passi, affrontati quando il resto è già stabile.
- Meno package backend = meno confini prematuri; più facile ora.
- Il gap RLS (ADR-0026 §D5) viene chiuso prima dello step db, non scoperto dopo.

**Costi / rischi**

- Creazione di più package nuovi: aggiornamento path-alias `@gestionale/*` e project references a ogni passo (coperto da CI typecheck).
- L'ordine deterministico dei 4 APP_GUARD è il punto fragile dell'estrazione di `packages/auth`: va ri-verificato a ogni passo.
- L'accoppiamento `tenancy ↔ db` (interfaccia mappa tenant→DB, ADR-0026 §D4) va definito prima di estrarre quei package.

## Follow-up

- [ ] Pulizia directory stray `apps/api/apps/api/src/tenants/`.
- [ ] Definire l'interfaccia `tenancy ↔ db` (ADR-0026 §D4) prima degli step 7-8.
- [ ] Scrivere il test RLS core-only come non-superuser (prerequisito step 8).
- [ ] Procedere all'estrazione seguendo D5, un package per PR, test verdi come gate.

---

## Addendum 2026-06-04 — Passo 6 (packages/platform): note di esecuzione

### health differito (deviazione da §D5 passo 6)

§D5 elencava `redis/mail/throttler/health/common` nel passo 6. In fase di estrazione
`health` è risultato dipendere da due simboli NON ancora estratti:

- `@Public` (decorator di `auth`, passo 7)
- `DbService` (wrapper NestJS in `apps/api/src/db/`, passo 8)
  Estrarlo ora introdurrebbe un riferimento all'indietro `packages/platform → apps/api/src/{auth,db}`
  (inversione di layer). `health` è inoltre endpoint terminale (0 consumatori) che _compone_
  auth+db+redis: più concern applicativo che infra di base. Decisione: `health` resta scaffold in
  `apps/api`; rientro valutato al passo 7 (quando `@Public` sarà in `packages/auth`) o lasciato
  app-level. **Scope passo 6 effettivo = `{redis, mail, throttler, common}`.**

### Convenzione build package NestJS dual (verificata empiricamente — probe STOP 0.5)

Primo package estratto con codice NestJS + DI (i precedenti erano front-end o funzionali).
La DI NestJS risolve i costruttori via metadata `design:paramtypes`, che esbuild (motore di tsup)
NON emette di default. La probe ha verificato che il dual-package tsup regge la DI **a condizione che**:

1. il `tsconfig.json` del package dichiari ESPLICITAMENTE `experimentalDecorators: true` +
   `emitDecoratorMetadata: true` — il `tsconfig.base.json` NON li eredita (usa `module: ESNext`
   per i package non-NestJS; solo `apps/api/tsconfig.json` li attiva);
2. `tsup.config.ts` elenchi i runtime NestJS in `external` (`@nestjs/*`, `ioredis`, `nodemailer`,
   `reflect-metadata`, ...) per non bundlarli e preservare l'identità dei provider.
   Con i due flag attivi tsup/esbuild emette `design:paramtypes` con i tipi reali (verificato nel
   dist: `[ConfigService]`, non `Object`). **Convenzione da riusare per i prossimi package NestJS
   (passo 7 `auth`).**

---

## Addendum 2026-06-04 — Passo 7 (packages/auth): note di esecuzione

### Scomposizione 7a + 7b

Il passo 7 è stato eseguito in due PR per separare il rischioso dal meccanico:

- **7a** (#58, refactor): i moduli auth iniettavano il wrapper locale `DbService`
  (`apps/api/src/db/`, estratto solo al passo 8) → back-ref bloccante per l'estrazione.
  Disaccoppiati 7 file usando direttamente il singleton `prisma` di `@gestionale/db`
  (loro fonte già esistente per le funzioni RLS). `DbService` invariato, ancora iniettabile
  per i consumatori fuori scope (`health` + 5 service di dominio): dipendenza
  `apps/api → apps/api` valida fino al passo 8. Anti-astrazione (§F1): uso del singleton
  concreto già condiviso, nessuna porta/interfaccia per un wrapper di ~12 righe.
- **7b** (estrazione): `git mv` di 39 file (auth+rbac+users+tenants+tenant+context) in
  `@gestionale/auth`, dual-package tsup. Barrel a 17 simboli (superficie consumata).

### Wiring multi-tenant sicuro (resta nello scaffold)

La registrazione `APP_INTERCEPTOR` (`TenantContextInterceptor`) + i 4 `APP_GUARD` in ordine
deterministico (`AppThrottlerGuard`[platform] → `JwtAuthGuard` → `TenantConsistencyGuard` →
`PermissionsGuard`) e `configure()/consumer.apply(TenantMiddleware).forRoutes(...)` restano in
`app.module.ts`. L'estrazione ha cambiato SOLO i path d'import dei simboli; ordine e logica
byte-identici (cfr. ADR-0017 / Discovery #36 sull'ordine guard). Validato e2e: la catena guard
opera nell'ordine reale (auth → tenant-consistency → permissions; throttler fail-open).

### health differito (DP-health = A)

`health` dipende da `@Public` (risolto: ora `@gestionale/auth`) e ancora da `DbService` locale
(passo 8). Rientro pieno impossibile senza ri-introdurre il back-ref appena rimosso. Decisione:
`health` resta scaffold in `apps/api`, importa `@Public` da `@gestionale/auth`; rientro pieno
valutato al passo 8/9. Coerente con la linea "non re-introdurre back-ref per anticipare rientri".

### Build

Profilo NestJS-dual del passo 6 riusato senza probe (convenzione DI già validata): tsconfig con
`experimentalDecorators`+`emitDecoratorMetadata`, tsup `external` esteso (`@nestjs/jwt`,
`@nestjs/passport`, `passport-jwt`, `argon2`, `class-validator`, `rxjs`, `@gestionale/platform`).
CI: step build workspace esteso a `--filter @gestionale/auth` (topo-order ok, nessuno split).

---

## Addendum 2026-06-04 — Passo 8a (prerequisito RLS): note di esecuzione

### Prerequisito ADR-0026 §D5 chiuso

Il passo 8 è preceduto dal test RLS core-only come `gestionale_app` non-superuser (§D4/§D5).
Finding del preflight: gli e2e api Vitest+testcontainers (56) **non girano in CI** (solo unit +
Playwright web); la RLS DB-level non era esercitata in CI (i test attuali girano da superuser, che
bypassa la RLS anche con `FORCE`). Scelta (percorso X, footprint minimo): un check DB-level dedicato
in CI riusando l'infra già presente nel job `e2e-playwright` (ruolo `gestionale_app` ruotato,
`DATABASE_URL` app-role, seed demo/acme) — invece di portare l'intera suite e2e api in CI (scope ben
più ampio, rischio Docker-in-CI dentro il passo a massimo rischio dati).

Artefatto: `packages/db/scripts/smoke-rls-core.ts` (script `smoke:rls-core`), 9 scenari core-only su
`tenants/sedi/users/audit_logs` (+ `roles/user_roles`), come `gestionale_app`:

- S0 preludio auto-diagnostico: asserisce `current_user = gestionale_app`, `rolsuper = false`,
  `rolbypassrls = false` (un fallimento spiega da sé che l'env punta al ruolo sbagliato);
- read-isolation cross-tenant, write-block (WITH CHECK, non-distruttivo), bypass system/super-admin,
  fail-fast (`RlsNoContextError` fuori contesto).
  Step CI in `e2e-playwright` dopo `db:seed`; exit ≠0 → step rompe. Verificato: 9/9 PASS, non-distruttivo
  (secondo run identico, insert cross-tenant respinti non persistono), 56 e2e + harness invariati.

### TD-CB — e2e api Vitest+testcontainers non in CI

**Stato:** aperto. Gli e2e api (56) e `smoke:rls-e2e` girano solo in locale; in CI girano unit +
Playwright web + (ora) `smoke:rls-core`. **Conseguenza:** i 3 test "isolation" applicativi
(`menu-tenant-isolation`, `soft-delete-rls`, `tenant-consistency`) in CI girerebbero da superuser →
validano isolamento applicativo, non enforcement DB-level. **Migration path:** portare la suite e2e api
in CI come `gestionale_app` (Docker-in-CI per testcontainers, o riuso del service container del job
`e2e-playwright`), rendendo veri anche quei 3 test. Mitigazione attuale: `smoke:rls-core` copre
l'enforcement DB-level core-only in CI. Da pianificare come passo dedicato (non in 8a/8b).

---

## Addendum 2026-06-05 — Passo 9 (riframe verticale a scaffold): chiusura §D5

Ultimo passo dell'ordine §D5. Passo **atomico, documentale** (zero file di codice toccati): chiude
l'estrazione del core e formalizza lo stato del residuo ristorazione.

### Estrazione core completa

I passi §D5 1→8b sono chiusi. Il core tecnico agnostico vive ora in **9 package**: `eslint-config`,
`ui`, `shared`, `i18n`, `auth-web`, `platform`, `auth`, `db` (+ `api-client` FE). `apps/api` e
`apps/web` **non si splittano oltre**: sono il **verticale ristorazione allo stato di scaffold
congelato** (ADR-0025: il dominio ristorazione non viene sviluppato, serve da riferimento boilerplate).
Confine core/dominio dentro i verticali documentato in `apps/README.md`.

### Decisione naming (§D3, deferita → presa ora) = A — mantieni i nomi

`apps/api`/`apps/web` **NON** si rinominano. §D3 aveva deferito il naming "a core estratto"; con un
**solo** verticale il rename è churn anticipato senza beneficio. Il trigger naturale è l'arrivo del
**2° verticale** (commercialisti / StudioDesk, ADR-0025): a quel punto `apps/api` diventa ambiguo vs
un `apps/accountant-*`. Coerente con la disciplina YAGNI del progetto (cfr. RoutingKey/catalogo
deferiti a fase 2 in ADR-0026 §D4). → registrato come **TD-CC** (sotto).

### Chiusura differiti "al passo 8/9" — tutti RESTANO app-level/scaffold (chiusura decisionale, zero codice)

Nessun rientro a `packages/*`:

- **health** — resta in `apps/api`. Estrarlo in `platform` re-introdurrebbe il ciclo
  `platform → apps/api/db` (inversione di layer); è concern applicativo (compone auth+db+redis,
  endpoint terminale 0-consumer), non infra di base. `@Public` è già da `@gestionale/auth`; l'unico
  residuo locale è `DbService`.
- **DbService** — resta in `apps/api`. Wrapper di ~12 righe, 6 consumer (5 service di dominio +
  health) **tutti scaffold/app-level** → è infrastruttura di scaffold, non core da estrarre. La
  dipendenza `apps/api → apps/api` è **valida e definitiva** nello scaffold (§F1: nessuna porta per
  un wrapper di 12 righe). Il destino di DbService è legato a quello di health: entrambi restano.
- **me** — core-residuo app-level identico a health (thin controller `/me` su `@gestionale/auth`);
  stesso destino, resta.

### Cosa NON è cambiato

Il wiring `APP_INTERCEPTOR` (`TenantContextInterceptor`) + i 4 `APP_GUARD` in ordine deterministico
(`AppThrottlerGuard` → `JwtAuthGuard` → `TenantConsistencyGuard` → `PermissionsGuard`) +
`configure()/forRoutes(TenantMiddleware)` in `app.module.ts` resta **byte-identico** (Discovery #36).
Il passo 9 non tocca alcun file `.ts`/`.tsx`/`.prisma`/`.json` di codice.

### TD-CC (nuovo) — rename `apps/api`/`apps/web` → `apps/restaurant-*` al 2° verticale

**Stato: RISOLTO 2026-06-06** (PR #68, `6e32528`) — rename `apps/api,web → restaurant-api,restaurant-web` + package name `@gestionale/restaurant-*` eseguito all'avvio del verticale commercialisti. Diff meccanico simmetrico (96/96), storia preservata via `git mv`, gate verde = baseline.

**Stato originario:** aperto. Il naming del verticale è mantenuto oggi (decisione A); il rename va fatto quando
arriva il **secondo verticale reale** (commercialisti), per disambiguare `apps/api` da
`apps/accountant-*`. Lavoro **strutturale-ma-meccanico**: directory + `package.json` `name` +
path-alias `@gestionale/*` + build-order CI + import. **Confine:** finché non fatto, `apps/api` e
`apps/web` denotano implicitamente il verticale ristorazione. Severità **BASSA**, trigger = avvio 2°
verticale, stima ~1-2h.
