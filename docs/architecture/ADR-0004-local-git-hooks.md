# ADR-0004 — Quality gates e branch protection via Husky hook locali

- **Status:** Accepted
- **Date:** 2026-05-12
- **Amended:** 2026-07-30 — vedi [Amendment 2026-07-30](#amendment-2026-07-30--loggetto-protetto-è-refsheadsmain). La regola del `pre-push` descritta in Decision §3 è **superata** da quella sezione.
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

## Amendment 2026-07-30 — l'oggetto protetto è `refs/heads/main`

La decisione resta. Cambia l'**oggetto** del blocco `pre-push`, che la formulazione originale (Decision §3: «se la branch corrente è `main`») descriveva più largamente del bene che intende proteggere.

**Regola nuova.** Il `pre-push` blocca **se e solo se** almeno una riga di stdin ha `refs/heads/main` come **remote ref**. La branch corrente è irrilevante: lo script non chiama più `git symbolic-ref`.

Il razionale è invariato ed è quello di [ADR-0002](./ADR-0002-branching-strategy.md) §Consequences: _«History di `main` lineare: ogni commit su `main` corrisponde 1:1 a una PR»_. Ciò che va protetto è `refs/heads/main`, non l'atto di pushare mentre si è su `main`.

### Cosa cambia in concreto

|                                                | prima                                                                 | dopo         |
| ---------------------------------------------- | --------------------------------------------------------------------- | ------------ |
| push di commit su `main`                       | bloccato                                                              | bloccato     |
| force-push su `main`                           | bloccato                                                              | bloccato     |
| **delete di `main`** (`git push origin :main`) | **passava** — si fa da un'altra branch, e l'hook guardava solo `HEAD` | **bloccato** |
| **push di soli tag** (`refs/tags/*`) da `main` | **bloccato** — il difetto che ha originato l'amendment                | passa        |
| **push di un feature branch da `main`**        | **bloccato** (falso positivo)                                         | passa        |
| push di un feature branch da un feature branch | passa                                                                 | passa        |

I due allargamenti sono **voluti e dichiarati**, non effetti collaterali:

- **Tag.** È la causa dell'amendment. `git ls-remote --tags origin` era vuoto — `origin` non ha mai ricevuto un solo tag, dal primo in poi, perché ogni `deploy/*` si crea e si pubblica da `main`. La cronologia dei deploy non era leggibile da git, e gli SHA deployati sopravvivevano solo perché scritti in chiaro in `PROGRESS.md`.
- **Feature branch da `main`.** Un `git push origin feature/x` mentre si è fermi su `main` non tocca `refs/heads/main` e non può inquinarne la history. Bloccarlo era un costo senza contropartita.

### Vincoli di forma dello script

Husky invoca lo script utente con `sh -e` (vedi `.husky/_/h`), quindi `errexit` è attivo:

- **nessun `read` nudo.** A EOF `read` ritorna 1 e, sotto `errexit`, aborta lo script — cioè blocca il push, in silenzio. Solo `while read -r ...; do ... done`, la cui condizione è contesto testato ed è esente. Non è teorico: git invoca il `pre-push` **anche quando non c'è nulla da pushare** (`Everything up-to-date`), con stdin vuoto — verificato;
- **l'`exit 0` finale è obbligatorio.** Senza, l'exit status dello script sarebbe quello dell'ultimo `read`, cioè 1;
- lo script resta POSIX puro e senza dipendenze da `pnpm`/nvm, come da §Hardening.

### Canali di bypass

Due, non uno. Il secondo era assente dalla stesura originale:

- `git push --no-verify` — salta gli hook per quel singolo push;
- `HUSKY=0` nell'ambiente — il runner `.husky/_/h` esce 0 prima di invocare lo script utente, **disattivando tutti e tre gli hook** finché la variabile è impostata.

Ne esiste un terzo, non intenzionale ma già osservato: se `.husky/pre-push` non è presente nel working tree, il runner fa **no-op silenzioso** (`[ ! -f "$s" ] && exit 0`). È il meccanismo dell'incidente del 2026-05-12 (`git stash` degli hook ancora untracked, `PROGRESS.md`) e si riproduce ogni volta che gli hook non esistono sulla branch su cui ci si trova.

### Prova di efficacia

Nove casi, eseguiti in un repo usa-e-getta con remote bare locale, sotto lo stesso runner `sh -e` della produzione e con il file reale sotto test. `git push --dry-run` **esegue** il `pre-push` senza toccare il remote (verificato: 0 ref pubblicati), quindi la matrice è ripetibile a costo zero.

ROSSO atteso e osservato: commit su `main`; force-push su `main`; delete di `main`; misto tag + `main`; misto feature branch + `main` **con `main` non come prima riga di stdin** (git ordina `refs/heads/*` prima di `refs/tags/*`, quindi è questo il caso che prova che il loop non si ferma alla prima riga).

VERDE atteso e osservato: soli tag, annotati e lightweight, da `main`; feature branch da `main`; feature branch da feature branch; stdin vuoto (exit 0, nessun output, nessun aborto da `errexit`).

## Hardening PATH per ambienti non-interactive

Gli hook `pre-commit` e `commit-msg` invocano `pnpm`, che vive sotto `~/.nvm/versions/node/<v>/bin/` (gestito da nvm + corepack — vedi PROGRESS.md, sezione "Sistema base"). Quando git esegue un hook, eredita il PATH del processo che ha invocato `git`. Se quel processo è una **shell interattiva** (Terminal.app, iTerm, VS Code Integrated Terminal, ecc.), `~/.bashrc` o `~/.zshrc` ha già caricato nvm e `pnpm` è nel PATH. Tutto funziona.

Quando però `git` viene invocato da un ambiente **non-interactive** (GUI client come GitHub Desktop, Tower, Fork, GitKraken; pannello Source Control di alcuni IDE; script automatici; alcuni runner CI minimali), il PATH può non avere `~/.nvm/.../bin` e il hook fallisce con `pnpm: not found` (exit 127). Rilevato empiricamente durante la sessione 2026-05-12 dal Bash tool dell'AI Claude Code che esegue senza `.bashrc`.

**Fix applicato**: i due hook che usano `pnpm` (`pre-commit`, `commit-msg`) caricano `nvm` autonomamente nelle prime righe:

```sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

Il check `[ -s "$NVM_DIR/nvm.sh" ]` rende il sourcing condizionale: se nvm non è installato (es. sviluppatore futuro che usa fnm/asdf/volta o pnpm installato globalmente diversamente), il hook prosegue senza errori e si affida al PATH già presente. Approccio **defensivo, non invasivo**.

Il `pre-push` hook **non** ha bisogno di hardening: contiene solo builtin shell (`read`, `[`, `echo`, `exit`), tutti garantiti dal PATH POSIX minimo. Dopo l'amendment 2026-07-30 non invoca nemmeno più `git`.

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
