# ADR-0004 — Quality gates e branch protection via Husky hook locali

- **Status:** Accepted
- **Date:** 2026-05-12
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** `PROJECT_BRIEF.md` §C5 (sicurezza), §C12 (convenzioni codice/Git), [ADR-0002](./ADR-0002-branching-strategy.md) (branching strategy)

## Context

[ADR-0002](./ADR-0002-branching-strategy.md) ha stabilito GitHub Flow semplificato (`main` + `feature/*`) con **Squash and merge** obbligatorio. La regola "niente push diretti su `main`" è la spina dorsale della disciplina di history pulita.

Per renderla effettiva ci sarebbe la naturale leva server-side: **Branch Protection** o **Rulesets** su GitHub, che rifiuterebbero `push` diretto a `main` a livello del server di hosting, indipendentemente da cosa fa il client.

Verificato durante la sessione 2026-05-11/12: **GitHub Free su repository privato NON enforce Branch Protection né Rulesets**. La UI permette di crearli e marcarli "Active", ma la nota esplicita di GitHub è che le regole "won't be enforced until you upgrade to a Team account" (USD 4/utente/mese alla data di scrittura). I `push` diretti su `main` da locale verrebbero comunque accettati dal server.

Stessa lacuna sul resto del processo qualità:

- Conventional Commits §C12 — solo controllo umano se non automatizzato
- `pnpm format:check` / `pnpm lint` / `pnpm typecheck` — viene fatto in CI **dopo** che il push è già su GitHub, e fallisce loudly ma solo a posteriori
- Refactor/typo/import dimenticato — possibili da committare e pushare senza alcun gate

Il risultato sarebbe affidare la disciplina al solo "buon senso del developer" o ai test CI a valle. Tollerabile, ma evitabile.

## Decision

**Sposto le quality gate e la branch policy lato client tramite Husky 9**, con 3 hook attivi:

1. **`pre-commit`** → `pnpm exec lint-staged`
   - Solo sui file staged (non sul repo intero, deve essere veloce)
   - Auto-fix dove possibile (`eslint --fix`, `prettier --write`)
   - Blocca il commit se restano errori non auto-fixable

