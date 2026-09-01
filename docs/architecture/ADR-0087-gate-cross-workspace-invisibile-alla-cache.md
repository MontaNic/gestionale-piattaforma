# ADR-0087 — Un gate che legge fuori dal proprio workspace è invisibile alla cache di turbo

**Stato**: Accettato
**Data**: 2026-09-01
**Contesto d'origine**: PR2 della rimozione del verticale restaurant (`chore/remove-restaurant-pr2-apps`)
**Correlati**: [ADR-0083](ADR-0083-design-system-token-seam.md) (seam e gate di contrasto), [ADR-0006](ADR-0006-typecheck-monorepo.md) (turbo nel monorepo), [ADR-0063](ADR-0063-tiering-stop-gate.md) (tiering degli STOP)

---

## Contesto

Il gate di contrasto vive in `packages/ui/src/contrast.test.ts`, ma **non legge solo il proprio workspace**. `packages/ui/src/contrast.ts` apre il filesystem due volte fuori dai propri confini:

```ts
// contrast.ts:332 — il foglio di token di un'app consumer
readFileSync(join(root, 'apps', app, 'src', 'app', 'globals.css'), 'utf8');

// contrast.ts:289 — la scansione dei consumer reali dei token
readFileSync(file, 'utf8'); // su file elencati sotto apps/**
```

`turbo.json` dichiara il task `test` con `dependsOn: ["^build"]` e nessun `inputs`. In assenza di `inputs`, turbo hasha **i file del pacchetto stesso** più le `globalDependencies` (`.env`, `tsconfig.base.json`). I fogli di token delle app non sono in nessuno dei due insiemi.

## L'episodio

PR2 cancella `apps/restaurant-api` e `apps/restaurant-web`: 187 file. Il gate di contrasto pinna una coppia `seam restaurant · tinta soffusa dell'accento` con rapporti attesi `16.3 / 13.95`, calcolati proprio su `apps/restaurant-web/src/app/globals.css`. Sparito il foglio, la coppia **non può** più risultare.

Eppure:

```
$ pnpm test
 Tasks:    14 successful, 14 total
Cached:    13 cached, 14 total
```

Verde. E non un verde per caso: l'hash di `@gestionale/ui` non era cambiato — nessun file di `packages/ui` era stato toccato — quindi turbo ha **riprodotto l'output registrato prima della rimozione**, comprese le righe del report che stampavano i rapporti di un foglio ormai inesistente.

Il rosso è comparso solo scavalcando la cache:

```
$ turbo run test --force --continue
 Tasks:    13 successful, 14 total
 Failed:   @gestionale/ui#test
 → token "accent-soft-foreground" assente dal tema   (×3)
```

## Decisione

**Un gate che legge file fuori dal proprio workspace non è coperto dalla cache di turbo, e va trattato come tale finché i suoi input non sono dichiarati.**

Tre conseguenze operative:

1. **Quando il cambiamento è fuori dal workspace del gate** — cancellazione o spostamento di app, rinomina di fogli di token, aggiunta di un consumer — la verifica locale si fa con `turbo run test --force`. Un `pnpm test` verde, in quelle condizioni, non è un'informazione.
2. **`Cached: N` è parte del riepilogo da leggere**, non rumore di fondo. Un `13 cached` su un albero in cui sono spariti 187 file è di per sé il segnale che il verde non riguarda l'albero corrente.
3. **Che la CI non abbia remote cache di turbo è una fortuna, non un presidio.** Oggi in CI ogni job parte a freddo e il rosso si vede subito. Il giorno in cui si attivasse una remote cache — che è una cosa che si fa per andare più veloci, non per cambiare semantica — questo gate inizierebbe a mentire anche lì, in silenzio.

### 🆕 `TD-turbo-cache-gate-cross-workspace` — tier MEDIO, registrato non risolto

La correzione strutturale è dichiarare gli input reali, ad esempio:

```jsonc
"@gestionale/ui#test": {
  "inputs": ["src/**", "../../apps/*/src/app/globals.css"]
}
```

Non applicata qui per due ragioni: PR2 non tocca `packages/`, e la forma giusta va decisa insieme alla lista dei consumer che `contrast.ts` scansiona — un `inputs` che ne copre metà è peggio di nessuno, perché restituisce fiducia senza darne il fondamento. **Registrato, non risolto.**

## Perché vale oltre questo caso

Il valore della cache di turbo è che il suo modello — «l'output dipende dai file del pacchetto» — è vero per la quasi totalità dei task. Il gate di contrasto è deliberatamente l'eccezione: **misura una relazione fra pacchetti**, ed è esattamente ciò che lo rende utile. La stessa proprietà lo rende invisibile all'hashing.

Ne segue che non è un difetto da correggere una volta, ma una **classe**: ogni futuro presidio che verifica una relazione cross-workspace (un contratto fra BE e FE, un catalogo confrontato con i suoi consumer, un gate di token) nasce con lo stesso punto cieco. Il momento in cui riconoscerlo è quando lo si scrive, non quando produce un verde che mente.

## Alternative scartate

- **Spostare il gate in un workspace che "vede tutto"** (root, o un pacchetto `tools`): sposta il problema — la root non ha un task turbo con input dichiarati migliori — e allontana il gate dai token che misura.
- **Disattivare la cache per l'intero task `test`**: paga su ogni pacchetto un costo che serve a uno solo, e la cache di `test` è ciò che rende sopportabile il gate veloce.
- **Fidarsi della CI a freddo**: è il presidio che oggi funziona, ma per una proprietà dell'ambiente (nessuna remote cache) che nessuno ha scelto e che nessuno difende.

## Fuori scope

- La dichiarazione degli `inputs` (il TD sopra).
- La coppia `seam restaurant` orfana, che è la causa del rosso attuale: si chiude in PR3 con la rimozione della dichiarazione.
