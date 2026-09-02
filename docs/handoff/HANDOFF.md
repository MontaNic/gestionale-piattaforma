# HANDOFF — gestionale-piattaforma

**Snapshot:** `Main @ d916bd5 (+1 commit docs(handoff) in arrivo via PR)`
**Chiusura sessione 2026-09-02:** **il verticale restaurant è eliminato**. Cinque PR su sei della sequenza di rimozione sono in `main` (#206 → #211), la sesta è deliberatamente rinviata. Resta `accountant` (StudioDesk) come unico verticale, con il suo dominio invariato: mandati, prestazioni, scadenze, note spese, circolari, portale clienti.

---

# PARTE A — Cosa è successo e cosa significa

## Dove siamo

**La decisione.** Il restaurant esce dal prodotto. Una seconda ipotesi — trasformare l'accountant in un **CRM generico** — è stata discussa e **accantonata**, e la ragione va scritta perché la domanda tornerà: un CRM generico compete con incumbent senza differenziazione e ha **zero consumer esattamente come li aveva il restaurant**. È lo stesso Pattern 43 con cui si scarta una feature speculativa. L'unico asset reale è la specificità del dominio: le 67 DDL legacy e il modello mandati/prestazioni non si ricostruiscono in un weekend, un CRM generico sì.

**Nota stato produzione (critica, non dimenticare):** NON ci sono clienti reali né dati di valore in prod. Tutto pre-lancio/demo. Il blast radius ha stakes BASSI ora; "corruzione irrecuperabile" non è uno scenario reale finché non arrivano clienti. La disciplina STOP-gate/test resta utile come abitudine e rete PER QUANDO arriveranno, ma va calibrata sul rischio attuale (basso), non su uno immaginato.

### La sequenza: 5 passi su 6

Criterio: **dal reversibile all'irreversibile**. Ogni passo verifica il precedente prima che il successivo lo renda irrevocabile.

| PR   | Cosa                                                     | SHA       |
| ---- | -------------------------------------------------------- | --------- |
| #206 | CI e infrastruttura                                      | `deb6409` |
| #208 | ADR-0086 emendato + ADR-0087                             | `e445796` |
| #207 | `apps/restaurant-*` — 187 file                           | `d024655` |
| #209 | Design system a un'app sola, ADR-0088 supersede ADR-0083 | `dd94652` |
| #210 | Catalogo permessi e seed                                 | `53556fd` |
| #211 | Riconciliazione DB, ADR-0089                             | `d916bd5` |

**PR6 non è stata fatta**, deliberatamente — vedi Parte B.

### I due rossi aperti di proposito, entrambi chiusi

- **PR2 → PR3** — il gate di contrasto rosso sulla coppia `seam restaurant` orfana. Si è chiuso **con una PR di codice**. Conseguenza da ricordare: con `needs: [checks]` i tre job a valle sono rimasti `skipping` per due merge, quindi **la finestra di attribuzione di un eventuale rosso era larga due merge** — e la regola («se `seed-rls-core` diventa rosso, guarda anche PR2») è stata scritta prima che servisse, non dopo.
- **PR4 → PR5** — il gate permessi rosso perché il codice scendeva a 44 permessi mentre i DB ne avevano 64. **Questo non si chiudeva con codice**: solo con una scrittura su produzione. Una finestra così va tenuta corta, ed è stata chiusa lo stesso giorno.

## Cosa è in `main`

| Blocco                                                                 | PR   | ADR       | Effetto                                       |
| ---------------------------------------------------------------------- | ---- | --------- | --------------------------------------------- |
| CI e infrastruttura — via i 2 job e2e food; nuovo job `seed-rls-core`  | #206 | —         | ri-alloggia `db:seed` + `smoke:rls-core`      |
| `food.studiodesk.cloud` → redirect 301 all'apex                        | #206 | 0042      | **in repo, NON applicata** al proxy           |
| Emendamento rollback point + gate invisibile alla cache                | #208 | 0086/0087 | 3 TD nuovi registrati                         |
| Rimozione `apps/restaurant-api` + `apps/restaurant-web`                | #207 | —         | 187 file, lockfile rigenerato                 |
| Design system a un'app sola — «seam per-verticale» → «livello per-app» | #209 | 0088      | supersede ADR-0083; palinsesto A/B/C decaduto |
| Catalogo permessi 64→44, template 11→7, seed senza tenant food         | #210 | 0060      | `TD-bootstrap-verticale` chiuso               |
| Riconciliazione DB dev e prod                                          | #211 | 0089      | **già applicata**, irreversibile              |

## Il deploy — cosa NON è stato fatto

**Nessun deploy in questa sessione.** I 4 container di produzione girano ancora su `cf0e521` (deploy del 2026-07-30, design-seam + P2). Le conseguenze sono nella Parte B, §Tre stati aperti: sono la cosa più importante da leggere prima del prossimo turno operativo.

L'unica operazione sull'ambiente vivo è stata la **riconciliazione del DB** (PR5), documentata in [ADR-0089](../architecture/ADR-0089-riconciliazione-db-catalogo-permessi.md).

## Presidi che hanno funzionato, con prova

- **La verifica di appartenenza prima del `down -v`.** Due progetti compose distinti — `gestionale-devdb` con **un** container e volume `postgres_dev_data`, `gestionale` con **otto** e volume `gestionale_postgres_data` — letti _prima_ dell'operazione distruttiva. Il `down -v` **non poteva** raggiungere la produzione. Non "non l'ha raggiunta": non poteva. È la differenza fra un'operazione sicura e una andata bene.
- **L'asserzione sullo stato finale, non solo sul delta.** La spec chiedeva di verificare quante righe venissero cancellate (20/4/80); l'aggiunta è stata asserire _dove si arrivava_ (44/7/154) **dentro la transazione, prima del `COMMIT`**. Un delta corretto su uno stato di partenza sbagliato produce comunque un risultato sbagliato. **Forma canonica: una transazione autoverificante asserisce lo stato finale.**
- **Le pre-conteggio come impronta del bersaglio.** `64/11/267/262` letti nella stessa sessione psql: dev era già a 44/7/154, quindi un target sbagliato si sarebbe visto sulla prima riga. **Verificare l'identità di un DB dai suoi dati, non solo dalla stringa di connessione.**
- **Il dump aperto, non solo annusato.** `PGDMP` sono cinque byte: dicono che l'inizio è giusto, non che il file sia integro. `pg_restore --list` → **525 voci di TOC, 49 `TABLE DATA`**, con dentro le 4 tabelle bersaglio e quelle del lavoro reale di `studio-demo`. Stesso principio di `head -60`: un controllo parziale presentato come verifica.
- **Il "40" che chiude il cerchio.** Non un conteggio sul DB, ma il numero di permessi che l'**applicazione in produzione** — su codice `cf0e521`, che conosce ancora i 64 vecchi — attribuisce a un utente reale leggendo il DB riconciliato: `44 − 4 portale.*`, food residui **zero**. La verifica end-to-end di una scrittura sui dati passa dall'applicazione, non dalla tabella.
- **La proprietà non progettata del gate di contrasto** (PR3). Rimuovendo la coppia dell'unica app sparano **due presidi indipendenti**: la cardinalità delle app (`ogni app trovata su disco ha una coppia per-app dichiarata`) e il censimento degli usi. Il gate **distingue una dichiarazione orfana da una viva** perché due controlli scritti per ragioni diverse si sovrappongono esattamente lì. Nessuno l'aveva progettato: serve saperlo la prossima volta che qualcuno vorrà togliere una coppia. La coppia food era rimovibile solo perché aveva `usi: []`.
- **La giustificazione storica non è archeologia** (ADR-0085). Senza «il KDS si legge da lontano» nessuno avrebbe saputo perché `Badge` ha `size="lg"` — e quindi nessuno avrebbe potuto accorgersi che oggi non ha più consumer (`TD-badge-size-lg-senza-consumer`). Cancellare il motivo lascia la forma senza appello, e il prossimo che la guarda la "semplifica".

## Le lezioni della sessione (il filo comune)

**Cinque trappole, tutte intercettate prima di fare danno, tutte della stessa famiglia già documentata.**

1. **`pnpm devdb:down` non resetta.** È `docker compose down` **senza `-v`**: preserva il volume. Col volume superstite il seed avrebbe aggiunto i 44 permessi _sopra_ i 64 esistenti senza toglierne nessuno (`TD-seed-non-ripulisce-rimossi`) e il gate sarebbe rimasto rosso **identico a prima**. La conclusione sbagliata sarebbe stata «il reset non ha funzionato» invece di «non ho resettato».
2. **`prisma:migrate:dev` punta a produzione.** È `dotenv -e ../../.env -- prisma migrate dev`: il `:dev` qualifica il **sottocomando Prisma**, non l'ambiente. Ed è il comando che _può proporre un reset dello schema_. Lo script giusto è `devdb:migrate`. **Ennesima istanza dell'inganno di naming di [ADR-0088](../architecture/ADR-0088-design-system-una-app.md).**
3. **`pg_restore --list` vuole un file seekable.** Da pipe risponde `did not find magic string in file header`, che _sembra_ dire «il dump è corrotto» e invece dice «il canale non è seekable». Chi lo legge di fretta rifà il backup, o decide che i backup non funzionano.
4. **Il build di verifica ha ripuntato `:latest`.** `docker-compose.prod.yml` dichiara `image:` **senza tag**, quindi `GIT_SHA` è solo un build arg. Un `docker compose up -d` avrebbe portato la produzione al codice di una PR non mergiata. Rimediato ricostruendo `cf0e521` da worktree e taggando `rollback-pre-pr2-cf0e521` (`TD-compose-image-tag-immutabile`, emendamento ad [ADR-0086](../architecture/ADR-0086-rollback-point-coppia-bloccante.md)).
5. **Il lockfile.** Rimuovere due workspace senza rigenerarlo avrebbe fatto morire la CI su `ERR_PNPM_OUTDATED_LOCKFILE` **prima** di eseguire un test — cioè **un rosso che ne nasconde un altro**, forma nuova rispetto al falso verde: il rosso atteso del gate di contrasto sarebbe stato invisibile sotto un rosso più grosso. Regola: rimuovere un workspace richiede `pnpm install --lockfile-only` prima di qualunque altra verifica.

### Il principio da portare avanti — lo strumento di verifica è codice non testato

> **Prima di riportare una misura anomala, si verifica che la misura sia valida.** Lo strumento di verifica non è mai stato testato, e va trattato come tale: una sonda, un `head`, un pattern di `ls-remote`, l'ordinamento assunto in una matrice, il **canale** di un `pg_restore` sono tutti codice che nessuno ha messo sotto prova.

**Asimmetria da tenere presente.** Un **rosso falso** costa un rollback ingiustificato. Un **verde falso** costa un bug in produzione. Entrambi i versi vanno rimisurati, ma **il verde falso è quello che nessuno va a ricontrollare spontaneamente**: il rosso ti obbliga a guardare, il verde ti autorizza a smettere.

**Il falso verde di questa sessione — la sesta istanza, e la più insidiosa finora.** `pnpm test` ha dato **14/14 verde** su un albero da cui erano spariti 187 file, con `13 cached`. Il gate di contrasto legge i fogli di token **fuori dal proprio workspace** (`apps/*/src/app/globals.css`), mentre turbo hasha i file del solo pacchetto: cancellate le due app, l'hash di `@gestionale/ui` non è cambiato e turbo ha **riprodotto il verde registrato prima della rimozione**. Il rosso è comparso solo con `turbo run test --force`.

Due corollari, entrambi in [ADR-0087](../architecture/ADR-0087-gate-cross-workspace-invisibile-alla-cache.md):

- **`Cached: N` è parte del riepilogo da leggere**, non rumore di fondo: `13 cached` su un albero che ha perso 187 file è già il segnale.
- **Che la CI non abbia remote cache di turbo è una fortuna, non un presidio.** Il giorno in cui venisse attivata — cosa che si fa per andare più veloci, non per cambiare semantica — questo gate inizierebbe a mentire anche lì.

E il punto che vale oltre il caso: il gate è invisibile all'hashing **proprio per la ragione che lo rende utile** — misura una relazione _fra_ pacchetti. Ogni futuro presidio cross-workspace nasce con lo stesso punto cieco.

**L'inganno di naming, generalizzato** ([ADR-0088](../architecture/ADR-0088-design-system-una-app.md)). Tre istanze, una regola: `A · Servizio` / `B · Sala` / `C · Turno` nominavano con parole del dominio ristorante ciò che in due casi su tre era **fondazione condivisa**; `docker-compose.dev.yml` è in realtà il file base; `image:` senza tag fa sembrare `:latest` un alias mentre è l'unica ancora dell'immagine viva. **Un nome preso dal dominio di un consumer descrive male ciò che è condiviso.** Il presidio non è ricordarsi: è che il nome e il contenuto vengano **riletti insieme** quando si pianifica. La rinomina «seam per-verticale» → «livello per-app» di PR3 è quella lezione applicata a sé stessa.

**Chiuso ≠ risolto.** `TD-bootstrap-verticale` è chiuso **per costruzione**: il debito era che un tenant creato via API ereditasse i ruoli del verticale sbagliato, e con un verticale solo non esiste un verticale sbagliato. Ma la **causa-radice** — nessuna dimensione `verticale` nei dati, curatela che vive solo nel seed imperativo — è intatta: è il **sintomo** ad essere decaduto. Se un secondo verticale tornasse, il TD va **riaperto, non riscoperto**. Scritto nel registro con questa riserva, e vale come forma per ogni debito che «si chiude» perché sparisce il suo oggetto.

**Il livello per-app ha cambiato il tipo di giudizio che chiede.** Con due verticali la domanda di guardia era «i due devono differire?», e si rispondeva **guardando l'altro**. Con uno solo diventa «questo token è dell'app o è del sistema?», che **non ha un riferimento esterno**: richiede di decidere. Se i commenti avessero conservato la vecchia formulazione avrebbero posto una domanda a cui non si può più rispondere — ed è il motivo per cui riscriverli non era cosmesi.

---

# PARTE B — Stato operativo

## Repo

| voce             | valore                                          |
| ---------------- | ----------------------------------------------- |
| main             | `d916bd5`                                       |
| CI su main       | verde 4/4                                       |
| worktree         | pulito                                          |
| branch su origin | solo `main`                                     |
| branch locali    | solo `main`                                     |
| tag su origin    | 4 (`deploy/*`) — invariati                      |
| PR aperte        | nessuna                                         |
| `apps/`          | `accountant-api`, `accountant-web`, `README.md` |

Job CI: `checks` · `seed-rls-core` · `E2E domain RLS accountant` · `E2E accountant-web blob`.

## Catalogo e DB

|                    | codice | prod   | dev    |
| ------------------ | ------ | ------ | ------ |
| permessi           | 44     | 44     | 44     |
| template           | 7      | 7      | 7      |
| mapping            | 154    | 154    | 154    |
| `role_permissions` | —      | 182    | 102    |
| gate               | —      | ✅ 6/6 | ✅ 4/4 |

Template rimasti: `Super Admin`, `Admin sede`, `Socio`, `Collaboratore`, `Segreteria`, `Praticante`, `Cliente`.

## Produzione

`cf0e521` su `accountant-api`, `accountant-web` — e ancora `restaurant-api`, `restaurant-web`, che girano ma non hanno più codice in `main`.

**Asimmetria da sapere al prossimo preflight:** `main` è avanti rispetto alle immagini. Il drift va calcolato filtrando i path:

```bash
git log --oneline <SHA_PROD>..HEAD -- apps/ packages/
```

Se è vuoto, il codice è allineato anche se `main` è avanti. **Da questa sessione non è più vuoto**: la rimozione ha toccato `apps/` e `packages/`.

## ⚠️ Tre stati aperti — non dimenticare

1. **Il DB di produzione è più nuovo del codice deployato.** I container girano su `cf0e521`, che conosce i 64 permessi vecchi. **Verificato che regge** — login 201, `/me` → 40 permessi effettivi con zero food, endpoint gated a 200 — ma si chiude solo al prossimo deploy.
2. **La config Caddy col redirect `food.` non è mai stata applicata.** In repo da PR1; il proxy serve ancora quella precedente. Entra al deploy, o in un turno con la sua autorizzazione (`caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`, **mai restart**).
3. **`demo` e `acme` sono ancora in prod** con 11 tavoli, 10 articoli, 2 menu. Deliberato: vanno con PR6.

## ⚠️ Stato vivo fuori dal repo — non toccare

**Nessun `prune` di alcun tipo**, per nessun motivo. Vive sull'host, non nel repo:

- 4 immagini `rollback-pre-design-*` — rollback del deploy S21
- 2 immagini `rollback-pre-pr2-cf0e521` — **ancora esplicita del deploy vivo**, create dopo l'incidente `:latest` (lezione 4)

Regola: le immagini di rollback sopravvivono **finché il deploy successivo non ne crea di nuove** — finestra scorrevole di uno. Se emerge pressione sullo spazio: **STOP**, si nomina cosa liberare una voce per volta.

**Dump:**

- `gestionale_20260902T204540Z_pre-pr5-riconcilia_53556fd.dump` — `PGDMP`, 289 484 B, `0600`, `.sha256` a fianco, verificato con `pg_restore --list` (non col solo magic-byte).
- **È l'ultima copia completa che contiene il dominio food.** Dopo PR6 nulla lo conterrà più. Se un giorno esisterà una rotazione automatica dei backup, **questo file non deve finirci dentro**.
- Nessun dump copre `storage_data` (`TD-storage-backup-blob`): righe sì, blob no.

## PR6 — l'ultimo passo, deliberatamente rinviato

Schema Prisma: 12 model, 9 enum, 12 back-relation su `Tenant`, migrazione che droppa le tabelle di dominio food, più i 2 tenant con la loro cascata.

**Perché può aspettare:** nessuna FK dal food verso il condiviso se non `tenantId → Tenant`; nessun codice legge più quelle tabelle; finché ci sono, i dati restano leggibili.

**Perché è diversa da PR5:** PR5 cancellava dati **ricostruibili dal seed** (il catalogo è codice). PR6 droppa tabelle con dentro dati che nessun seed ricrea, e si annulla **solo ripristinando un dump intero** — cioè perdendo tutto il lavoro su `studio-demo` nel frattempo. **Il rimedio costa più del danno.**

**Serve un dump nuovo:** `pre-pr5` ha già fatto il suo lavoro e **il suo nome non può coprire due operazioni diverse**.

## Registro TD (con trigger)

> `TD-registry-dentro-handoff` è ancora aperto: questo registro vive qui dentro, quindi ogni registrazione di debito trascina `HANDOFF.md` in una PR e collide con la convenzione «HANDOFF e PROGRESS in PR separate». Trigger: prossima PR che registra un debito **e** ha ragioni di suo per non toccare HANDOFF.

**✅ Chiuso in questa sessione**

- **`TD-bootstrap-verticale`** — chiuso **per costruzione**, un verticale solo ([ADR-0060](../architecture/ADR-0060-sync-permessi-template-tenant-noop.md)). Con la riserva scritta sopra: la causa-radice è intatta, se torna un secondo verticale il TD va **riaperto**.

**🆕 Nuovi**

- **`TD-compose-image-tag-immutabile`** (MEDIO) — `docker-compose.prod.yml` nomina le immagini **senza tag**: `:latest` è insieme il riferimento che il deploy sposta e l'unica ancora dell'immagine in esercizio. Finché è così, il presidio manuale è l'unica difesa e ogni build è un'occasione di perderla. Forma candidata: `image: gestionale/accountant-api:${GIT_SHA}` con `:latest` come alias mosso al cutover. **Trigger:** prossimo deploy.
- **`TD-turbo-cache-gate-cross-workspace`** (MEDIO) — un gate che legge file fuori dal proprio workspace è invisibile all'hashing di turbo. Correzione: dichiarare gli `inputs` reali del task `@gestionale/ui#test`. Non applicata perché un `inputs` che copre metà dei consumer è peggio di nessuno — restituisce fiducia senza darne il fondamento. **Trigger:** attivazione di una remote cache, o prossimo gate cross-workspace.
- **`TD-badge-size-lg-senza-consumer`** (BASSO) — `size="lg"` di `Badge` è nato per il KDS e non ha più call-site applicativo; l'unico riferimento è la smoke test della primitiva. **Trigger:** prossima revisione delle primitive (ex P4).
- **`TD-dns-wildcard-accountant`** (BASSO) — qualunque sottodominio di `studiodesk.cloud` risolve e arriva all'accountant, che risponde 200 su ogni hostname inventato. Non è una falla di isolamento (il tenant si decide dal path, RLS/RBAC restano interi) ma è una superficie che nessuno ha scelto. **Registrato, non risolto**: è una decisione di modello dei domini.

**⭐ Primo candidato — `TD-ci-e2e-accountant-api`**

Da oggi **nessun job CI apre un browser vero contro un backend vero**. Resta: 2 spec RLS su testcontainers + 1 spec FE route-mocked. `page-tour` non è in CI e punta alla produzione (`TD-smoke-punta-solo-a-prod`). Ma `accountant-api` ha **25 spec e2e di cui solo 2 CI-gated**: **il recupero non richiede scrivere test, richiede cablare quelli che esistono.** Tier MEDIO → **ALTO**, non perché il debito sia cresciuto ma perché è cresciuto il suo peso relativo.

**Aperti — invariati**

- `TD-storage-backup-blob` — nessun dump copre `storage_data`: `pg_dump` copia righe, non blob. **Trigger:** primo cliente reale.
- `TD-backup-automation` — la procedura esiste, è versionata ed è provata; manca la **schedulazione** (`crontab -l` di `deploy` vuoto). **Trigger:** primo cliente reale.
- `TD-dev-env-punta-prod` — **sesta e settima manifestazione in questa sessione**: `prisma:migrate:dev` punta al `.env` di produzione, e il build di verifica ha riassegnato `:latest` della prod. Check concreto: risalire al `ppid` → `containerd-shim` = container.
- `TD-caddyfile-root-placeholder` — `./Caddyfile` sembra la config di produzione e non lo è; quella reale è `./infra/caddy/conf/Caddyfile`. Chi legge il primo conclude il falso.
- `TD-engines-node-vs-dockerfile` — i Dockerfile usano `node:22-alpine`, il `package.json` di root dichiara `">=20.18.0 <21"`. `engines` **mente a chi lo legge** per scegliere la versione locale.
- `TD-gate-non-vede-alpha` — `destructive` è mappato nel preset **senza** `<alpha-value>`, quindi `bg-destructive/10` nei call-site non produce alcuna trasparenza e il gate di contrasto non lo vede. Descritto in [ADR-0085](../architecture/ADR-0085-token-stati-badge.md) §D2; **l'identificativo compare qui per la prima volta**, non è registrato con questo nome altrove nel repo. **Trigger:** P4.
- `TD-bordo-circolari-sotto-soglia` — il bordo del box "conferma richiesta" del portale circolari sta a **1.43** in chiaro e **2.65** in scuro contro la soglia non-testo di 3, **già oggi coi letterali**. **Trigger:** P3b-0, quando quella riga passa ai token.
- `TD-seed-non-ripulisce-rimossi` — il seed è additivo/idempotente ma **non cancella**. Il gate lo rileva (C1-bis) come informativo, non bloccante: rimuovere un privilegio è un'azione che va decisa, non automatizzata. **Confermato sul campo in PR5**: è la ragione per cui il reset di dev richiede `down -v`.
- `TD-accountant-zero-copertura-e2e` — zero e2e pre-merge sull'accountant: `page-tour` punta a produzione anche in locale, nessun `data-testid` sugli elementi di stato, e il seed non crea mandati/circolari/note spese/comunicazioni.
- `TD-ci-e2e-testcontainers-be` — pre-sessione: verificare se resta scoperto qualcosa nella copertura
  comportamentale in CI. Si legge **insieme** a `TD-ci-e2e-accountant-api`, che oggi ne è la forma concreta.
- `TD-perm-propagation`, `TD-role-template-key` — i due gemelli superstiti di [ADR-0060](../architecture/ADR-0060-sync-permessi-template-tenant-noop.md). **Trigger comune:** primo tenant creato via API bootstrap.

**Chiusi in sessioni precedenti** (non ripetuti per esteso qui, la motivazione vive negli ADR citati):
`TD-deploy-perm-reconcile-gate` · `TD-tailwind-config-dup` · `TD-ci-apt-external-dep` · `TD-prepush-hook-blocca-tag`.

**Aperti — trigger-gated**

- `TD-visual-regression-net` — **trigger:** prima del ritocco delle primitive condivise. Ridotto: il diff dei valori CSS computati copre già i cambi di token in modo deterministico; la rete screenshot serve solo per il residuo (geometria, spaziatura, ritorni a capo).
- `TD-smoke-punta-solo-a-prod` — **trigger:** serve una smoke per-ruolo gatante in CI su codice non deployato → il `baseURL` (oggi sull'URL pubblico) va parametrizzato su istanza effimera dal branch.
- `TD-e2e-validationpipe-missing` — il harness E2E non esercita il `ValidationPipe`: nessun DTO `@Body` è validato in e2e. **Trigger:** un DTO con constraint di sicurezza/integrità entra in un path senza copertura unit equivalente.

**☠️ Trigger estinto con il verticale — non chiusi, decaduti**

Quattro debiti trigger-gated nominavano il dominio food. Non sono stati risolti: **il loro oggetto non esiste più**, e vale la stessa riserva di `TD-bootstrap-verticale` — se un secondo verticale tornasse, andrebbero riaperti, non riscoperti.

- `TD-conti-list-amounts` — `GET /conti` flat, senza importi (trigger: il cassiere prioritizza i conti per importo).
- `TD-dashboard-service-day` — "oggi" = giorno solare, non giorno di servizio (trigger: cliente con servizi oltre mezzanotte).
- `TD-cassa-resto-drawer` — il resto contanti non è modellato (trigger: riconciliazione cassetto/fondo cassa).
- `TD-cassa-chiusura-giornaliera` — `cassa.chiusura.giornaliera` era il permesso orfano, ed è **uscito dal catalogo con PR4**.

A questi si aggiunge `TD-rbac-tavolo-write-subset`, già dichiarato decaduto in ADR-0060: il tenant, il ruolo e l'endpoint `PATCH /tables/:id` non esistono più.

## Prossimi passi

1. **PR6** — schema e migrazione distruttiva. Quando si vuole, **non urgente**. Serve un dump nuovo.
2. **Deploy** — chiude **due dei tre stati aperti**: allinea il codice al DB e applica la config Caddy.
3. **`TD-ci-e2e-accountant-api`** — cablare le 23 spec e2e che esistono e non girano in CI.
4. **P3b** — neutri, radius, scala tipografica. Ora su una sola app: **da 46 pagine a 32**. `P3a è decaduta`: era la palette food.
5. Il debito `--muted-foreground`/`--muted` a **4.34** con un **consumer reale** (`mandati`, stato `annullato`): non alzabile fuori da P3b, perché è un neutro condiviso.

## Convenzioni operative (invariate)

- Merge = `gh pr merge --squash --delete-branch` **da terminale Code**, dopo "vai" esplicito di Nicolò. MAI da UI.
- `gh pr create` e `gh pr merge` sono turni separati; non ripetere un comando rifiutato uguale.
- `git add` sempre selettivo, mai `-A`.
- STOP-gate: STOP 0 read-only → STOP 1 lockato → STOP 2 self-check. La riga «impatto sull'altro verticale» **ha perso oggetto**: con un verticale solo va tolta dal formato del report.
- HANDOFF e PROGRESS sono **due PR docs separate** (log vs stato di chiusura), via PR docs dedicata (`docs/...`, commit `docs(...): ...`, PR + CI verde + squash — NO push diretto, il pre-push hook ADR-0004 lo blocca).
- L'header _Ultimo aggiornamento / Fase corrente_ di PROGRESS è stale da giugno per convenzione: allinearlo è una decisione a sé, non un effetto collaterale di altre PR.
- Lo snapshot in testa a questo file si scrive in forma **anti-riferimento-circolare**: `Main @ <sha> (+N commit docs in arrivo via PR)`, mai citando la PR che lo introduce — sarebbe stale nell'istante del merge.
- **Verifica locale con `turbo run test --force`** quando il cambiamento è fuori dal workspace del gate che deve accorgersene (`TD-turbo-cache-gate-cross-workspace`).
- **Prima di ogni `docker compose build` sull'host di produzione**, deploy o semplice verifica: taggare per **image ID del container in esecuzione**, mai via `:latest` ([ADR-0086](../architecture/ADR-0086-rollback-point-coppia-bloccante.md)).
