# ADR-0007 — NestJS API scaffold + healthcheck (D1)

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** `PROJECT_BRIEF.md` §A3 (stack: NestJS + Prisma), §A4 (`apps/api`), §B1 (auth — successivo), §C2 (API design), [ADR-0005](./ADR-0005-prisma-data-layer.md), [ADR-0006](./ADR-0006-typecheck-monorepo.md)

## Context

F1 richiede un backend NestJS in `apps/api` come consumer di `@gestionale/db`. D1 è lo scaffold base: server up + endpoint `GET /health` che conferma la connessione a Postgres. Niente auth, niente business logic — quelle arrivano in D2/D3/D4.

Tre vincoli stretti:

- **Stack vincolato**: NestJS + Prisma (§A3). Niente alternativa.
- **No build step in dev**: coerente con ADR-0005 (`packages/db` esporta sorgenti TS via `"main": "./src/index.ts"`) e ADR-0006 (TS Project References rimandato). Apps/api in dev deve consumare `@gestionale/db` come TS source senza pre-build.
- **Quality gates devono restare verdi**: typecheck via Turbo (ADR-0006), Husky pre-commit (ADR-0004), CI senza regression.

L'unico standard scontato sarebbe `nest new apps/api` da CLI ufficiale. Ma quello scaffold genera `package.json` con dipendenze e script propri, `tsconfig.json` indipendente, `eslint.config.js` proprio — divergono dal nostro monorepo (ESLint 9 flat root, Prettier root, tsconfig.base.json condiviso, Husky già configurato). Manual scaffold + integrazione mirata è la via.

## Decision

### a. NestJS 11 manual scaffold (no `nest new`)

Files creati a mano in `apps/api/`:

```
apps/api/
├── package.json         # @gestionale/api, scripts, deps
├── tsconfig.json        # estende root base, CJS override, noEmit
├── nest-cli.json        # per nest build futuro
├── .gitignore           # dist/, *.tsbuildinfo
└── src/
    ├── main.ts          # NestFactory + enableShutdownHooks + listen
    ├── app.module.ts    # imports DbModule + HealthModule
    ├── app.controller.ts # GET / → "Gestionale API"
    ├── db/
    │   ├── db.module.ts  # @Global + provides DbService
    │   └── db.service.ts # composition wrapper su @gestionale/db
    └── health/
        ├── health.module.ts
        ├── health.controller.ts # GET /health
        ├── health.service.ts    # check() con $queryRaw
        └── health.dto.ts        # shape response
```

Aderenza al monorepo:

- Estende `tsconfig.base.json` root (TS strict + `noUncheckedIndexedAccess`)
- Lint via root `eslint.config.js` con override scoped `apps/api/**/*.ts` per decorator + 3 regole NestJS-friendly disabilitate (`no-extraneous-class`, `no-useless-constructor`, `consistent-type-imports`)
- Prettier root automatico via pre-commit Husky
- Script `typecheck`, `lint`, `test` allineati al pattern Turbo (ADR-0006): `pnpm typecheck` root invoca il workspace via Turbo

### b. CommonJS per apps/api + packages/db (CC2 forzata)

`apps/api/package.json` **non** ha `"type": "module"` → CJS default. `tsconfig.json` ha `module: "commonjs"`, `moduleResolution: "node"`.

**Asimmetria iniziale tentata**: apps/api CJS + packages/db ESM (con `"type": "module"`). Fallita: `apps/api` (CJS) `require()` di `@gestionale/db` (ESM) → `Must use import to load ES Module`. Node rifiuta `require()` di un modulo dichiarato ESM dal suo `package.json#type`.

**Risoluzione adottata (CC2)**: rimosso `"type": "module"` da `packages/db/package.json`. Ora entrambi i workspace TypeScript sono CJS-friendly. Conseguenza necessaria (CC3): rimosso il suffisso `.js` dagli import interni di `packages/db/src/index.ts`, `packages/db/prisma/seed.ts`, `packages/db/scripts/smoke-soft-delete.ts` (suffisso `.js` ESM-style non risolve in CJS).

**Questo è tech debt esplicito, non scelta neutra**. Vedi sezione "Tech Debt Accepted" sotto per trigger di re-evaluation e stima rework.

### c. ts-node-dev per dev (con detour empirico documentato)

Script `dev`:

```json
"dev": "dotenv -e ../../.env -- ts-node-dev --respawn --transpile-only src/main.ts"
```

Ragioni:

- NestJS DI richiede `emitDecoratorMetadata` propagato a runtime (parameter types per constructor injection via reflection)
- `ts-node-dev` usa `ts-node` interno con `require.extensions` hook → intercetta `require('.ts')` ovunque, anche per workspace dep symlinkate (`node_modules/@gestionale/db/src/index.ts`)
- `--transpile-only` skippa typecheck (sostituito da Turbo `pnpm typecheck`), `--respawn` ricarica su file change

