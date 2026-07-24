# ADR-0080 — Seed fail-closed su `NODE_ENV`

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0079](./ADR-0079-storage-persistente-provenienza-immagini.md) (stesso preflight S19), ADR sub-A `assert-safe-db-target` (guard sul target DB), [ADR-0064](./ADR-0064-seed-utente-per-ruolo-food-fe5.md) (TD-dev-env-punta-prod)

## Context

Secondo prerequisito alla finestra di deploy S19, dopo lo storage persistente di ADR-0079.

Il seed decideva il proprio comportamento su una sola condizione:

```ts
if (process.env.NODE_ENV !== 'production') {
  // crea i tenant dev demo/acme con utenti e password note
}
```

`NODE_ENV` **non è presente in `.env`**, e lo script che invoca il seed non la forzava:

```json
"db:seed": "ALLOW_PROD_DB_ACCESS=1 dotenv -e ../../.env -- prisma db seed"
```

Con la variabile assente, `undefined !== 'production'` è vero: il seed entra nel ramo **dev** e fa upsert dei tenant `demo` e `acme` con utenti e password note (`Admin123!`, `Manager123!`). Quei due tenant **esistono già sul DB di produzione** — cosa che suggerisce che questo sia già accaduto in passato. Trattandosi di `upsert`, una riesecuzione **riporterebbe quelle password ai valori di default**.

Il presidio era: _l'operatore si ricorda di passare `NODE_ENV=production`_. È la stessa forma di presidio — dipendente dalla memoria di chi digita — già trovata e meccanizzata in `GIT_SHA` (ADR-0079) e in `assert-safe-db-target`.

## Decisioni

### D1 — Guard come funzione pura

`assertValidNodeEnv` in `packages/db/src/assert-valid-node-env.ts`, stessa forma di `assertSafeDbTarget`: nessuna lettura di `process.env` dentro la funzione, input esplicito, throw con messaggio azionabile. Il call site legge l'ambiente e passa il valore. Interamente testabile senza DB.

### D2 — Nessun default, set chiuso

`NODE_ENV` deve valere **esattamente** uno fra `production`, `development`, `test`. Qualunque altro valore, **inclusa l'assenza**, aborta.

Il confronto è esatto e case-sensitive: `prod`, `Production` e `staging` sono errori, non sinonimi da indovinare. Un fail-closed che accetta abbreviazioni plausibili rientra dalla finestra da cui è uscito.

Deliberatamente **non** esiste un default. «Se non è `production` allora è dev» è precisamente la logica che ha creato il problema.

### D3 — Abort prima di istanziare il client Prisma

Non solo prima di qualunque query: prima che il client esista.

Il vincolo ha una conseguenza non ovvia. `packages/db` è ESM (`"type": "module"`) e `seed.ts` importa il singleton `prisma` da `../src/index`, dove è istanziato **eager** alla valutazione del modulo:

```ts
export const prisma: ExtendedPrismaClient = createPrismaClient(); // index.ts:73
```

Gli `import` in ESM sono **hoisted**: una statement scritta in cima a `seed.ts` girerebbe _dopo_ che `../src/index` è stato valutato, quindi dopo che il client esiste. I moduli importati sono invece valutati **nell'ordine di dichiarazione**.

Da qui `prisma/seed-preflight.ts`, modulo side-effect che è il **primo import** di `seed.ts`. Importa direttamente `../src/assert-valid-node-env`, **non** il barrel `../src/index`, che istanzierebbe proprio ciò che vogliamo precedere. L'ordine di quell'import _è_ il presidio: spostarlo sotto lo disattiva. Il commento sul call site lo dice esplicitamente.

### D4 — Il messaggio nomina i due gesti corretti

```
FATAL: NODE_ENV=(non impostata) non ammessa per il seed. Valori ammessi: production, development, test.
Il seed NON assume un default: senza un valore esplicito non puo' sapere se creare i tenant
dev (demo/acme, password note) o saltarli.
  sviluppo:   pnpm --filter @gestionale/db db:seed        (NODE_ENV=development)
  produzione: pnpm --filter @gestionale/db db:seed:prod   (NODE_ENV=production)
```

Stesso principio del messaggio `GIT_SHA` di ADR-0079: chi lo legge deve sapere **cosa digitare**, non solo cosa è andato storto.

### D5 — Script asimmetrici sul flag `ALLOW_PROD_DB_ACCESS`

| Script         | `NODE_ENV`    | `ALLOW_PROD_DB_ACCESS`                    |
| -------------- | ------------- | ----------------------------------------- |
| `db:seed`      | `development` | **no**                                    |
| `db:seed:prod` | `production`  | **sì**                                    |
| `devdb:seed`   | `development` | no (target `:55432`, il guard non matcha) |

Il seed di sviluppo non ha motivo di disattivare il guard sul target DB: lo faceva, ed era un indebolimento gratuito.

**Conseguenza deliberata**: `db:seed` non può più colpire il DB di produzione. Con `NODE_ENV=development` e senza il flag, `assertSafeDbTarget` aborta su `{127.0.0.1|localhost}:5432/gestionale`. Chi lavora in locale su un DB che si chiama letteralmente così deve passare dal flusso `devdb:*`. È l'irrigidimento voluto, non un effetto collaterale — ma va detto che **`README.md` documenta ancora `db:seed` come passo del setup locale**: la riga andrà allineata (fuori dallo split di questa PR, vedi _Consequences_).

### D6 — Il ramo dev è condizionato in positivo

