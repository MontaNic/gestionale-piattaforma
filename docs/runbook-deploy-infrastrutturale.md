# Runbook — Finestra di deploy infrastrutturale

**Scopo**: procedura riutilizzabile per portare in produzione una o più migrazioni additive più il rebuild delle immagini, **senza** propagazione di nuovi permessi ai ruoli esistenti (forma "Option 2": infrastruttura sì, propagazione differita al trigger ADR-0066).

**Prima esecuzione**: S19, 2026-07-25, base `main` @ `f7b5d19`, migrazione `add_note_spese` (→33). I valori concreti di quell'esecuzione compaiono come esempio; sostituiscili alla prossima.

**Quando NON usare questo runbook**: se la finestra deve propagare permessi a ruoli esistenti (perché esiste un cliente reale da servire), questo runbook non basta — serve lo STOP dedicato alla propagazione, che qui è deliberatamente fuori scope.

---

## Principi non negoziabili

1. **Ogni passo è un turno a sé.** `migrate deploy`, build, rollout e seed non si combinano mai in un solo prompt. Ciascuno ha la sua verifica, e non si prosegue se la verifica non è quella attesa.
2. **Le azioni contro produzione si eseguono a mente fresca**, non a fine sessione lunga.
3. **La spec (questo runbook) descrive; il comando eseguito decide.** Dove divergono, vince il comando. Verifica ogni decisione contro il comando reale, non contro la sua descrizione.
4. **`GIT_SHA` esportato per tutta la finestra** — dal merge di PR-A ogni comando `compose` contro prod lo richiede (e non solo `build`: Compose interpola l'intero modello al caricamento del file, quindi `config`/`ps`/`logs`/`up` lo pretendono tutti). In una shell nuova va riesportato.
5. **In caso di dubbio, STOP.** Un passo non fatto costa tempo; un passo fatto male su produzione costa molto di più.

---

## Precondizioni — tutte verdi prima di aprire la finestra

| Precondizione                          | Come si verifica                                                                        | Stato S19     |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ------------- |
| Backup con restore **provato**         | procedura OPS dump→restore effimero→diff conteggi→RLS                                   | ✅ 24/07      |
| Migrazioni pending note e **additive** | classificazione SQL di ciascuna (no DROP, no NOT NULL su tabella popolata, no backfill) | ✅ 1 additiva |
| Rollback point immagini                | tag + digest annotati delle immagini **in esercizio**                                   | ✅ P2         |
| Seed fail-closed su `NODE_ENV`         | il seed aborta se `NODE_ENV` non è esplicito                                            | ✅ PR-B       |
| Provenienza immagini                   | build fallisce senza `GIT_SHA`; label OCI `revision`                                    | ✅ PR-A       |
| Nessuna propagazione dovuta            | caratterizzazione tenant: nessun cliente reale = propagazione differita                 | ✅ 24/07      |

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

`pg_dump` è read-only, snapshot MVCC consistente, nessun downtime. Il magic-bytes `PGDMP` prova il non-troncamento. Il restore effimero completo **non** si rifà in linea se la procedura è già provata e il DB è quieto; se lo si rifà per prudenza, è `docker run --rm` (**mai** `run -d` senza `--rm`: lascerebbe un volume anonimo con una copia dei dati di produzione — errore osservato in S19).

**Verifica: `PGDMP` presente, sha256 salvato. Altrimenti STOP.**

### Passo 2 — Tag di rollback (prima del build)

```bash
for svc in accountant-api accountant-web restaurant-api restaurant-web; do
  docker tag gestionale/$svc:latest gestionale/$svc:rollback-pre-<etichetta>
done
# annota i DIGEST delle immagini in esercizio: sono il rollback point vero, indipendente dai tag
for svc in accountant-api accountant-web restaurant-api restaurant-web; do
  echo -n "$svc: "; docker inspect gestionale-$svc-1 --format '{{.Image}}'
done
```

**Verifica che ciascun tag coincida per digest con l'immagine che il container sta _eseguendo_** — non con ciò che `:latest` indicava. Il rollback point è l'immagine in esercizio, non l'ultima buildata.

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
  echo -n "$svc: "
  docker inspect gestionale/$svc:latest --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
done
```

**Verifica: ogni label `revision` = `$GIT_SHA`. Se una sola diverge → STOP** (immagine non tracciabile, ciò che il presidio doveva impedire). Utile anche confermare che `:latest` (`.Id`) sia ora diverso dal tag `rollback-pre-<etichetta>`: prova che il build ha prodotto immagini davvero nuove.

### Passo 6 — Rollout

Zero-downtime per servizio. **Mai** `down`/`up` (spegnerebbe tutto insieme).

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.prod.yml up -d <servizi>
docker ps --format 'table {{.Names}}\t{{.Status}}'
# app ricreati Up; postgres/redis/caddy intatti
```

Verifica che i container in esecuzione portino le immagini nuove (per digest, `.Image`, non per tag). `impatto sull'altro verticale`: se la migrazione tocca tabelle condivise (`tenants`/`users`), verifica che **entrambi** i verticali rispondano — health end-to-end via Caddy (`https://<dominio>/api/v1/health`), non solo la porta interna: un container può rispondere sulla sua porta e restare irraggiungibile dal proxy. Una home che risponde `307` è il redirect auth di Next, non un errore (una web app morta darebbe 502/timeout da Caddy).

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

### Passo 8 — Chiusura

Annota: SHA deployato, digest delle immagini **nuove** (rollback point della prossima finestra), conteggi finali, path dei backup. `git status` pulito (la finestra non modifica il repo). `compose config` valido.

---

## Rollback

| Momento del guasto              | Azione                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Prima del Passo 3               | Nessun rollback: niente è cambiato in produzione                                                                                         |
| Dopo Passo 3, prima del Passo 6 | Le immagini vecchie girano contro lo schema nuovo (additivo, retrocompatibile). Rollback schema **non necessario** per tornare operativi |
| Dopo Passo 6                    | Ritag `rollback-pre-<etichetta>` → `latest`, poi `up -d`. Le immagini vecchie girano contro lo schema nuovo senza problemi               |
| Serve annullare lo schema       | Restore dal dump del Passo 1 in DB pulito. **Operazione delicata: STOP e progetta con calma, mai `--clean` sul DB vivo senza verifica**  |

Principio: lo schema additivo è retrocompatibile, quindi **il rollback delle immagini non richiede il rollback dello schema**. Il restore del DB è l'ultima risorsa, non il primo gesto.

---

## Fuori scope (per costruzione)

- **Propagazione permessi ai ruoli esistenti** — ADR-0066, trigger "primo tenant non well-known via API". Finché nessun tenant di produzione ha utenti a dominio reale (verificato 01/07 e riconfermato 24/07), non c'è nessuno da servire.
- **Automazione backup, retention, off-site** — `TD-backup-automation`: il dump della finestra è one-shot e manuale, sullo stesso disco del volume Postgres. Trigger: primo cliente reale in produzione.
- **Blob non coperti dal `pg_dump`** — `TD-storage-backup-blob` (ADR-0079).
- **Migrazione di eventuali blob orfani** — `TD-storage-gc` (ADR-0079).
- **Container come root** — `TD-container-runs-as-root` (ADR-0079).
- **Processi dev orfani sull'host di produzione** — `TD-dev-processes-orphaned-on-prod-host` (ADR-0079).
- **Allineamento README** su `db:seed` (fatto in S19).
