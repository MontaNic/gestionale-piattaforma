# ADR-0011 — Dual package strategy + Next.js 15 scaffold (E1)

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0005](./ADR-0005-prisma-data-layer.md) (data layer), [ADR-0006](./ADR-0006-typecheck-monorepo.md) (Turbo typecheck), [ADR-0007](./ADR-0007-nestjs-api-scaffold.md) (NestJS scaffold — **CC1/CC2 risolti qui**)

## ✅ Status finale

**E1 completato: `apps/web` Next.js 15 + Tailwind 3.4 + shadcn/ui operativo a :3001, consumer di `@gestionale/db` via dual package exports.**

- `packages/db` ha ora build step (`tsup`) → emette `dist/index.{cjs,mjs,d.cts,d.ts}` con conditional exports
- `apps/api` (CJS) consuma trasparentemente via `exports.require → dist/index.cjs` — **zero modifiche**
- `apps/web` (Next ESM) consuma via `exports.import → dist/index.mjs` con types via `dist/index.d.ts`
- Turbo build chain: `dev`/`typecheck` con `dependsOn: ["^build"]` orchestra db build prima di api/web
- Smoke gate Fase 6: **6/6 PASS** (health 200 + web 200 + typecheck 4/4 FULL TURBO + lint clean + 8/8 Vitest + 7/7 smoke RLS)

## Context

