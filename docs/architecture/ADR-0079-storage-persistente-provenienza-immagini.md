# ADR-0079 — Storage persistente su volume dedicato + provenienza delle immagini

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0043](./ADR-0043-comunicazioni-module.md) (nascita di `StorageService`), [ADR-0044](./ADR-0044-documenti-module.md) (secondo consumatore), [ADR-0075](./ADR-0075-note-spese-pr2-crud-storage.md) (Note Spese allegati), [ADR-0042](./ADR-0042-domains-resolver-colocated-hosts.md) (app dietro il proxy), [ADR-0041](./ADR-0041-acme-wildcard-cloudflare.md) (compose di produzione)

## Context

Preflight della finestra di deploy S19 (`main` @ `490fb6e`, codice = `b8fa054`). Due difetti infrastrutturali emersi dalla ricognizione, entrambi indipendenti dal codice applicativo e quindi da chiudere **prima** del deploy.

### 1. Lo storage degli allegati non sopravvive al recreate

`LocalFilesystemStorageService` risolve la root come:

```ts
config.get<string>('STORAGE_LOCAL_ROOT') ?? join(process.cwd(), 'var', 'storage');
```

`STORAGE_LOCAL_ROOT` non era valorizzata **da nessuna parte** — né in `.env`, né in `docker-compose.prod.yml` — e nessun servizio applicativo dichiarava `volumes:`. La root effettiva in produzione era quindi `/app/apps/accountant-api/var/storage` (il `WORKDIR` del runner stage), cioè **il layer scrivibile del container**, che Docker distrugge a ogni recreate.

Non è un rischio teorico: è **già accaduto**. Su produzione una riga `documenti` e tre `comunicazioni` referenziano `storage_key` i cui blob non esistono più sul filesystem, persi nel recreate del 10/07:

```
$ docker exec gestionale-accountant-api-1 ls -la /app/apps/accountant-api/var
ls: /app/apps/accountant-api/var: No such file or directory

$ psql -c "SELECT storage_key FROM documenti LIMIT 5;"
019ea438-a501-764d-aa5a-2f435affdb5f/019ef5aa-643d-73f4-9321-9dd2eed88e8f.txt
```

La condizione è **preesistente**, non introdotta da Note Spese. Ma Note Spese la porta da difetto latente a difetto strutturale: il giustificativo è il cuore della feature e, una volta in produzione, diventa **dato fiscale non ricostruibile**.

### 2. Le immagini non dichiarano da quale commit nascono

`docker inspect` sui quattro container di produzione mostrava **solo** le label `com.docker.compose.*`. Nessuna label con il SHA git. L'unica provenienza ricostruibile passava da una convenzione di tagging manuale (`portata-167cb3d`) applicata alle immagini restaurant e **mai** a quelle accountant: le due immagini accountant in esercizio non sono riconducibili ad alcun commit se non per data di build.

## Decisioni

### D1 — Root dello storage fuori dall'albero applicativo

`STORAGE_LOCAL_ROOT=/var/lib/gestionale/storage`. Deliberatamente **non** un path sotto `/app`: il mount point non deve dipendere dal layout del monorepo dentro l'immagine, che è un dettaglio del Dockerfile e può cambiare.

### D2 — Named volume, non bind mount

Volume `gestionale_storage_data`, dichiarato nella sezione `volumes:` top-level di `docker-compose.prod.yml`. Il named volume eredita ownership e contenuto dalla directory presente nell'immagine alla prima creazione, evitando la classe di problemi uid/gid dei bind mount.

**Nota sul naming**: la chiave nel compose è `storage_data`, non `gestionale_storage_data`. Compose prefissa col nome progetto, quindi `storage_data` → volume reale `gestionale_storage_data`, esattamente il pattern già in uso (`postgres_data` → `gestionale_postgres_data`). Scrivere la chiave già prefissata avrebbe prodotto `gestionale_gestionale_storage_data`.