`@nestjs/cli` resta installato come devDep per `nest build` futuro (produzione), ma non è usato in dev.

### d. dotenv-cli wrapper su scripts

```json
"dev": "dotenv -e ../../.env -- ts-node-dev ...",
"start:prod": "dotenv -e ../../.env -- node dist/main.js"
```

Coerente con pattern adottato in `packages/db` (ADR-0005). `DATABASE_URL` (e in futuro `PORT`, `JWT_SECRET`, ecc.) letta dal root `.env` evitando un `.env` duplicato in `apps/api/`. In produzione gli env arriveranno dal container/process manager direttamente, niente file.

### e. DbModule `@Global` + DbService composition + lifecycle hooks

```typescript
@Global()
@Module({ providers: [DbService], exports: [DbService] })
export class DbModule {}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly prisma: ExtendedPrismaClient = prisma; // composition, non extends
  async onModuleInit() {
    await this.prisma.$connect(); /* log */
  }
  async onModuleDestroy() {
    await this.prisma.$disconnect(); /* log */
  }
}
```

- `@Global()` → DbService disponibile in qualsiasi modulo senza re-import
- **Composition** (esporta `prisma` come property) anziché inheritance (`extends PrismaClient`): più testabile (mock di `prisma` invece di tutto DbService), nessun rischio collision tra metodi NestJS lifecycle e metodi Prisma client, e in futuro DbService può aggregare altre risorse (transaction context, query metrics)
- `OnModuleInit` → `$connect()` eager: warm-up pool TCP prima del primo request, log esplicito di stato
- `OnModuleDestroy` → `$disconnect()`: graceful shutdown attivato da `app.enableShutdownHooks()` (CC4) su SIGTERM/SIGINT
- `prisma` singleton (importato da `@gestionale/db`) viene esteso con `softDeleteExtension` automaticamente (ADR-0005)

### f. HTTP 200/503 semantico via `ServiceUnavailableException`

`GET /health` ritorna:

- **200** con `{ status: 'ok', db: 'connected', timestamp }` se Prisma `$queryRaw\`SELECT 1\`` riesce
- **503** (via `throw new ServiceUnavailableException(dto)`) con `{ status: 'degraded', db: 'unreachable', timestamp, error }` se la query fallisce

Body identico in entrambi i casi (parsing uniforme client-side). Status code semantico per orchestrator (Kubernetes liveness/readiness, load balancer, monitoring). Pattern production-ready dal D1, anche se oggi siamo solo in dev.

## Considered Alternatives