[ADR-0007 §CC2](./ADR-0007-nestjs-api-scaffold.md#cc2-packagesdb-da-esm-a-cjs) ha registrato il tech debt **packages/db forzato a CJS** per consentire interop con apps/api CJS. La nota CC2 prevedeva re-evaluation **all'arrivo di apps/web** (Next.js ESM-everywhere by design): edge runtime, Server Components, Server Actions sono ESM-native, e mantenere packages/db CJS-only avrebbe richiesto `transpilePackages` workaround o future-breaking compromessi.

E1 è il primo macro-task frontend e il trigger naturale per la decisione strategica. Tre opzioni considerate (a/b/c di ADR-0007 CC2):

- **(a) Dual package**: build step packages/db emette `dist/index.cjs` + `dist/index.mjs` + `dist/index.d.ts`. Pattern production-grade, professional, ATTW compliant. Scelto.
- **(b) ESM-everywhere**: ripristina `"type": "module"` su packages/db, converte apps/api a ESM. Richiede gestire decorator metadata in ESM context (NestJS 11 + ESM compat non triviali, riferimento detour swc D1 — vedi ADR-0007 "Empirical evidence").
- **(c) tsx workaround**: hook globale TS che intercetta require di file `.ts`. Friction su build prod, asymmetria dev/prod, non scalabile.

In parallelo, lo scaffold di apps/web richiedeva 4 decisioni stack:

1. Versione Next.js (15 vs 14)
2. Versione React (18.3 vs 19)
3. Versione Tailwind (3.4 vs 4)
4. Modalità scaffold (manual vs `create-next-app`)

## Decisions

### 1. Dual package `packages/db` via `tsup` (Opzione A di ADR-0007 CC2)

`packages/db/package.json`:

```json
{
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "scripts": { "build": "tsup", "dev": "tsup --watch" }
}
```

`exports` field conditional con types nested per import/require: pattern **"Are The Types Wrong" compliant** (npm publish-ready se diventerà package pubblico in futuro). Consumer-side:

- `apps/api` (CJS, `module: commonjs`, NO `type: module`) → Node risolve via `exports.require` → `dist/index.cjs`
- `apps/web` (ESM, Next.js bundler) → Node risolve via `exports.import` → `dist/index.mjs`
- Editor/typecheck apps/api: eredita `paths` da `tsconfig.base.json` → resolve a `packages/db/src/index.ts` (TS source live, no rebuild necessario in dev per i tipi)
- Editor/typecheck apps/web: override `paths`, no alias `@gestionale/*` → resolve a `dist/index.d.ts` (types da build artifact)

Asimmetria intenzionale (vedi Discoveries F3 sotto).

### 2. `tsup` come build tool (vs `tsc` puro)

- **Zero config** out-of-the-box: 1 file `tsup.config.ts` 12 LOC totali
- **esbuild speed**: build CJS + ESM in ~150ms ciascuno, DTS in ~1s (incremental skip su cache hit Turbo)
- **Dual format out-of-the-box**: `format: ['cjs', 'esm']` + `outExtension` esplicito (`.cjs`/`.mjs`) → exports field deterministico
- **DTS rollup**: usa `rollup-plugin-dts` internamente, emette `index.d.cts` + `index.d.ts` (uno per condition)
- **External**: `external: ['@prisma/client', '.prisma/client']` evita di bundlare il client Prisma (resta peer dep risolto runtime)
- Override `dts.compilerOptions.incremental: false` per fix TS5074 (DTS rollup emit singolo, incompatibile con `--incremental` ereditato dalla base)

### 3. Tailwind **3.4** (NO 4)

`tailwindcss@^3.4` (installato 3.4.19). Motivi:

- **shadcn/ui ecosystem**: 100% compatibility, la maggioranza dei componenti shadcn nel registry usano sintassi T3 (HSL `var(--*)`, `@tailwind base/components/utilities`, plugin `tailwindcss-animate`). T4 ha nuova sintassi (`@theme`, `oklch()`, `@import "tailwindcss"`) che richiede componenti adattati.
- **Breaking changes T4**: nuovo `@theme` directive, color space migration (HSL → oklch), nuovo plugin model. Migration prematura per F1 dove l'obiettivo è scaffold funzionante, non early-adopter Tailwind.
- **Stabilità**: 3.4 è LTS de-facto, fix nuovi minori, ecosystem ampio.

T4 migration tracciata come tech debt #1 sotto.

### 4. React **18.3** (NO 19)

`react@^18.3.1` + `react-dom@^18.3.1`. Motivi:

- **Ecosystem maturity**: dicembre 2025 la maggior parte delle librerie third-party (Radix, shadcn components che usano Radix, react-hook-form, zod resolvers, tanstack-query) hanno full compat 18.3, parziale o sperimentale su 19.
- **shadcn/ui**: Button + altri primitives usano Radix UI Slot e altre prim. Radix `^1.1` ha peer dep React 18, anche se 19 funziona empirically la combinazione `@radix-ui/* + React 19` ha ancora warning di compat in certi flow.
- **No Server Actions overhaul required**: il flow auth E2 useremo classico fetch-based con JWT, non `useFormState` 19-only.

React 19 migration tracciata come tech debt #2 sotto.

### 5. Manual scaffold `apps/web` (NO `create-next-app`)

Coerente con il pattern manual scaffold di apps/api ([ADR-0007](./ADR-0007-nestjs-api-scaffold.md) decisione a). `create-next-app` genera:

- ESLint config proprio (`.eslintrc.json` esteso non-flat) → divergente da `eslint.config.js` root ESLint 9 flat config
- `tsconfig.json` indipendente che NON estende `tsconfig.base.json`
- Auto-install Tailwind 4 + altre deps non controllate dal monorepo
- `.gitignore` per-workspace duplicato

Manual scaffold = controllo deterministico su 7 file: `package.json`, `tsconfig.json`, `next.config.mjs`, `.eslintrc.json`, `src/app/{layout,page}.tsx`, `src/app/globals.css`. Integrazione con `tsconfig.base.json` + `eslint.config.js` + Husky + Prettier root invariata.

## Discoveries E1 (5 finding empirici)

### F1 — 10 type errors latenti in `packages/db/src/` rivelati da tsup DTS

`tsup --dts` esegue `rollup-plugin-dts` che richiede typecheck pulito sui sorgenti di `entry`. Al primo build E1, emersi 10 errori in `src/rls.ts`, `src/soft-delete.ts`, `prisma/seed.ts`, `scripts/smoke-soft-delete.ts`:

- `Prisma.dmmf` (TS): rimosso dai `.d.ts` pubblici in Prisma 6 (runtime accessibile). Pattern documentato: `(Prisma as any).dmmf as { datamodel: ... }`.
- `$executeRawUnsafe` su `tx`: il tipo `Tx` post-`$extends` strippa metodi raw (`Omit<PrismaClientExtends, "$transaction" | ...>`); runtime ce l'ha. Cast `tx: any` UNA volta nel callback (consolidato l'`as any` ripetuto già presente).
- Implicit any su lambda `.map(p => ...)` in seed.ts/smoke-soft-delete.ts (Prisma 6 non infera più i types delle `findMany` chained map nelle condizioni di `Map` constructor).

**Cause** (analisi post-mortem):

- `packages/db/tsconfig.json` aveva `noEmit: true` → `tsc --noEmit` runnava typecheck del codice del workspace ma NON il rollup-style sui transitive types che `tsup --dts` esercita più strettamente
- Pattern complessi D3a/D3b/D4 (Prisma extension + atomic helpers + dmmf introspection) hanno introdotto la fragilità ma nessun gate la stava catturando
- Baseline E1 ha incluso solo `pnpm test` (Vitest 8/8) + `smoke:rls-e2e` (7/7), entrambi runtime — NO typecheck baseline