Il backup dei blob è un fronte separato (vedi `TD-storage-backup-blob`), non un motivo per preferire il bind mount adesso.

### D3 — Directory creata nel Dockerfile, **senza `chown`**

```dockerfile
RUN mkdir -p /var/lib/gestionale/storage
```

Il `mkdir` è ciò che dà al named volume la directory da cui ereditare ownership e contenuto: senza, D2 non funzionerebbe.

Il `chown` che il piano iniziale prevedeva **è stato rimosso**, perché la premessa su cui poggiava è falsa. La verifica empirica:

```
$ grep -rn "USER" apps/*/Dockerfile
  → nessuna direttiva USER in nessuno dei quattro

$ docker exec gestionale-accountant-api-1 id
uid=0(root) gid=0(root) ...
```

**Tutti e quattro i runner stage girano come root**: nessun `USER`, nessun `adduser`, benché la base `node:22-alpine` fornisca un utente `node` (uid 1000) pronto all'uso. Non esiste quindi un utente da accontentare, e l'unico valore letterale coerente sarebbe stato `chown -R root:root` — un **no-op**. Scriverlo comunque sarebbe stato peggio che ometterlo: comunica al lettore un de-privilegio che non esiste, in un file che si tocca proprio per irrobustire la produzione. Vedi `TD-container-runs-as-root`.

### D4 — Valore letterale nel compose, non da `.env`

`STORAGE_LOCAL_ROOT: /var/lib/gestionale/storage` è scritto direttamente in `docker-compose.prod.yml`, **non** come `${STORAGE_LOCAL_ROOT:?}`. È un path interno al container, non un segreto: non deve dipendere da una riga che qualcuno deve ricordarsi di aggiungere al `.env` dell'host. Un presidio in meno affidato alla memoria dell'operatore.

### D5 — `.env.example` documenta la variabile per il dev su host

Con il default attuale (`<cwd>/var/storage`) come commento, e la riga commentata. **Nessun cambiamento di comportamento per lo sviluppo**: chi lavora su host continua a scrivere dove scriveva prima.

### D6 — Provenienza via build-arg, fail-closed in produzione

Nei quattro Dockerfile, nel runner stage:

```dockerfile
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA
LABEL org.opencontainers.image.source=https://github.com/MontaNic/gestionale-piattaforma
```

In `docker-compose.prod.yml`, su tutti e quattro i servizi:

```yaml
build:
  args:
    GIT_SHA: '${GIT_SHA:?GIT_SHA non impostata. Per build e deploy: esporta GIT_SHA con git rev-parse HEAD. Per i soli comandi di lettura (ps, logs, config): basta GIT_SHA=unknown}'
```

Un build di produzione senza SHA **aborta prima di costruire il primo layer**, stessa forma di `${DATABASE_URL_DOCKER:?…}` già in uso. Il messaggio non parla solo di build perché il raggio del presidio è più ampio: vedi la sezione _Operatività_ sotto.

**Due scostamenti dal piano, entrambi imposti dai fatti:**

1. Il piano prevedeva anche `${GIT_SHA:-unknown}` in `docker-compose.dev.yml`. Quel file **non builda le app**: contiene solo `postgres`, `redis`, `caddy`, `mailpit`. I quattro servizi applicativi esistono unicamente in `docker-compose.prod.yml`. La variante permissiva non ha quindi un compose in cui vivere, e viene realizzata come **default dell'`ARG`** (`ARG GIT_SHA=unknown`), che copre i build diretti lanciati fuori dal compose di produzione. Il fail-closed di prod resta intatto: l'interpolazione compose fallisce prima che il default entri in gioco.