`allowsDevData(env)` ritorna `true` solo per `development` e `test`. Entrambe le occorrenze di `process.env.NODE_ENV !== 'production'` in `seed.ts` (righe 1967 e 2110 del file pre-modifica) sono sostituite, e in `seed.ts` non resta **nessuna** lettura di `process.env.NODE_ENV`: ogni decisione passa da `SEED_NODE_ENV`, già validato. `seedDevTenant` non è raggiungibile con `NODE_ENV=production`.

## Sub-DP risolto empiricamente

**`db:seed` ha un consumatore**: `.github/workflows/ci.yml:241` (`Seed database (tenant demo + acme)`). Quindi **non è stato rinominato**: `db:seed` resta, con `NODE_ENV=development` esplicito, e `db:seed:prod` si aggiunge accanto. Rompere la CI dentro una PR di sicurezza sarebbe il modo peggiore di introdurla.

Verificato inoltre, leggendo `ci.yml` e non assumendolo, che togliere `ALLOW_PROD_DB_ACCESS` da `db:seed` **non rompe la CI**: il suo `DATABASE_URL` è `postgres:5432/gestionale_test` — host `postgres` (service name, non `127.0.0.1`/`localhost`) e database `gestionale_test` (non `gestionale`). Due mismatch su tre condizioni: `assertSafeDbTarget` non scatta.

La CI non imposta `NODE_ENV` da nessuna parte, quindi senza l'assegnazione inline nello script il guard l'avrebbe fatta fallire.

## GATE

Vincolo su tutti i GATE: **solo DB dev `:55432`**. Nessun comando di questa PR ha puntato a `5432`.

**G1 — test unitari.** 11 test nuovi, tutti verdi: assente → throw · `''` → throw · `production`/`development`/`test` → ok e ritornati · `prod` → throw · `Production` → throw · `staging` → throw · il messaggio contiene entrambi i comandi. Più `allowsDevData` su tutti e tre i valori.

**G2 — prova d'efficacia runtime.** Seed invocato **senza** `NODE_ENV` contro il DB dev:

- `exit=1`, con il messaggio di D4;
- stack trace che ancora l'abort a `seed-preflight.ts:31`, cioè durante la valutazione del **primo import**, prima del corpo di `seed.ts`;
- sul DB, contatori **cumulativi** `pg_stat_database`: `tup_inserted` delta **0**, `tup_updated` delta **0**. Non è uno snapshot di `pg_stat_activity` (che una connessione aperta e chiusa nell'istante sbagliato mancherebbe): sono contatori monotoni, e a zero significano che **nessuna query è stata eseguita**, non solo che nessuna scrittura è avvenuta;
- conteggi `tenants`/`users` invariati; nessun client applicativo connesso.

**G3 — percorso legittimo intatto.** `devdb:seed` contro il DB dev: `exit=0`, ramo `Dev data (NODE_ENV=development)`, riepilogo completo, conteggi invariati alla riesecuzione (idempotenza preservata).

**G4 — controllo negativo.** Sul codice **pre-fix**, la stessa invocazione senza `NODE_ENV` completava con `exit=0` ed entrava nel ramo dev (`Dev data (NODE_ENV != "production")`), eseguendo gli upsert. È la dimostrazione che è questo fix a chiudere il buco, non una proprietà preesistente.

**G5 — anti-regressione.** Baseline pre-fix registrata a tree pulito: typecheck 16/16, lint pulito, test 15/15. Riconfermata dopo: 16/16, lint pulito, 15/15 (23 test nel package `db`, da 12), `format:check` pulito.

**G6 — impatto sull'altro verticale: verificato.** `packages/db` è condiviso da entrambi i verticali, quindi la dichiarazione non può essere `N.A.` Il guard vive però su un percorso che **solo il seed attraversa**: `assertValidNodeEnv` è invocata unicamente da `seed-preflight.ts`, importato unicamente da `seed.ts`. Nessun runtime applicativo — né `accountant-api` né `restaurant-api` — lo attraversa, e nessuno dei due legge `NODE_ENV` per decidere comportamento di dominio. La suite completa di entrambi i verticali è verde (restaurant-api 84 test, accountant-api 46). Nessuna modifica a schema, migrazioni, permessi o runtime.

## Consequences

**Positive**

- Un seed senza `NODE_ENV` esplicito non è più possibile: aborta prima di istanziare il client.
- Il ramo dev non è più raggiungibile per esclusione: richiede `development` o `test` dichiarati.
- `db:seed` non può più colpire il DB di produzione in nessuna circostanza.
- Il percorso prod esiste, è nominato, ed è distinto da quello di sviluppo: `db:seed:prod`.

**Negative / da presidiare**

- **`README.md` è disallineato**: documenta `pnpm --filter @gestionale/db db:seed` come passo del setup locale, che ora aborta se il DB locale è `localhost:5432/gestionale`. La riga va aggiornata verso il flusso `devdb:*`. Fuori dallo split di questa PR (che tocca guard, script e ADR), da fare nel PR docs di chiusura insieme al runbook di deploy.
- Un quarto ambiente futuro (`staging`) richiederà di estendere `SEED_ENVS` esplicitamente. È il costo del set chiuso, ed è il costo giusto: l'alternativa è tornare a indovinare.
- Il presidio di D3 è l'**ordine di un import**. È documentato nel file e nel commento al call site, ma resta una proprietà che un riordino automatico degli import potrebbe rompere silenziosamente. Oggi `eslint` non riordina (verificato: lint verde con l'import in testa), ma è il punto fragile di questa soluzione.