**Fix**: minimal in-place type assertion con commento motivazione runtime, ZERO refactor. Pattern coerente con codice esistente (`tx as any` già usato altrove). 10 errori → 0.

**Lesson**: typecheck nel CI/baseline non è opzionale anche se test runtime passano. tech debt: il DTS emit ora è il gate effettivo.

### F2 — `pnpm --filter <ws> <script>` bypassa Turbo orchestration

Setup `turbo.json` con `dev: { dependsOn: ["^build"] }` per garantire build di packages/db prima di api/web dev. Smoke test Fase 3 inizialmente con `pnpm --filter @gestionale/api dev` → **FALLITO** con `Cannot find module 'dist/index.cjs'`.

**Root cause**: `pnpm --filter <ws> <script>` esegue lo script direttamente (`dotenv -- ts-node-dev ...`), bypassando Turbo. Il `dependsOn` di `turbo.json` scatta SOLO se l'entrypoint è Turbo proper.

**Soluzioni**:

- **Root**: `pnpm dev` → richiama `turbo run dev` (orchestrato) — preferito per dev locale full-stack
- **Filtered**: `pnpm exec turbo run dev --filter=@gestionale/api` — preferito per filtrare a un workspace specifico mantenendo la chain
- **Anti-pattern**: `pnpm --filter @gestionale/api dev` — funziona SOLO se `dist/` esiste già

**Tracking**: documentato in README sezione "Sviluppo locale". Memo te-futuro: aggiungere alias o pre-script se la frequenza di errore lo richiederà.

### F3 — Path resolution asymmetry intentional `apps/api` vs `apps/web`

`tsconfig.base.json` definisce `paths: { "@gestionale/*": ["packages/*/src/index.ts"] }` (alias a source TS).

- **apps/api/tsconfig.json**: NON override `paths` → eredita base → `@gestionale/db` resolve a `packages/db/src/index.ts` durante typecheck (TS source live). Runtime via Node module resolution → `dist/index.cjs` (exports.require).
- **apps/web/tsconfig.json**: override `paths: { "@/*": ["apps/web/src/*"] }` → l'alias `@gestionale/*` viene perso (paths NON merge, override totale). Resolve via node_modules → `dist/index.d.ts` (exports.import).

**Trade-off**:

- apps/api beneficia di hot-reload-friendly editor experience (cambio file in packages/db/src → typecheck immediato apps/api senza rebuild)
- apps/web ha simmetria type/runtime (entrambi via dist) — più rigorosa, ma richiede build per nuovi tipi packages/db