2. Il messaggio d'errore **non contiene `$(git rev-parse HEAD)`**: la sostituzione di comando non è gestita dall'interpolazione compose, quindi il comando è citato in chiaro (`git rev-parse HEAD`) come testo che l'operatore ricopia.

   I due punti, invece, sono ammessi — ma solo perché **l'intero valore è single-quoted**. La prima stesura lasciava il valore non quotato e il parsing YAML si rompeva a `L63.C48` con `mapping values are not allowed in this context`, perché un `: ` dentro uno scalare nudo lo fa interpretare come mapping. Quotando, i `:` tornano disponibili e il messaggio può usare la punteggiatura naturale invece dei trattini — verificato empiricamente, non assunto.

### D7 — Nessun `request_body` in Caddy

Il default Caddy è senza limite di dimensione del corpo, quindi i 20 MB di `STORAGE_MAX_UPLOAD_BYTES` passano. Fuori scope.

### Superficie: solo `accountant-api`

Verificato empiricamente che `restaurant-api` **non** usa lo storage:

```
$ grep -rn "StorageModule\|StorageService" apps/restaurant-api/src/ --include="*.ts" | grep -v .spec.
[nessun risultato]
```

I due file che comparivano in una ricerca larga per `Storage` sono falsi positivi, entrambi commenti: `AsyncLocalStorage` in `app.module.ts:64` e `localStorage` in `main.ts:21`. Gli unici consumatori di `StorageModule` sono tre moduli accountant-api: `note-spese`, `comunicazioni`, `documenti`.

→ Il volume va sul **solo** `accountant-api`. Le label D6 su tutti e quattro (la provenienza serve a ogni immagine).

## GATE — prove di efficacia

Il verde statico non prova nulla qui: compose e Dockerfile non sono coperti da test. Tutto eseguito contro il **DB dev isolato** (`gestionale_postgres_dev`, `:55432`), in uno stack effimero con project name dedicato (`g1-gate`) e immagine taggata `:g1-test` — mai il compose di produzione, mai il tag `latest`, mai il DB di produzione.

**G1 — persistenza attraverso il recreate.** Upload di un allegato → `--force-recreate` (container ID da `73cde2aacf35` a `d4ffbdc74acc`, quindi ricreato davvero) → download: **HTTP 200**, file **byte-identico** (`md5 06d56b8cd269…` su entrambi i lati, `cmp` pulito).

**Controllo negativo** — perché G1 da solo dimostrerebbe solo che "funziona", non che è il fix a farlo funzionare. Stessa immagine, configurata come la produzione **attuale** (nessun `STORAGE_LOCAL_ROOT`, nessun volume):

- il blob finisce in `/app/apps/accountant-api/var/storage/…` (layer scrivibile);
- download **prima** del recreate: HTTP 200;
- download **dopo** il recreate: **HTTP 500**, con la riga DB **ancora presente** (`count = 1`).

È la riproduzione esatta della condizione osservata in produzione: righe che sopravvivono, blob che spariscono.

**G2 — scrittura effettiva nel volume.** `docker inspect` mostra il named volume montato su `/var/lib/gestionale/storage`; il blob è presente sotto il path tenant-scoped; l'uid del processo è `0(root)`; probe di `touch` + `rm` dentro la root: **OK** (non solo esistenza della directory, ma scrittura reale con l'uid effettivo).

**G3 — label presente.** `org.opencontainers.image.revision` = `a9d79919cd8c…`, coincidente con `git rev-parse HEAD`.

**G4 — fail-closed del build arg.** `docker compose … build accountant-api` **senza** `GIT_SHA` in ambiente:

```
error while interpolating services.accountant-api.build.args.GIT_SHA:
required variable GIT_SHA is missing a value: build di produzione senza GIT_SHA — …
exit=1
```

Aborta prima di qualunque layer: il presidio è meccanico, non documentale.

**G5 — anti-regressione.** Baseline pre-fix registrata a working tree pulito e riconfermata: typecheck 16/16 task, lint pulito, test 15/15 task (196 unit).