| Alternativa                                                                      | Esito                         | Razionale                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nest new apps/api` da CLI ufficiale                                             | Rejected                      | Genera config divergenti (proprio ESLint, proprio Prettier, proprio tsconfig). Integrare costa più del manual scaffold; pulizia minore.                                                                                                                                                                  |
| **tsx watch** per dev                                                            | Rejected (TESTED empirically) | `tsx`/esbuild **non emette `emitDecoratorMetadata`** → constructor injection NestJS riceve `undefined` per parameter types → DI rotta a runtime. Dimostrato: `TypeError: Cannot read properties of undefined (reading 'check')` nel HealthController. tsx 4.21.0 non ha flag per attivare emit metadata. |
| **swc-node** / `nest CLI -b swc` per dev                                         | Rejected (TESTED empirically) | Vedi "Empirical Evidence" sotto. Compila solo workspace corrente, Node a runtime non sa eseguire `.ts` da workspace dep symlinkata.                                                                                                                                                                      |
| apps/api in **ESM** (con `"type": "module"`)                                     | Rejected                      | NestJS docs/ecosystem assumono CJS; ESM richiede `.js` suffix esplicito ovunque, top-level await, friction sui decorator. Avrebbe risolto l'asimmetria con packages/db ESM iniziale, ma packages/db CJS post-CC2 (più semplice) elimina comunque il problema.                                            |
| **Dual package packages/db** (CJS + ESM via `exports` field)                     | Rejected per ora              | Production-grade ma richiede build step (dist/index.cjs + dist/index.mjs + .d.ts), violando la disciplina "no build step finché non serve" (ADR-0005). Da rivalutare insieme a CC2.                                                                                                                      |
| **Healthcheck minimal** (200 sempre + status field, no 503)                      | Rejected                      | Più semplice client-side ma perde la semantica HTTP per orchestrator. Costo zero adottare 200/503 dal D1.                                                                                                                                                                                                |
| **Inheritance** `DbService extends PrismaClient`                                 | Rejected                      | Mock test richiederebbe subclass o stub di tutto PrismaClient. Composition espone `prisma` come property → mock surgical. Inheritance binds class hierarchy a Prisma version.                                                                                                                            |
| **Import diretto `prisma` da `@gestionale/db`** nei service NestJS (no DbModule) | Rejected                      | Bypassa DI → tests harder (no provider override), lifecycle non gestito da NestJS → no graceful shutdown. DbModule è il pattern idiomatic per backend NestJS.                                                                                                                                            |
| `process.env.PORT` direttamente in main.ts senza validazione                     | Accepted (per ora)            | F1 scaffold; in F2 valuteremo `@nestjs/config` con validation schema Zod o Joi.                                                                                                                                                                                                                          |

## Tech Debt Accepted

Sezione esplicita per non nascondere il debito tra altre note. Ogni voce ha trigger e stima rework.

### CC2: `packages/db` da ESM a CJS

**Cosa**: rimosso `"type": "module"` da `packages/db/package.json` per permettere a `apps/api` (CJS) di `require()` il workspace.

**Trigger di re-evaluation**: arrivo di `apps/web` (Next.js 14+ App Router). Next.js è ESM-everywhere per design (Server Components, Server Actions, edge runtime). Importare `@gestionale/db` CJS da Next.js può funzionare (Next.js fa transpilation), ma rischi:

- Edge runtime incompatibile con CJS
- Server Components con `"use server"` directive si aspettano ESM modules
- Future Next.js major version potrebbe enforce ESM-only

**Stima rework**: 1-2h. Opzioni:

- **Dual package** via `exports` field in `packages/db/package.json`: build step che produce `dist/index.cjs` + `dist/index.mjs` + `dist/index.d.ts`. Pattern professional ma richiede build pipeline + adozione TS Project References (ADR-0006 opzione c). 1.5-2h.
- **ESM-everywhere**: ripristinare `"type": "module"` su packages/db, convertire apps/api a ESM. Cambia ts-node-dev → tsx o ts-node + ESM loader. Richiede testare decorator metadata in ESM context (riferimento: NestJS 11 + ESM compat note non triviali). 1.5-3h.

Decisione strategica: rivalutare quando D2/D3/D4 NestJS sono stabili e prima di iniziare il D-stream per `apps/web`.

### CC1: ts-node-dev maintenance status

**Cosa**: `ts-node-dev` v2.0.0 ultima major release ~2022. Repo attivo solo per patch, no roadmap pubblica per swc native support.

**Trigger di re-evaluation**: insieme a CC2 (decisione strategica unica CJS/ESM + dev runner). Se passiamo a ESM-everywhere o dual package, riconsidereremo swc-node/swc builder.

**Workaround disponibili** se serve switchare a swc prima:

- Build step packages/db (vedi CC2 dual package option)
- Loader Node-side `@swc-node/register` con setup nodemon custom (~30 min)
- TS Project References (ADR-0006 opzione c, ~2-4h migration)

**Monitor**: aprire issue di tracking in repo su `ts-node-dev` health ogni 6 mesi. Se major bug security senza fix, escalation prioritaria.

### Edge case: deletedAt soft-delete su workspace TS source

Soft-delete extension auto-detect (ADR-0005) opera via `Prisma.dmmf.datamodel.models[].fields[].name === 'deletedAt'`. Funziona oggi perché ts-node-dev compila TS on-the-fly. Se in futuro `packages/db` viene buildato (CC2 dual package), il dmmf resta accessibile dal compiled JS — niente regressione attesa, ma da verificare empiricamente nel rework.

## Empirical Evidence — swc detour (13 min)

Esplorazione documentata perché lezione utile per il futuro.

### Test #1: `nest start --watch -b swc` con paths aliases attivi

Setup:

- `pnpm add -D -F @gestionale/api @swc/cli @swc/core`
- `.swcrc` con `legacyDecorator: true`, `decoratorMetadata: true`, `module.type: "commonjs"`
- `nest-cli.json` `compilerOptions: { builder: "swc", typeCheck: true }`

Errore:

```
Error: Cannot find module '../../packages/db/src/index.ts'
Require stack:
- /home/deploy/projects/gestionale/apps/api/dist/db/db.service.js
- ...
```

**Root cause**: swc legge `paths` aliases dal `tsconfig.base.json` (`"@gestionale/*": ["packages/*/src/index.ts"]`) e li applica come require literal. Genera `require('../../packages/db/src/index.ts')` invece di `require('@gestionale/db')`.

### Test #2: paths reset (`"paths": {}` in apps/api/tsconfig.json)

Errore:

```
/home/deploy/projects/gestionale/packages/db/src/index.ts:16
import { PrismaClient, Prisma } from '@prisma/client';
^^^^^^

