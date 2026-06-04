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
8. `packages/db` — separazione enum/seed core vs dominio + introduzione indirezione `getClientForTenant` (fase 1, ADR-0026 §D3). **Massimo rischio dati:** preceduto dal test RLS core-only come non-superuser (D4).
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
