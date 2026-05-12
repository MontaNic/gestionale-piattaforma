# ADR-0006 — Strategia typecheck monorepo via Turbo

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** `PROJECT_BRIEF.md` §C12 (convenzioni codice), §C6 (testing/typecheck), [ADR-0005](./ADR-0005-prisma-data-layer.md) (data layer in `packages/db`)

## Context

Durante il Macro-task B (Prisma data layer completo) è emerso un gap nella pipeline di validazione TypeScript del monorepo: lo script `pnpm typecheck` definito nel root `package.json` come `tsc --noEmit` invocava il typecheck contro il root `tsconfig.json`, che è una **solution-style** con `files: []` e `references: []` (vedi setup CI/CD del 2026-05-11 quando il root tsconfig fu introdotto per far passare `tsc --noEmit` in CI prima dell'arrivo dei workspace).

Conseguenza: la CI eseguiva `pnpm typecheck` → `tsc --noEmit` con zero file in input → exit 0 **a prescindere** dallo stato TypeScript dei workspace. Un errore TS in `packages/db/src/index.ts` non veniva rilevato dalla CI. Lo stesso sarebbe valso per `apps/api`, `apps/web`, `packages/ui`, ecc. quando arriveranno.

Il workspace `@gestionale/db` aveva già il proprio script `typecheck: "tsc --noEmit"` con `packages/db/tsconfig.json` che include effettivamente i sorgenti — ma il root non lo invocava.

**Rischio concreto**: scrivere codice TypeScript broken in un workspace, vedere CI verde, mergiare. Errore visibile solo a runtime o quando un altro developer tenta il typecheck locale di quel workspace specifico. Pattern silente, esattamente il tipo di problema che la CI dovrebbe prevenire.

**Failure injection test** ha confermato il gap empiricamente:

- Prima del fix: `const __test_error: string = 123;` in `packages/db/src/index.ts` → `pnpm typecheck` root **exit 0 ❌ falso negativo**
- Dopo il fix: stessa modifica → `pnpm typecheck` root **exit 2 ✅ TS2322 rilevato**

## Decision

**Adottiamo Turbo come orchestratore del task `typecheck`**, propagando l'esecuzione a tutti i workspace che hanno lo script omonimo.

### Implementation

```json
// package.json (root)
{
  "scripts": {
    "typecheck": "turbo run typecheck"
  }
}
```

```json
// turbo.json
{
  "tasks": {
    "typecheck": {
      "outputs": []
    }
  }
}
```

```json
// packages/db/package.json (e ogni futuro workspace TS)
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

### Comportamento

- `pnpm typecheck` dal root → `turbo run typecheck` → enumera i workspace, esegue `tsc --noEmit` su ciascuno
- Cache **content-addressed** di Turbo: hash dei sorgenti (e config) determina cache hit/miss. Re-run senza modifiche → `>>> FULL TURBO` (54ms misurati su `@gestionale/db`)
- CI invariata: `pnpm typecheck` continua a essere lo step, ma ora propaga via Turbo automaticamente
- Quando arriveranno `apps/api`, `apps/web`, ecc., basterà aggiungere lo script `typecheck` nei rispettivi `package.json` e Turbo li includerà nello scope senza altre modifiche

### Cosa è stato rimosso

- `turbo.json` task `typecheck` aveva `dependsOn: ["^build"]` (template Turbo standard per workspace con build step). Rimosso perché: nessun workspace ha ancora `build` script, e `packages/db` esporta direttamente sorgenti TS via `"main": "./src/index.ts"`. Reintroduciamo quando arriverà un workspace con `tsc --build` o webpack/swc build chain (probabilmente con NestJS).

## Considered Alternatives

| #   | Alternativa                                    | Esito              | Razionale                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) | **`turbo run typecheck`**                      | **Chosen**         | Coerente con `dev`/`build` già su Turbo; cache content-addressed velocissima; orchestrazione parallela quando ci saranno N workspace; segnale chiaro per il developer (`>>> FULL TURBO` su cache hit)                                                                                                                                                               |
| (b) | `pnpm -r typecheck` step CI dedicato           | Rejected           | Funziona ma overhead manutenzione (lo step CI diverge dallo script root). Niente cache fra esecuzioni locali. Non sfrutta Turbo già nel monorepo.                                                                                                                                                                                                                   |
| (c) | TS Project References nel root `tsconfig.json` | Rejected (per ora) | Pattern canonico TS per monorepo, ottimo per build incrementale. Costo setup: ogni workspace deve dichiarare `composite: true`, output `dist/`, `references` esplicite. Beneficio reale appare con 5+ workspace o quando il typecheck cross-package supera i 10-15s. **Da rivalutare** quando arriveranno NestJS + Next.js + ui + shared (almeno 4-5 workspace TS). |
| (d) | Lasciare il gap, scoprire errori a runtime     | Rejected           | Anti-pattern; il valore del typecheck è prevenire bug prima del runtime; CI silente è peggio di niente CI.                                                                                                                                                                                                                                                          |

## Consequences

### Positive

- **CI valida tutti i workspace TS**: gap chiuso, regression silente prevenuta dal merge
- **Cache Turbo locale velocissima**: 1.1s cache miss / 54ms cache hit su `@gestionale/db` (21× speedup). Quando il workspace count crescerà, parallelismo Turbo si attiva
- **Zero changes alla CI**: il workflow `ci.yml` esegue `pnpm typecheck` senza modifiche, propaga via Turbo automaticamente
- **Pattern scalabile**: nuovi workspace TS → aggiungono script `typecheck` al loro `package.json` → automaticamente inclusi nello scope senza altre modifiche
- **Coerenza con il resto del monorepo**: `pnpm dev`, `pnpm build`, ora `pnpm typecheck` usano tutti Turbo come orchestratore

### Negative / Trade-off

- **Dipendenza esplicita da Turbo per il typecheck**: già nel monorepo come devDep, accettato. Reversibility: `turbo run typecheck` → `pnpm -r typecheck` è 1 riga
- **Niente cache Turbo in CI** (oggi): il workflow GitHub Actions cacha solo lo store pnpm via `actions/setup-node@v4 cache: pnpm`, non `.turbo/`. CI esegue sempre cache miss. **Non un problema oggi** (~30s totali CI), follow-up tracciato in PROGRESS per quando diventerà bottleneck
- **Telemetria Turbo attiva di default**: prima invocazione mostra avviso. Niente azione (preferenza personale, non di progetto)

### Neutral

- **Root `tsc --noEmit` non più invocato direttamente**: il root `tsconfig.json` solution-style resta come "hub" per future TS Project References (opzione c rimandata). Non viene più typechecked direttamente, ma resta consistente con la sua natura solution-only.
- **`turbo.json` task `typecheck` senza `dependsOn`**: rimosso `["^build"]` (no build step esiste). Quando arriverà un workspace con build, valuteremo se reintrodurre `dependsOn: ["^build"]` o gestire dependencies cross-workspace via TS Project References.

## Reversibility

| Scenario                                         | Costo                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ritorno a `pnpm -r typecheck` (opzione b)        | Trivial — 1 riga in `package.json` root                                                                                                                                       |
| Ritorno a `tsc --noEmit` per-package senza Turbo | Trivial — 1 riga in `package.json` root, ma perdi parallelismo                                                                                                                |
| Migrazione a TS Project References (opzione c)   | Significativa — composite: true + references in ogni workspace tsconfig, outDir/declarationDir, `tsc --build`. Vale la pena solo se il typecheck cross-package diventa lento. |

## Test di validazione (failure injection)

Eseguito durante implementazione, conferma che la propagation funziona:

| Scenario             | Comando                                       | Atteso                                                  | Effettivo                                                                          |
| -------------------- | --------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Cache miss vuoto     | `pnpm typecheck` (1ª esecuzione)              | Esegue `tsc` su `packages/db`, esito OK, ~1s            | ✅ 1.136s, hash `23e2d6404c6783a9`                                                 |
| Cache hit vuoto      | `pnpm typecheck` (2ª esecuzione)              | Cache hit, `>>> FULL TURBO`                             | ✅ 54ms, stesso hash                                                               |
| Errore TS introdotto | `const x: string = 123;` poi `pnpm typecheck` | Cache miss (file cambiato), `tsc` rileva TS2322, exit 2 | ✅ 1.52s, exit 2, error `TS2322: Type 'number' is not assignable to type 'string'` |
| Cleanup              | Rimosso errore, `pnpm typecheck`              | Cache hit con hash precedente, exit 0                   | ✅ 48ms, hash `23e2d6404c6783a9` ripristinato                                      |

L'identità degli hash prima/dopo l'errore conferma che il file è stato ripristinato byte-identico (Turbo cache content-addressed).

## Notes

- Versione Turbo installata: `turbo@2.9.12` (dal `package.json` root devDeps)
- Workspace nello scope oggi: solo `@gestionale/db`. Auto-incluso quando arriverà `apps/api` (NestJS, prossimo macro-task)
- Pattern verificato sul Bash tool dell'AI Claude Code; in shell interattiva Mac di Nicolò il comportamento è identico (entrambi usano Node 20.18.1 via nvm)
- Anti-feature: NON eseguire `turbo run typecheck --force` di default (ricalcola tutto sempre, perde il valore della cache). Da usare solo per debug Turbo