**Decisione**: keep asymmetry per ora. Quando arriverà apps/kds (3° workspace consumer), valutare uniformazione "always dist" o "always src" (tech debt #4 sotto).

**Side-effect del path resolution**: in `apps/web/tsconfig.json` ho dovuto usare `"@/*": ["apps/web/src/*"]` (path completo da workspace root baseUrl), NON `"@/*": ["./src/*"]` (che risolverebbe contro workspace root, non config-dir). Confusione classica TypeScript paths: `paths` sono relativi a `baseUrl`, NON al file `tsconfig.json` che li dichiara.

### F4 — `shadcn@latest` (4.7.0) pollution + Tailwind 4 default → manual scaffold

Briefing prevedeva `pnpm dlx shadcn@latest init` + `pnpm dlx shadcn@latest add button`. Esecuzione empirica:

1. `shadcn@4.7.0 init -y -d`:
   - Generato `globals.css` con `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`, `oklch(...)` colors → Tailwind 4 syntax (NON compat con T3 installato)
   - Aggiunto deps **non richieste**: `@base-ui/react ^1.4.1`, `tw-animate-css ^1.4.0`, `shadcn ^4.7.0` (CLI in dependencies!), `tailwind-merge ^3.6.0` (T4-era versione)
   - Creato file in `/home/deploy/projects/gestionale/src/...` (workspace **root**, fuori apps/web) → orphan pollution
   - Auto-modificato `apps/web/src/app/layout.tsx`: import `Geist` da `next/font/google` + `cn` da utils

2. Retry con `shadcn@2 init -y -d` → fail su `Validation failed: tailwind: Required` (richiede prompts interattivi che -d non bypassa).

**Soluzione**: rollback completo (rm orphan, revert package.json + layout/globals) + **scaffold manuale 5 file standard shadcn-style T3-compat**:

- `components.json` (config shadcn, style `default`, baseColor `slate`, cssVariables true)
- `src/lib/utils.ts` (cn() helper via clsx + tailwind-merge)
- `src/components/ui/button.tsx` (Button con cva 6 variants 4 sizes + Slot asChild)
- `src/app/globals.css` (Tailwind directives + CSS vars `hsl(...)` :root/.dark)
- `tailwind.config.ts` (theme.extend colors HSL vars + plugin `tailwindcss-animate`)

Deps T3-compat installati: `@radix-ui/react-slot ^1.1`, `class-variance-authority ^0.7`, `clsx ^2.1`, `tailwind-merge ^2.5`, `lucide-react ^0.460`, `tailwindcss-animate ^1.0` (devDep).

**Lesson**: per progetti stuck a Tailwind 3.4 nel 2026, manual scaffold è la sola via affidabile. shadcn CLI ≥3.x non ha opt-out flag T3 documentato. Tracking: tech debt #5 sotto.

### F5 — `next-env.d.ts` triple-slash references rifiutate da ESLint root

Next.js 15 genera `apps/web/next-env.d.ts` al primo `next dev`. Il file usa `/// <reference types="next" />` (triple-slash). Root `eslint.config.js` ha `@typescript-eslint/consistent-type-imports: error` (e implicito triple-slash-reference). Lint fail su file auto-generato che NON va editato.

**Fix**:

- `eslint.config.js`: aggiunto `**/next-env.d.ts` a `ignores`
- `.gitignore`: aggiunto `next-env.d.ts` (raccomandazione Next.js docs 15)

Pattern documentato in Next.js docs. Minimal change, no rule globale rilasciata.

## Considered Alternatives

| Alternativa                                           | Esito                          | Razionale                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(b) ESM-everywhere** (packages/db + apps/api → ESM) | Rejected                       | NestJS 11 + decorator metadata in ESM context fragile (riferimento detour swc D1 in ADR-0007 "Empirical evidence"). Migration apps/api da `module: commonjs` + `ts-node-dev` (CJS-native) a ESM richiederebbe loader Node `@swc-node/register` o tsx con polyfill decorator emit. |
| **(c) tsx workaround**                                | Rejected                       | Hook globale require di `.ts` file fragile, asymmetria dev/prod, non scalabile a apps/kds + worker. Tech debt invece di soluzione.                                                                                                                                                |
| **tsc puro** (`tsc --emitDeclarationOnly` + esbuild)  | Rejected                       | Setup 2-tool con pipeline da scriptare. tsup integra tutto. tsup è essentialmente wrapper su esbuild + tsc/rollup-plugin-dts.                                                                                                                                                     |
| **`shadcn@latest` forced Tailwind 3** via CLI flags   | Rejected (no flag documentato) | Né `--style default` né `--base-color slate` né `--config` forzano T3 syntax. shadcn 4.7.0 hardcoded T4 default in CSS generation. Manual scaffold più affidabile.                                                                                                                |
| **Tailwind 4 ora**                                    | Rejected per ora               | Ecosystem migration in corso, shadcn registry transition incompleta. T4 = early-adopter, F1 vuole stabile. Tech debt tracciata.                                                                                                                                                   |
| **React 19 ora**                                      | Rejected per ora               | Ecosystem libraries assorbimento incompleto, peer dep warnings su Radix + altre librerie. Tech debt tracciata.                                                                                                                                                                    |
| **`create-next-app` con cleanup post**                | Rejected                       | Auto-install deps non controllate, divergence config (ESLint, tsconfig). Cleanup post = N file da revertire. Manual scaffold = N file da scrivere, deterministico.                                                                                                                |
| **transpilePackages: ['@gestionale/db']**             | Not needed                     | Next 15 + dual package exports field `import` → packages/db ESM caricato natively. `transpilePackages` necessario solo se packages/db rimanesse CJS-only (scenario pre-E1). Tenuto commentato in `next.config.mjs` come fallback documentato.                                     |

## Reversibility

| Scenario                                   | Costo                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rimozione completa apps/web                | ~5 min: `rm -rf apps/web`, `pnpm install`, rimuovi workspace dep dal lockfile. Zero impatto su packages/db (resta dual package, apps/api invariato).                                                                                                                                           |
| Downgrade packages/db a CJS-only (post-E1) | ~30 min: revert `package.json` (rimuovi `type: module` + dist exports), `tsconfig.json` (`noEmit: true` resta), elimina `tsup.config.ts`, ripristina `main: "./src/index.ts"`. Apps/api funziona invariato. Apps/web rotto (dovrebbe avere `transpilePackages` o ridiventare consumer source). |
| Migration Tailwind 3 → 4                   | ~2-3h: install `tailwindcss@^4` + `@tailwindcss/postcss`, update `postcss.config.mjs`, riscrittura `globals.css` da HSL → oklch + `@theme`, update `tailwind.config.ts` syntax, retest visivo Button.                                                                                          |
| Migration React 18.3 → 19                  | ~1-2h: bump deps, check peer dep warnings, test stripe-side se compile/render rotto. Probabile aggiornare anche Radix + tutto l'ecosystem terzo.                                                                                                                                               |
| Switch tsup → tsc puro                     | ~1h: scrivi `tsconfig.build.json` con `outDir: dist`, `declaration: true`, `module: nodenext`, due build separati per CJS/ESM (output diversi), aggiungi script bash. tsup è 12 LOC, tsc + scripting sarebbe 40+ LOC.                                                                          |
| Switch manual scaffold → `create-next-app` | ~30 min: backup file E1, run `create-next-app`, merge config divergenti (eslint, tsconfig, tailwind). Sconsigliato (vedi decisione 5).                                                                                                                                                         |

## Tech Debt Accepted

Sezione esplicita per non nascondere il debito tra altre note. Ogni voce ha trigger e stima rework.

### TD-1: Migration Tailwind 3.4 → 4

**Cosa**: Tailwind 3.4.19 oggi. T4 è il nuovo standard ma ecosystem (shadcn registry, plugin third-party) in transizione.

**Trigger di re-evaluation**:

- shadcn registry completata migration T4 (oggi metà componenti)
- T4 plugins ecosystem matura (animate, typography, forms)
- Decisione strategica: bump quando ne emergerà beneficio concreto (es. nuove utility non backportable a T3)

**Stima rework**: 2-3h. Riscrittura `globals.css` (HSL → oklch CSS vars + `@theme`), aggiornare `tailwind.config.ts` syntax (no `theme.extend` style classico), retest visivo Button + futuri componenti.

### TD-2: Migration React 18.3 → 19

**Cosa**: React 18.3.1 oggi. R19 introduce Actions, `use()`, Server Components stable.

**Trigger di re-evaluation**:

- Radix UI + altre librerie third-party rimuovono warning compat R19
- shadcn registry validato 100% R19
- Feature R19 specifica diventa critical (es. Server Actions per form submit)

**Stima rework**: 1-2h. Bump deps, test peer dep warnings, run E2E web.

### TD-3: TypeScript 7.0 `baseUrl` deprecation (carry-over)

**Cosa**: `tsconfig.base.json` usa `baseUrl: "."` (richiesto da `paths`). TS 5.9 segnala deprecation warning, TS 7.0 lo rimuoverà.

**NOT introdotto da E1**: la deprecation pre-esisteva nella base config. E1 ha solo evidenziato il warning IDE durante editing `apps/web/tsconfig.json` (PostToolUse hook IDE).

**Trigger di re-evaluation**: bump TypeScript a 7.0 (oggi 5.9.x). Stimato Q3 2026 release.

**Stima rework**: 30-45 min. Migrate `paths` a self-contained absolute style senza `baseUrl`: ogni tsconfig dichiara `paths` con path completi da config-dir. Pattern documentato in [TS docs migration guide](https://aka.ms/ts6).

### TD-4: `packages/db` source-vs-dist dev experience asymmetry

**Cosa**: F3 sopra documenta l'asimmetria intenzionale apps/api (typecheck via src/) vs apps/web (typecheck via dist/). Funziona oggi (2 consumer), ma con 3+ workspace consumer (apps/kds, worker, ecc.) la confusione potrebbe aumentare.

**Trigger di re-evaluation**: arrivo del 3° workspace consumer di `@gestionale/db` (probabile apps/kds in F1 sezione D del brief).

**Stima rework**: 30-60 min. Opzioni:

- **Always-dist**: rimuovi `paths` alias `@gestionale/*` da `tsconfig.base.json`, tutti i consumer typecheck via dist. Più rigorso, richiede `pnpm dev` (root) per dev (perché build chain è necessaria).
- **Always-src**: dichiara `paths` anche in apps/web (ma break dual package symmetry).

Decisione strategica unica.

### TD-5: shadcn manual scaffold update path

**Cosa**: 5 file shadcn scritti manualmente in E1. shadcn registry continuerà ad aggiornare i componenti (security fix, accessibility, Radix updates).

**Trigger di re-evaluation**:

- shadcn 5.x rilascia opt-out flag T3 documentato → retry CLI
- Componenti aggiornati nel registry hanno breaking changes che vogliamo prendere

**Stima rework**: 15-30 min per componente. Pattern: scarica il file aggiornato dal registry shadcn-ui.com manualmente, diff vs nostra versione, merge a mano. Workflow scriptable.

**Monitor**: review shadcn CHANGELOG ogni 6 mesi o quando F1 introduce nuovi componenti complessi (form, dialog, command-menu).

## Consequences

### Positive

- **CC2 di ADR-0007 risolto**: `packages/db` torna ESM-native con dual package, supporta consumer CJS (apps/api) + ESM (apps/web) trasparentemente
- **CC1 di ADR-0007 (ts-node-dev maintenance)**: NON risolto qui, ma il dual package abilita una eventuale switch a swc-node con build step minimo (path opzionale futuro)
- **Frontend funzionante**: apps/web Next 15 a :3001 con Button shadcn renderizzato, stack moderna stabile
- **Turbo build chain**: cache hit FULL TURBO 119ms su 4 workspace, dev orchestrato con build cross-package automatica
- **6/6 quality gates verdi** Fase 6 (health, web, typecheck, lint, test, smoke RLS) → zero regression
- **5 discoveries empiriche documentate** (tech debt visibility forte, replicable di pattern D4)

### Negative / Trade-off

- **Build step in dev per packages/db**: prima un import era `tsx`-resolvable direttamente, ora richiede `dist/` esistente o `tsup --watch` running. Mitigato da Turbo dependsOn chain quando entrypoint è proper.
- **2 file `.d.ts` (cts + ts)**: ATTW compliant ma confusione potenziale ("perché 2 dichiarazioni se il sorgente è 1?"). Documentato qui.
- **Path resolution asymmetry**: F3 above. Trade-off intenzionale ma sorgente di confusione futura → tracked TD-4.
- **5 type errors in packages/db da fix in-fase**: erano latenti pre-E1 (D3a/D3b/D4), NON regression di E1, ma E1 il primo gate a catturarli. Tech debt esposta (≠ creata).

### Neutral

- **Turbo cache `outputs`**: già pre-configurato in `turbo.json` da macro-task precedenti con `dist/**` + `.next/**`. Zero changes structural a Turbo.
- **Husky pre-commit**: lint-staged ESLint + Prettier root continua a funzionare invariato sui file apps/web (no override scoped richiesto).

## Security considerations

E1 è frontend stub senza auth wiring. Nessuna nuova superficie di attacco:

- Web a :3001 renderizza solo home statica
- Nessun fetch verso API
- Nessun storage credenziali
- Build artifacts (`dist/`, `.next/`) gitignored

E2 (auth flow UI, prossimo macro-task) introdurrà security considerations specifiche (storage refresh token, CSP, CSRF).

## Notes

- Versioni installate (2026-05-13): `next@15.5.18`, `react@18.3.1`, `react-dom@18.3.1`, `tailwindcss@3.4.19`, `postcss@8.5.14`, `autoprefixer@10.5.0`, `tailwindcss-animate@1.0.7`, `tsup@8.5.1`, `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@2.6.1`, `lucide-react@0.460.0`, `@radix-ui/react-slot@1.2.4`
- `apps/web/tsconfig.json` ha `incremental: true` (Next standard) + `noEmit: true` (`tsc` solo per typecheck, build vero via `next build`)
- `apps/web/next.config.mjs` ha `transpilePackages: ['@gestionale/db']` commented — fallback documentato se future Next 15 update rompe ESM consumer di workspace dep
- Smoke gate Fase 6 outputs:
  - `curl :3000/api/v1/health` → 200 `{"status":"ok","db":"connected","timestamp":"..."}`
  - `curl :3001/` → 200 HTML con `<title>Gestionale</title>`, `<h1>Gestionale Platform</h1>`, `<button class="bg-primary text-primary-foreground ...">`
  - `pnpm typecheck` cache hit → 119ms FULL TURBO 4/4
  - `pnpm lint` → exit 0 (post fix ignores `next-env.d.ts`)
  - `pnpm test` → 8/8 Vitest
  - `pnpm --filter @gestionale/db smoke:rls-e2e` → 7/7