**G6 — impatto sull'altro verticale: verificato.** I Dockerfile toccati sono quattro, quindi la dichiarazione non può essere `N.A.` I tre non-accountant sono stati costruiti con le modifiche applicate; nessun cambiamento di comportamento oltre l'aggiunta delle label. `restaurant-api` non ha volume né `STORAGE_LOCAL_ROOT` perché non usa lo storage (verifica sopra). Nessuna modifica a schema, migrazioni, seed o permessi.

## Operatività

### Il raggio del fail-closed è ogni comando compose, non solo `build`

Compose interpola **l'intero modello al caricamento del file**, non solo quando esegue un build. Un `${GIT_SHA:?}` sotto `build.args` blocca quindi _qualunque_ comando compose contro la produzione — `config`, `ps`, `logs`, `up`, `restart` — incluso il percorso di rollback.

Non è un'inferenza, è misurato. Senza `GIT_SHA` in ambiente:

```
config exit=1
ps     exit=1
logs   exit=1
```

Tutti e tre con lo stesso errore esplicito, che nomina la variabile e il rimedio. È il motivo per cui il messaggio è stato riscritto: comparendo anche su `ps` e `logs`, una formulazione centrata sul solo build manderebbe l'operatore a cercare un build che non ha lanciato.

**Conseguenze pratiche:**

| Situazione                           | Gesto                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Build e deploy                       | `export GIT_SHA=$(git rev-parse HEAD)` — passo obbligatorio del runbook |
| Lettura in emergenza                 | prefisso `GIT_SHA=unknown docker compose …`                             |
| Lettura in emergenza, senza prefissi | **CLI Docker puro**: `docker ps`, `docker logs <container>`             |

L'ultima riga è la più importante alle 23:00: il CLI Docker **non legge il compose file** e funziona identico a prima. Verificato, `exit 0` su entrambi i comandi. La diagnostica d'emergenza non è quindi degradata da questa decisione; l'attrito colpisce i comandi di ciclo di vita, dove un `export` è un gesto naturale perché si è comunque dentro un checkout git.

### Rischio residuo accettato

`GIT_SHA=unknown` è una scorciatoia diagnostica che può diventare memoria muscolare e finire davanti a un `up -d --build`, producendo un'immagine con `revision=unknown` **senza che nulla protesti**.

Deliberatamente **non** mitigato nel Dockerfile: un check che rifiuta `unknown` romperebbe i build diretti fuori compose, che sono esattamente quelli usati nel GATE di questa PR.

_Rimedio corretto_: il runbook di deploy esporta `GIT_SHA` come **passo proprio**, così la scorciatoia non ha occasione di sostituirlo.
_Trigger di riattivazione_: prima immagine di produzione trovata con `revision=unknown`.

### Perché non (B) né (C)

Le due alternative sono state scartate per ragioni di **merito**, non di costo.

**(B) — `${GIT_SHA:-unknown}` nel compose, fail-closed spostato nel Dockerfile.** Con un default sempre presente il Dockerfile riceve comunque un valore e **non può distinguere** un build dev legittimo da un build di produzione in cui l'export è stato dimenticato. Un check `test "$GIT_SHA" != unknown` fallirebbe sempre o mai. Il fail-closed non si sposta: si perde.

**(C) — `build.args` in un overlay dedicato, usato solo in fase di build.** Un `docker compose -f dev -f prod up -d --build` senza overlay costruisce ugualmente, con l'`ARG` al default, producendo proprio l'immagine non tracciabile che il presidio doveva impedire. La garanzia tornerebbe a dipendere dal ricordarsi il quarto file — cioè dalla memoria dell'operatore, che è ciò da cui si voleva uscire.

## Debiti registrati