2. **`commit-msg`** → `pnpm exec commitlint --edit "$1"`
   - Valida il messaggio contro `@commitlint/config-conventional`
   - Whitelist di 11 tipi (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`)
   - `subject-case` disabilitato (l'italiano spesso capitalizza la prima lettera del subject, non vogliamo combatterlo)
   - `header-max-length: 100` (limite ragionevole)

3. **`pre-push`** → script shell custom
   - Se la branch corrente è `main`, abort con `exit 1` e messaggio guida con link a questo ADR
   - Compensa la mancata enforcement server-side per il caso più importante (push diretto a `main`)
   - Bypassabile via `git push --no-verify` per emergenze documentate

Husky 9 attiva gli hook impostando `core.hooksPath = .husky/_` (cartella metadata) che fa proxy verso gli script in `.husky/<hookname>`. La cartella metadata è gitignorata internamente da Husky; gli script utente vivono in `.husky/` e sono committati.

L'installazione è automatica via `"prepare": "husky"` in `package.json` scripts: eseguito da `pnpm install` su clone fresco, configura i hook senza azioni manuali.

## Hardening PATH per ambienti non-interactive

Gli hook `pre-commit` e `commit-msg` invocano `pnpm`, che vive sotto `~/.nvm/versions/node/<v>/bin/` (gestito da nvm + corepack — vedi PROGRESS.md, sezione "Sistema base"). Quando git esegue un hook, eredita il PATH del processo che ha invocato `git`. Se quel processo è una **shell interattiva** (Terminal.app, iTerm, VS Code Integrated Terminal, ecc.), `~/.bashrc` o `~/.zshrc` ha già caricato nvm e `pnpm` è nel PATH. Tutto funziona.

Quando però `git` viene invocato da un ambiente **non-interactive** (GUI client come GitHub Desktop, Tower, Fork, GitKraken; pannello Source Control di alcuni IDE; script automatici; alcuni runner CI minimali), il PATH può non avere `~/.nvm/.../bin` e il hook fallisce con `pnpm: not found` (exit 127). Rilevato empiricamente durante la sessione 2026-05-12 dal Bash tool dell'AI Claude Code che esegue senza `.bashrc`.

**Fix applicato**: i due hook che usano `pnpm` (`pre-commit`, `commit-msg`) caricano `nvm` autonomamente nelle prime righe:

```sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

Il check `[ -s "$NVM_DIR/nvm.sh" ]` rende il sourcing condizionale: se nvm non è installato (es. sviluppatore futuro che usa fnm/asdf/volta o pnpm installato globalmente diversamente), il hook prosegue senza errori e si affida al PATH già presente. Approccio **defensivo, non invasivo**.

Il `pre-push` hook **non** ha bisogno di hardening: contiene solo builtin shell (`git symbolic-ref`, `sed`, `[`, `echo`, `exit`), tutti garantiti dal PATH POSIX minimo.

## Consequences

### Positive

- **Catch errori prima del push** — i tre hook intercettano stile, sintassi e branch policy nella shell del developer, prima ancora che parta una richiesta di rete.
- **Conventional Commits effettivamente imposti** — non si committano più messaggi tipo "fix stuff" anche per sbaglio.
- **`main` protetto a tutti gli effetti pratici** — il push diretto fallisce. Anche `--dry-run` triggera l'hook.
- **Coerente con il workflow ADR-0002** — la regola "ogni cambio passa per PR" diventa una proprietà tecnica, non solo un'intenzione.
- **CI resta come second line of defense** — il pre-commit fa la stessa logica del `format:check`/`lint`/`typecheck` ma sui soli file staged; la CI continua a girare su tutto il repo come ultimo gate.

### Negative / Trade-off

- **Bypassabili con `git push --no-verify`** — un developer determinato può aggirare il pre-push. Accettabile perché il bypass è esplicito, lascia traccia nella shell history, e l'uso anomalo si nota immediatamente in code review post-merge.
- **Devono essere installati su ogni clone** — la disciplina del `"prepare": "husky"` script in `package.json` lo automatizza, ma resta un punto di rottura se qualcuno fa `pnpm install --ignore-scripts` o usa un package manager diverso.
- **Lieve overhead a ogni commit** — `lint-staged` su pochi file è veloce (~1-3s), `commitlint` istantaneo, `pre-push` shell script trascurabile. Nessun impatto pratico sul flow.
- **Doppio lavoro con la CI** — la CI rieseguirà lint/typecheck/format sul repo intero ad ogni push. Voluto: la CI controlla anche cose che il pre-commit non vede (es. tsc cross-package), e gira in ambiente pulito.

### Neutral

- **Ruleset GitHub "Protect main"** è stato comunque creato e lasciato Active come documentazione dell'intent. Se il progetto passerà a Team account in futuro, sarà già configurato e si attiverà automaticamente, rendendo il pre-push hook ridondante (ma non dannoso — può restare come belt-and-suspenders).
- **`prepare: husky`** viene eseguito anche in CI durante `pnpm install --frozen-lockfile`. Husky 9 lo gestisce gracefully: in CI installa solo i file metadata in `.husky/_/`, senza side effect dannosi.

## Considered Alternatives

### 1. Upgrade GitHub Team account (~USD 4/mese/utente)

- ✅ Enforcement server-side autentico, impossibile da bypassare lato client
- ✅ Status check obbligatori (CI verde richiesto prima del merge)
- ❌ Costo non giustificato per progetto solo-dev di apprendimento
- ✅ Reversibile in qualsiasi momento — quando il progetto crescerà, l'upgrade è un click

### 2. Nessuna protezione (affidarsi al buon senso + CI)

- ✅ Setup zero, nessuna config
- ❌ Conventional Commits non garantiti
- ❌ Stile/lint solo a posteriori via CI red — su `main` resta lo storico inquinato finché non si forza un revert
- ❌ Push diretto a `main` è permesso, ADR-0002 diventa una promessa scritta ma non tecnica

### 3. Solo CI come gate (skip Husky)

- ✅ Single source of truth (la CI è già verificata)
- ❌ Errori finiscono comunque su `main` se la CI non c'è (es. niente CI sul push di un branch nuovo finché non si apre PR)
- ❌ Loop "push → CI red → fix → re-push" è più lento del catch locale

### 4. Husky con solo `pre-commit` (senza `commit-msg` e `pre-push`)

- ✅ Minimal viable: lo stile è coperto
- ❌ Niente enforcement Conventional Commits
- ❌ Niente protezione `main` lato client
- → la metà del valore con quasi tutto il costo

### 5. Pre-commit framework (Python-based, alternativa a Husky)

- ✅ Più generico, ottimo per repository poliglotti
- ❌ Dipendenza Python extra in un monorepo TypeScript-puro
- ❌ Husky è lo standard de facto per ecosistema JS/TS

## Reversibility

Se in futuro vogliamo rimuovere gli hook locali (es. perché abbiamo passato a Team account e l'enforcement è server-side):

1. `pnpm remove husky lint-staged @commitlint/cli @commitlint/config-conventional`
2. Rimuovere `"prepare": "husky"` da `package.json` scripts
3. Eliminare `.husky/`, `.lintstagedrc.json`, `commitlint.config.cjs`
4. Aggiornare/superare questo ADR

Operazione meccanica, reversibile.

## Notes

- Versioni installate il 2026-05-12: `husky@9.1.7`, `lint-staged@17.0.4`, `@commitlint/cli@21.0.0`, `@commitlint/config-conventional@21.0.0`.
- Il messaggio dell'hook `pre-push` rimanda esplicitamente a questo ADR — chi incappa nel blocco ha il razionale completo a portata di mano.
- Il file di config commitlint è `commitlint.config.cjs` (non `.js`) perché `package.json` ha `"type": "module"` e un `.js` verrebbe caricato come ESM, incompatibile con `module.exports = ...`.
- I 3 hook hanno permessi `755` (rwxr-xr-x). Husky 9 li imposta automaticamente; verificato manualmente post-creazione.
- Hardening PATH (vedi sezione dedicata) aggiunto contestualmente al primo deploy del setup, dopo aver osservato il fallimento `pnpm: not found` in ambiente non-interactive durante i test della sessione 2026-05-12.