SyntaxError: Cannot use import statement outside a module
```

**Root cause**: path ora risolve correttamente via workspace symlink (`require('@gestionale/db')` → `packages/db/src/index.ts`). Ma swc compila **solo `apps/api`** in `dist/`. Node esegue `dist/main.js`, che `require()` il `.ts` raw di packages/db. Node CommonJS non sa eseguire TypeScript senza loader runtime → SyntaxError.

### Conclusione empirica

`nest start -b swc` (e similmente `tsx watch`) presuppongono il modello **build → dist → run**: tutti i sorgenti TypeScript del progetto vengono compilati in `dist/`, e Node esegue il JS. Funziona quando il workspace è autocontenuto.

Il nostro setup invece consuma workspace dep **live come TS source** via symlink `node_modules/@gestionale/db/src/index.ts`. Solo i runner che intercettano `require('.ts')` con un hook globale (ts-node, ts-node-dev) gestiscono questo pattern senza build step.

Tempo investito: ~13 minuti (sotto budget 20). **Non tempo perso**: l'evidenza empirica è il razionale per la decisione (c) e per la re-evaluation futura (CC1).

## Consequences

### Positive

- **Backend NestJS funzionante** in dev, consumer di `@gestionale/db` con DI + lifecycle gestiti
- **Health endpoint production-ready** (200/503 semantico) dal D1 — orchestrator-friendly senza retrofit
- **Aderenza monorepo**: TS strict via base, lint flat config root, Prettier root, Husky pre-commit attivo
- **`pnpm typecheck` ora valida 2 workspace** via Turbo (`@gestionale/db` + `@gestionale/api`) — gap ADR-0006 + tech debt CI risolto in pratica
- **Tech debt esplicito**: CC1 e CC2 sono documentati con trigger e stima, non nascosti

### Negative / Trade-off

- **Tech debt CJS**: packages/db perde `type: module` → rework atteso 1-2h quando arriverà apps/web
- **ts-node-dev "stale"**: monitoring richiesto, fallback plan se va deprecated
- **No build NestJS oggi**: `nest build` funziona ma non testato per produzione (apps/api/tsconfig.json ha `noEmit: true`, build futura richiederà `tsconfig.build.json` dedicato)
- **No test framework**: Vitest rimandato a quando arriverà la prima business logic (D2 auth probabilmente)

### Neutral

- **ESLint override scoped per apps/api** sono nel root `eslint.config.js` (block `files: ['apps/api/**/*.ts']`) perché ESLint 9 flat config non ha config-discovery automatica per workspace. Documentato inline nel root config + qui.
- **`@nestjs/cli`** installato come devDep ma non usato in dev. Resta per `nest build` futuro (produzione) e per eventuali `nest generate` ad-hoc.

## Reversibility

| Scenario                         | Costo                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Switch a tsx watch               | Banale ma rompe DI (gap noto). Non reversibile praticamente.                                  |
| Switch a swc/swc-node            | Vedi CC1 workarounds: build step packages/db, loader Node, o Project References. 30 min – 4h. |
| Switch packages/db a ESM         | Vedi CC2: dual package o ESM-everywhere. 1-2h.                                                |
| Switch a `nest new` CLI scaffold | ~1h: re-allineare i config generati al root (tsconfig, eslint, prettier). Sconsigliato.       |
| Switch DbService inheritance     | Trivial: cambio class declaration, mock test devono refactor (impatto basso oggi: zero test). |
| Switch healthcheck a 200-only    | Trivial: rimuovere `throw new ServiceUnavailableException(dto)` nel controller.               |

## Notes

- Versioni installate (2026-05-13): `@nestjs/core@11.1.19`, `@nestjs/common@11.1.19`, `@nestjs/platform-express@11.1.19`, `ts-node-dev@2.0.0`, `ts-node@10.9.2`, `reflect-metadata@0.2.2`, `dotenv-cli@11.0.0`
- `apps/api/tsconfig.json` ha `noEmit: true` (sviluppo via ts-node-dev). Per `nest build` futuro creeremo `tsconfig.build.json` con `outDir`, `rootDir`, `exclude` workspace deps
- Endpoint smoke test post-scaffold:
  - `curl http://localhost:3000/` → 200 "Gestionale API"
  - `curl http://localhost:3000/health` → 200 `{"status":"ok","db":"connected","timestamp":"..."}`
- Lifecycle log osservati: `[DbService] Prisma connected to PostgreSQL` su startup; `Prisma disconnected` previsto su SIGTERM/SIGINT in shell interattiva (`app.enableShutdownHooks()` attivo)
- Smoke test `packages/db`: 9/9 verdi post-modifiche CC2/CC3 — nessuna regression sui pattern soft-delete + forceDelete