**`TD-container-runs-as-root`** — i quattro runner stage (`api` e `web`, entrambi i verticali) girano come root: nessun `USER`, nessun `adduser`, benché la base `node:22-alpine` fornisca `node` (uid 1000) pronto. Il de-privilegio richiede `chown -R` su `/app` in immagini da ~1,15 GB (costo in build time e layer size) più verifica runtime che Next standalone scriva le proprie cache — su quattro immagini e due verticali. È un PR autonomo con GATE proprio.
_Trigger di riattivazione_: prossima PR che tocca i runner stage per altri motivi (si coglie l'occasione), **oppure** primo cliente con requisiti contrattuali di sicurezza o audit.

**`TD-storage-backup-blob`** (nuovo) — il `pg_dump` copre il DB, non i blob. Il volume `gestionale_storage_data` non è incluso in alcun backup, e con Note Spese in produzione i giustificativi diventano dato fiscale non ricostruibile. Da notare che oggi **non esiste alcun backup**, nemmeno del DB: il `pg_dump` notturno è ancora solo una voce di piano in `PROJECT_BRIEF.md`.
_Trigger_: primo allegato caricato da un cliente reale.

**`TD-storage-gc`** (esteso) — al debito esistente si aggiunge il caso inverso, ora documentato: righe DB che puntano a blob inesistenti (1 `documenti`, 3 `comunicazioni`, perse nel recreate del 10/07). **Si lasciano in essere**: sono l'evidenza storica del difetto, e ripulirle dentro una finestra di deploy sarebbe scope creep su un DB vivo e senza backup.
_Trigger di riattivazione_: primo reclamo utente su allegato mancante, oppure prima esecuzione di una GC dello storage.

**`TD-dev-processes-orphaned-on-prod-host`** (nuovo) — le sessioni Claude Code lasciano processi dev vivi sull'host di produzione dopo la chiusura. Rilevati in questa sessione: `turbo run dev` orfano da 21 giorni (4× `tsup --watch`, innocuo ma tiene i `dist/` sotto watch e interferisce con i build) e `restaurant-api` dev orfano da 26 ore **in ascolto su `*:3000`**, tutte le interfacce, con `NODE_ENV` non impostato. Entrambi `PPid: 1`, entrambi non notati fino a una ricognizione mirata. Nessun meccanismo li conta o li raccoglie.
**È la quinta failure-mode strutturale**, della stessa famiglia delle quattro di S18: un presidio che oggi dipende dal fatto che qualcuno guardi.
_Direzioni candidate_ (non decise): bind su `127.0.0.1` di default nei dev server invece di `0.0.0.0`; process group per sessione con reaping alla chiusura; check di residui in apertura di sessione.
_Trigger_: prossima sessione che apre un dev server sull'host, **oppure** esito della verifica firewall che confermi raggiungibilità esterna della 3000 — nel qual caso sale di priorità e diventa un fronte suo.

## Consequences

**Positive**

- Gli allegati sopravvivono al recreate: la persistenza è **provata**, non assunta, e il controllo negativo dimostra che è il fix a produrla.
- Note Spese può andare in produzione senza che i giustificativi evaporino al primo redeploy.
- Ogni immagine costruita d'ora in poi dichiara il commit che la origina; il rollback smette di dipendere da una convenzione di tagging manuale applicata a memoria.
- Un build di produzione senza SHA non è più possibile: fallisce prima di partire.

**Negative / da presidiare**

- Un nuovo volume da includere nel backup, che oggi non esiste (`TD-storage-backup-blob`).
- I container continuano a girare come root (`TD-container-runs-as-root`): questo PR non peggiora la situazione, ma la lascia intatta e ora documentata.
- Le quattro righe orfane restano su produzione, di proposito.
- Il primo deploy con questa modifica **non recupera** i blob già persi: il volume nasce vuoto.

**Fuori scope, deliberatamente**

Nessuna migrazione, nessun seed, nessun build o push verso produzione, nessun tag di rollback (appartiene alla finestra di deploy, non a questo PR), nessuna propagazione dei permessi ai ruoli esistenti.
