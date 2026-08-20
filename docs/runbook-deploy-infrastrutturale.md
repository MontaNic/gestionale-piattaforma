# Runbook — Finestra di deploy infrastrutturale

**Scopo**: procedura riutilizzabile per portare in produzione una o più migrazioni additive più il rebuild delle immagini, **senza** propagazione di nuovi permessi ai ruoli esistenti (forma "Option 2": infrastruttura sì, propagazione differita al trigger ADR-0066).

**Prima esecuzione**: S19, 2026-07-25, base `main` @ `f7b5d19`, migrazione `add_note_spese` (→33). I valori concreti di quell'esecuzione compaiono come esempio; sostituiscili alla prossima.

**Seconda esecuzione**: S21, 2026-07-30, base `main` @ `cf0e521` (design seam #189 + P2 #190-#193). Forma diversa: **zero migrazioni e zero scritture su DB** nel delta rispetto alla baseline restaurant, quindi niente Passo 3 e niente Passo 7 — rollback puramente a livello immagine. Le aggiunte marcate _(S21)_ vengono da lì e sono tutte state esercitate.

**Quando NON usare questo runbook**: se la finestra deve propagare permessi a ruoli esistenti (perché esiste un cliente reale da servire), questo runbook non basta — serve lo STOP dedicato alla propagazione, che qui è deliberatamente fuori scope.

---

## Principi non negoziabili

1. **Ogni passo è un turno a sé.** `migrate deploy`, build, rollout e seed non si combinano mai in un solo prompt. Ciascuno ha la sua verifica, e non si prosegue se la verifica non è quella attesa.
2. **Le azioni contro produzione si eseguono a mente fresca**, non a fine sessione lunga.
3. **La spec (questo runbook) descrive; il comando eseguito decide.** Dove divergono, vince il comando. Verifica ogni decisione contro il comando reale, non contro la sua descrizione.
4. **`GIT_SHA` esportato per tutta la finestra** — dal merge di PR-A ogni comando `compose` contro prod lo richiede (e non solo `build`: Compose interpola l'intero modello al caricamento del file, quindi `config`/`ps`/`logs`/`up` lo pretendono tutti). In una shell nuova va riesportato.
5. **Forma compose obbligatoria: sempre ENTRAMBI i file** _(S21)_ — `-f docker-compose.dev.yml -f docker-compose.prod.yml`, in quest'ordine, per **ogni** comando (`config`, `ps`, `logs`, `build`, `up`). `docker-compose.prod.yml` **non è auto-consistente**: è un overlay, e la rete `gestionale_network` è definita in `dev.yml`. Da solo fallisce già su `config` con `service "caddy" refers to undefined network gestionale_network`. Il file "dev" è in realtà il **base condiviso** e il nome mente — è una manifestazione di `TD-dev-env-punta-prod`. Qualsiasi comando scritto a memoria contro `prod.yml` da solo fallisce, o fa la cosa sbagliata in silenzio.
6. **Confronto delle label OCI a PREFISSO, mai per uguaglianza** _(S21)_ — `case "$L" in <sha>*)`, non `[ "$L" = "<sha>" ]`. La forma di `GIT_SHA` è stata storicamente disomogenea: 40 caratteri sulle immagini di S19, short su quelle della cassa. Un confronto letterale dà un **rosso falso** su un'immagine corretta.
7. **In caso di dubbio, STOP.** Un passo non fatto costa tempo; un passo fatto male su produzione costa molto di più.

---

## Precondizioni — tutte verdi prima di aprire la finestra

| Precondizione                          | Come si verifica                                                                                                        | Stato S19     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| Backup con restore **provato**         | procedura OPS dump→restore effimero→diff conteggi→RLS                                                                   | ✅ 24/07      |
| Migrazioni pending note e **additive** | classificazione SQL di ciascuna (no DROP, no NOT NULL su tabella popolata, no backfill)                                 | ✅ 1 additiva |
| Rollback point immagini                | coppia tag+divieto prune ([ADR-0086](architecture/ADR-0086-rollback-point-coppia-bloccante.md)) + verifica di efficacia | ✅ P2         |
| Seed fail-closed su `NODE_ENV`         | il seed aborta se `NODE_ENV` non è esplicito                                                                            | ✅ PR-B       |
| Provenienza immagini                   | build fallisce senza `GIT_SHA`; label OCI `revision`                                                                    | ✅ PR-A       |
| Nessuna propagazione dovuta            | caratterizzazione tenant: nessun cliente reale = propagazione differita                                                 | ✅ 24/07      |

Se una sola precondizione è ❌, la finestra non si apre.

---

## Sequenza

### Passo 0 — Ambiente e preflight (read-only)

```bash
cd /home/deploy/projects/gestionale
git checkout main && git pull --prune
export GIT_SHA=$(git rev-parse HEAD)
echo "GIT_SHA=$GIT_SHA"

docker ps --format 'table {{.Names}}\t{{.Status}}'
docker exec gestionale_postgres psql -U postgres -d gestionale -At -c \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"
```

**Gate premessa (Option 2)** — nessun cliente reale da servire:

```bash
docker exec gestionale_postgres psql -U postgres -d gestionale -At -c \
  "SELECT count(*) FROM users WHERE email NOT LIKE '%.local';"
```

Atteso `0`. **Se > 0 → STOP**: esiste un tenant con utenti a dominio reale, la premessa di Option 2 è cambiata e la propagazione permessi va riconsiderata prima di procedere.

**Baseline pre-finestra** da annotare (riferimento per i gate finali):

```bash
docker exec gestionale_postgres psql -U postgres -d gestionale -At -c \
  "SELECT 'perms', count(*) FROM permissions
   UNION ALL SELECT 'tpl_perms', count(*) FROM system_role_template_permissions
   UNION ALL SELECT 'role_perms', count(*) FROM role_permissions;"
```

S19: `permissions=60`, `tpl_perms=249`, `role_perms=245`. Il terzo — `role_perms` — **deve restare invariato** a fine finestra: è la firma che la propagazione ai ruoli NON è avvenuta.

### Passo 1 — Backup fresco

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/home/deploy/backups/gestionale_${TS}_pre-migrate_${GIT_SHA:0:7}.dump
docker exec gestionale_postgres pg_dump -U postgres -Fc -d gestionale > "$OUT"
echo "exit=$?"; chmod 600 "$OUT"
head -c 5 "$OUT" | xxd            # atteso: PGDMP
sha256sum "$OUT" | tee "${OUT}.sha256"
```

`chmod 600` non è un dettaglio: è lo standard di fatto dei dump esistenti, e senza di esso l'umask produce `0664` — una copia completa della produzione leggibile da chiunque sull'host.

**Il nome del dump è un'asserzione, non un'etichetta** _(S21)_. `pre-`/`post-` va verificato contro **l'orario reale del cutover**, non contro l'intenzione di chi lancia il comando: `pg_dump` è idempotente come comando, il nome del file no. Un `…_pre-deploy-…` prodotto dopo il cutover contiene lo stato **post**-deploy ed è indistinguibile per nome da quello legittimo: chi lo usasse per un rollback ripristinerebbe lo stato che voleva annullare, senza sapere di sbagliare. **Un falso documentale nella directory dei backup è peggio di un backup mancante.** Prima di rieseguire un dump con un nome già usato in finestra, confronta il timestamp col momento del `up -d`.

`pg_dump` è read-only, snapshot MVCC consistente, nessun downtime. Il magic-bytes `PGDMP` prova il non-troncamento. Il restore effimero completo **non** si rifà in linea se la procedura è già provata e il DB è quieto; se lo si rifà per prudenza, è `docker run --rm` (**mai** `run -d` senza `--rm`: lascerebbe un volume anonimo con una copia dei dati di produzione — errore osservato in S19).

**Verifica: `PGDMP` presente, sha256 salvato. Altrimenti STOP.**

### Passo 2 — Rollback point (prima del build) — PASSO BLOCCANTE

**Il rollback point è una coppia inseparabile** (ADR-0086): (i) tag espliciti sulle immagini in esercizio, applicati **per image ID** e non per `:latest`; (ii) **divieto di prune di qualsiasi tipo** fino alla chiusura della finestra. Nessuno dei due basta da solo, e il build non parte se manca la verifica (c).

```bash
# (a) rileva gli ID DELLE IMMAGINI IN ESERCIZIO (non :latest)
for svc in accountant-api accountant-web restaurant-api restaurant-web; do
  echo -n "$svc: "; docker inspect gestionale-$svc-1 \
    --format '{{.Image}} rev={{index .Config.Labels "org.opencontainers.image.revision"}}'
done

# (b) tagga PER ID rilevato, non per :latest
docker tag <id-rilevato> gestionale/<svc>:rollback-pre-<etichetta>-<sha>

# (c) VERIFICA DI EFFICACIA — obbligatoria, il build non parte senza questo output
for t in gestionale/<svc>:rollback-pre-<etichetta>-<sha>; do
  echo -n "$t -> "; docker inspect "$t" \
    --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
done
```

**(c) è il gate**: la label OCI `org.opencontainers.image.revision` dell'immagine taggata deve corrispondere al suffisso del tag. Se non corrisponde, il tag è sull'immagine sbagliata — **STOP**, non correggere a intuito.

**Perché servono entrambi i presidi** _(S21, giustificazione empirica)_. Sono due regimi diversi, attraversati nella stessa finestra:

- **Prima del cutover** il tag è ridondante: i container in esecuzione ancorano gli image ID, che sopravvivrebbero a un prune comunque.
- **Dopo il cutover** i container non esistono più. Il tag diventa **l'unica cosa che tiene in vita il rollback**, e il divieto di prune **l'unica cosa che protegge il tag**: per Docker quelle immagini sono ora `unused`, e `docker image prune -a` le rimuove in silenzio.

**Prova empirica (S21)**: il build ha riassegnato `:latest` alle 4 immagini nuove e le 4 vecchie sono rimaste ancorate **dal solo tag**. Senza il Passo 2 sarebbero state dangling — cioè il rollback point sarebbe stato distrutto dal build stesso che lo rende necessario. La colonna "in uso" di `docker images` cade sulle immagini di rollback **subito dopo** `up -d`: è il segnale osservabile del passaggio da un regime all'altro.

**Divieto di prune, esplicito**: `docker system prune`, `docker image prune -a`, `docker builder prune -a` — nessuno, per nessun motivo, fino a chiusura finestra. Se emerge pressione sullo spazio: **STOP**, e si decide fuori finestra cosa liberare **nominando le immagini una per una**. Nota che i "reclaimable" di `docker system df` includono le immagini di rollback delle finestre precedenti: un prune "di pulizia" spazza via anche quelle.

### Passo 3 — `migrate deploy` (dall'HOST) — PUNTO DI NON RITORNO

La CLI Prisma **non** è nell'immagine (`npx` scaricherebbe la major incompatibile → `P1012`). Gira dall'host, dove `DIRECT_URL` = `postgres@127.0.0.1:5432`.

Prima, verifica read-only della forma dello script e dell'ambiente:

```bash
grep -A1 'prisma:migrate' packages/db/package.json    # usa lo script, non comandi diretti
pnpm --filter @gestionale/db exec prisma --version     # atteso: pinnato a 6.x, NON 7.x
```

Conferma anche che `127.0.0.1:5432` sia davvero il container prod (`docker port gestionale_postgres`) e non il dev (`55432`) — è il quasi-incidente di S18, e qui si verifica assente.

Checkpoint (read-only) — **exit 1 con "have not yet been applied" è NORMALE**, è la semantica di `migrate status` quando ci sono pending, non un errore:

```bash
pnpm --filter @gestionale/db run prisma:migrate:status
```

Atteso: esattamente le migrazioni previste come pending, né zero né una in più né un nome diverso. **Qualunque scostamento → STOP** (l'ambiente è cambiato).

Poi, **turno a sé**, l'azione irreversibile:

```bash
pnpm --filter @gestionale/db run prisma:migrate:deploy
```

Atteso: `All migrations have been successfully applied`, exit 0. Il box "Update available → 7.x" è informativo: si resta pinnati a 6 deliberatamente. **Se esce con errore o applicazione parziale → STOP**, accerta lo stato del DB prima di qualunque altra mossa.

Nota sui presidi, entrambi correttamente inerti qui e da non temere: `migrate deploy` è la CLI Prisma (engine proprio) e **non** attraversa `assertSafeDbTarget`; inoltre non esegue `seed.ts`, quindi il guard `NODE_ENV` di PR-B è fuori dal percorso.

### Passo 4 — Gate dello schema (read-only) — riuscita vs sicurezza

`migrate deploy` a exit 0 prova che la migrazione è **applicata**, non che sia **sicura**. Questo gate distingue le due cose. **Il build non parte finché tutti e tre non sono verdi.**

```bash
# (a) conteggio migrazioni
docker exec gestionale_postgres psql -U postgres -d gestionale -At -c \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"

# (b) FORCE RLS sulle tabelle nuove — non solo RLS, anche FORCE
docker exec gestionale_postgres psql -U postgres -d gestionale -At -F'|' -c "
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN (<tabelle nuove>);"
# atteso: ogni tabella  nome|t|t

# (c) GRANT per gestionale_app, ereditati dalle default privileges
docker exec gestionale_postgres psql -U postgres -d gestionale -At -c "
SELECT table_name, count(*) FROM information_schema.role_table_grants
WHERE grantee='gestionale_app' AND table_name IN (<tabelle nuove>)
GROUP BY table_name;"
# atteso: >0 su ciascuna
```

**Perché (b) è il controllo che conta di più**: una tabella con `relrowsecurity=t` ma `relforcerowsecurity=f` lascia passare il superuser e l'owner — l'isolamento fra tenant sarebbe apparente. La migrazione deve aver applicato sia `ENABLE` sia `FORCE`.

**Se `FORCE RLS` manca su una sola tabella, o i GRANT mancano → STOP.** È una migrazione applicata che lascia l'app insicura o in errore di permessi. Non si mette in esercizio codice che ci scrive contro finché non è chiarito.

### Passo 5 — Build con provenienza

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.prod.yml build <servizi>
# GIT_SHA già esportato (Passo 0). Se fallisce con "required variable GIT_SHA is missing":
# non è esportato in questa shell → torna al Passo 0.

for svc in <servizi>; do
  L=$(docker inspect gestionale/$svc:latest \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
  case "$L" in "$GIT_SHA"*) echo "$svc: OK ($L)";; *) echo "$svc: MISMATCH ($L)";; esac
done

# il presidio è sopravvissuto al build? (attese tante righe quanti i servizi)
docker images | grep rollback-pre-<etichetta>
```

**Verifica: ogni label `revision` ha `$GIT_SHA` come PREFISSO** (principio 6 — non uguaglianza). **Se una sola diverge → STOP** (immagine non tracciabile, ciò che il presidio doveva impedire). Utile anche confermare che `:latest` (`.Id`) sia ora diverso dal tag `rollback-pre-<etichetta>`: prova che il build ha prodotto immagini davvero nuove.

**Secondo gate, prima di toccare i container** _(S21)_: i tag di rollback devono essere **ancora tutti presenti**. Il build riassegna `:latest`, e da quel momento le immagini vecchie esistono solo grazie al tag. **Se una riga manca → STOP, non si procede al rollout**: il rollback è perso.

Se il build è `--no-cache`, aprilo con un check non distruttivo dello spazio (`df -h /var/lib/docker`, `docker system df`) e **STOP sotto ~10 GB liberi**, riportando i numeri. Non liberare nulla di iniziativa: vale il divieto di prune del Passo 2.

### Passo 6 — Rollout

Zero-downtime per servizio. **Mai** `down`/`up` (spegnerebbe tutto insieme).

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.prod.yml up -d <servizi>
docker ps --format 'table {{.Names}}\t{{.Status}}'
# app ricreati Up; postgres/redis/caddy intatti
```

Verifica che i container in esecuzione portino le immagini nuove (per digest, `.Image`, non per tag). `impatto sull'altro verticale`: se la migrazione tocca tabelle condivise (`tenants`/`users`), verifica che **entrambi** i verticali rispondano — health end-to-end via Caddy (`https://<dominio>/api/v1/health`), non solo la porta interna: un container può rispondere sulla sua porta e restare irraggiungibile dal proxy. Una home che risponde `307` è il redirect auth di Next, non un errore (una web app morta darebbe 502/timeout da Caddy).

**Il routing pubblico va provato dopo OGNI ricreazione di container, e il check interno non lo prova** _(S21)_. Entrambi i verticali hanno un host pubblico: l'accountant su apex + wildcard, il food su host esatto. La config reale è `infra/caddy/conf/Caddyfile` (bind-mount ro su `/etc/caddy`) — **non** `./Caddyfile` alla root, che è un placeholder (`TD-caddyfile-root-placeholder`); leggila sempre **per intero**, mai troncata.

Non basta che i due host rispondano `200`: va provata la **separazione degli upstream**, e serve una rotta **esclusiva per verticale**. Le rotte presenti su entrambe le API non discriminano nulla — `/api/v1/health` risponde identico da tutti e due, e anche `/api/v1/dashboard/stats` esiste su entrambe. Il segnale è l'**asimmetria 401/404**:

```bash
# /note-spese esiste solo su accountant-api; /conti solo su restaurant-api
curl -s -o /dev/null -w "%{http_code}\n" https://<apex>/api/v1/note-spese   # atteso 401
curl -s -o /dev/null -w "%{http_code}\n" https://<food>/api/v1/note-spese   # atteso 404
curl -s -o /dev/null -w "%{http_code}\n" https://<food>/api/v1/conti        # atteso 401
curl -s -o /dev/null -w "%{http_code}\n" https://<apex>/api/v1/conti        # atteso 404
```

`401` = la rotta esiste e il guard è attivo; `404` = upstream diverso. Le quattro risposte insieme provano che l'host esatto ha precedenza sul wildcard e che nessuno dei due verticali ricade sugli upstream dell'altro.

### Passo 7 — Seed permessi (dall'host, fail-closed)

Porta i nuovi permessi in `permissions` e sui **template**, **senza** toccare i ruoli.

```bash
pnpm --filter @gestionale/db run db:seed:prod
echo "exit=$?"
```

`db:seed:prod` = `NODE_ENV=production ALLOW_PROD_DB_ACCESS=1`. Il guard di PR-B lo lascia passare (NODE_ENV valido) e il ramo dev **non** si attiva — nell'output deve comparire `Dev data: SKIPPED (NODE_ENV=production)`.

**Gate finale — la firma di Option 2:**

```bash
docker exec gestionale_postgres psql -U postgres -d gestionale -At -c \
  "SELECT 'perms', count(*) FROM permissions
   UNION ALL SELECT 'tpl_perms', count(*) FROM system_role_template_permissions
   UNION ALL SELECT 'role_perms', count(*) FROM role_permissions;"

# secondo gate: nessun upsert dei tenant fittizi (l'altro modo in cui il ramo dev si manifesterebbe)
docker exec gestionale_postgres psql -U postgres -d gestionale -At -c "SELECT max(updated_at) FROM tenants;"
# atteso: invariato rispetto a prima del seed. Se si sposta a "ora" → il ramo dev ha scritto.
```

- `permissions` → salito del numero di permessi nuovi (S19: 60→63)
- `tpl_perms` → salito (S19: 249→262)
- **`role_perms` → INVARIATO** (S19: 245→245)

**Se `role_perms` è salito → STOP grave.** Significa che il ramo dev del seed si è attivato e ha propagato ai ruoli — il fail-closed di PR-B non ha tenuto in produzione. I permessi in più non rompono nulla, ma è un finding che invalida il presidio e va indagato prima di chiudere. Confronta entrambi i lati — l'output `SKIPPED` **e** il `role_perms` invariato — non fidarti di uno solo.

Verifica applicativa: entrambi i domini rispondono. La UI della feature nuova sarà **nascosta** (nessun ruolo ha i permessi) — è il comportamento atteso di Option 2, **non** un deploy fallito.

### GATE permessi — read-only, pre-build E post-deploy

Va eseguito **due volte**, prima del build e dopo il rollout, e deve dare lo stesso risultato. `roles` è RLS **FORCED**: il `SET` deve stare nella **stessa sessione** della query, altrimenti il risultato è vuoto e sembra un problema di dati.

```bash
pnpm --filter @gestionale/db check:role-perms
```

Verde = exit 0 e la riga finale che dichiara **target, ruoli esaminati e set atteso**. Rosso = exit 1 con l'elenco `tenant / ruolo / codice` e il comando di riconciliazione già pronto. **Se diverge → STOP: non riconciliare in finestra.** La riconciliazione è un'azione a sé, con il suo STOP.

Lo script è [`packages/db/scripts/check-role-permissions-drift.ts`](../packages/db/scripts/check-role-permissions-drift.ts). Quattro controlli, tutti eseguiti e riportati (non si ferma al primo):

|            | Cosa verifica                                                         | Esito       |
| ---------- | --------------------------------------------------------------------- | ----------- |
| **C1**     | catalogo DB allineato al codice (permessi, template, mapping)         | bloccante   |
| **C1-bis** | residui in DB rimossi dal codice (il seed non ripulisce)              | informativo |
| **C2**     | permessi del template **mancanti** ai ruoli materializzati            | bloccante   |
| **C3**     | permessi dei ruoli **in eccesso** rispetto al template                | bloccante   |
| **C4**     | ruoli non riconciliabili (`is_system = false`, o nome senza template) | bloccante   |

Tre cose che il gate fa e che la vecchia query manuale non faceva:

- **gira su tutti i ruoli, non solo `Super Admin`** — il presidio precedente non avrebbe preso né S19 né S21, entrambi su ruoli operativi;
- **restituisce codici, non conteggi** — un totale che torna non prova che sia il set giusto;
- **"zero ruoli esaminati" è ROSSO.** È il falso verde classico: `roles` è RLS **FORCED**, e senza `SET app.is_super_admin` sulla **stessa connessione** il result set è vuoto e ogni controllo passerebbe a vuoto. Lo script tiene `SET LOCAL` e query in un'unica transazione, e in più asserisce di aver esaminato almeno un ruolo.

Il set atteso è **importato** da `packages/db/prisma/rbac-catalog.ts` (fonte di verità condivisa col seed): non ci sono totali hardcodati da tenere aggiornati a mano, e `grep -c "code:"` non serve più — sovrastimava contando le occorrenze fuori dall'array.

Il gate stampa sempre il **target** (`host:porta/db`) e ne deriva i comandi che suggerisce: su questo host convivono prod (`:5432`) e dev (`:55432`). Per il DB dev: `pnpm --filter @gestionale/db check:role-perms:dev`.

### Passo 8 — Chiusura

Annota: SHA deployato, digest delle immagini **nuove** (rollback point della prossima finestra), conteggi finali, path dei backup. `git status` pulito (la finestra non modifica il repo). `compose config` valido.

Il **divieto di prune resta vivo** fino alla chiusura della PR di documentazione, non fino alla fine del rollout.

---

## Rollback

| Momento del guasto              | Azione                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Prima del Passo 3               | Nessun rollback: niente è cambiato in produzione                                                                                         |
| Dopo Passo 3, prima del Passo 6 | Le immagini vecchie girano contro lo schema nuovo (additivo, retrocompatibile). Rollback schema **non necessario** per tornare operativi |
| Dopo Passo 6                    | Ritag `rollback-pre-<etichetta>` → `latest`, poi `up -d`. Le immagini vecchie girano contro lo schema nuovo senza problemi               |
| Serve annullare lo schema       | Restore dal dump del Passo 1 in DB pulito. **Operazione delicata: STOP e progetta con calma, mai `--clean` sul DB vivo senza verifica**  |

Principio: lo schema additivo è retrocompatibile, quindi **il rollback delle immagini non richiede il rollback dello schema**. Il restore del DB è l'ultima risorsa, non il primo gesto.

**Il rollback è per-servizio** _(S21)_: si può tornare indietro sul solo `accountant-web` lasciando il resto sulla revisione nuova. Usa la forma compose completa (principio 5) e ricorda che `GIT_SHA` va riesportato al valore **del servizio che si sta ripristinando**, non a quello della finestra.

Se la finestra non ha migrazioni — come S21 — il rollback è **puramente a livello immagine** e nessuna riga della tabella sopra oltre l'ultima è applicabile. Vale la pena dirlo esplicitamente in apertura di finestra: abbassa il rischio e va sfruttato.

---

## Fuori scope (per costruzione)

- **Propagazione permessi ai ruoli esistenti** — ADR-0066, trigger "primo tenant non well-known via API". Finché nessun tenant di produzione ha utenti a dominio reale (verificato 01/07 e riconfermato 24/07), non c'è nessuno da servire.
- **Automazione backup, retention, off-site** — `TD-backup-automation`: il dump della finestra è one-shot e manuale, sullo stesso disco del volume Postgres. Trigger: primo cliente reale in produzione. **Rettifica _(S21)_**: [ADR-0079](architecture/ADR-0079-storage-persistente-provenienza-immagini.md) §205 afferma «oggi non esiste alcun backup, nemmeno del DB» — è **impreciso**. La procedura esiste (Passo 1), è versionata, è provata e ha girato in S19 e S21; in `/home/deploy/backups` ci sono dump con `.sha256` a fianco. Ciò che manca è la **schedulazione**: `crontab -l` per l'utente `deploy` è vuoto, nessun `pg_dump` in `scripts/`/`.github/`/compose. Il debito reale è "backup manuale, nessun cron" — più piccolo e di natura diversa da come è scritto. (Il crontab di `root` richiede `sudo` e non è stato verificato.)
- **Blob non coperti dal `pg_dump`** — `TD-storage-backup-blob` (ADR-0079).
- **Migrazione di eventuali blob orfani** — `TD-storage-gc` (ADR-0079).
- **Container come root** — `TD-container-runs-as-root` (ADR-0079).
- **Processi dev orfani sull'host di produzione** — `TD-dev-processes-orphaned-on-prod-host` (ADR-0079).
- **Allineamento README** su `db:seed` (fatto in S19).
