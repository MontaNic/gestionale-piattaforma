# HANDOFF — gestionale-piattaforma

**Snapshot:** `Main @ cf0e521 (#197) (+1 commit docs S21 in arrivo via PR #198)`
**Chiusura sessione:** blocco Cassa pre-fiscale completo + deployato; design language avviato (seam + P2 completa) in `main`. `main` verde pulito (0 flaky verificato su 4 run consecutivi).
**Aggiornamento 2026-07-30:** **seam + P2 DEPLOYATI in produzione** (finestra S21, `cf0e521` su tutti e 4 i servizi — primo deploy con un SHA unico). Vedi PROGRESS e [ADR-0086](../architecture/ADR-0086-rollback-point-coppia-bloccante.md).

---

# PARTE A — Stato

## Dove siamo

**Il loop restaurant `menu → tavoli → comande → KDS → cassa` è chiuso end-to-end, e la cassa è LIVE in produzione**, verificata nell'app reale (pagamento 201, guardia saldo D3 attiva, riepilogo IVA congelato esatto). È lo step di usabilità del piano a lungo termine: il verticale food è passato da demo a operabile in un servizio reale.

**Nota stato produzione (critica, non dimenticare):** NON ci sono clienti reali né dati di valore in prod. Tutto pre-lancio/demo. Il blast radius su superfici condivise ha stakes BASSI ora; "corruzione irrecuperabile" non è uno scenario reale finché non arrivano clienti. La disciplina STOP-gate/test resta utile come abitudine e rete PER QUANDO arriveranno, ma va calibrata sul rischio attuale (basso), non su uno immaginato.

## Cosa è in `main`

| Blocco                                                                                   | PR         | ADR  | In prod?     |
| ---------------------------------------------------------------------------------------- | ---------- | ---- | ------------ |
| Cassa PR1 — schema `Pagamento` + BE (pagamenti, storno, riepilogo IVA, guardia saldo D3) | #187       | 0081 | ✅ deployato |
| Cassa PR2 — contratto `chiudibile` + UI cassa                                            | #188       | 0082 | ✅ deployato |
| Design seam — `tokens.css` + `tailwind-preset`, 4 leggi, contratto 7×2                   | #189       | 0083 | ✅ deployato |
| P2 endpoint — `GET /dashboard/stats` (4 aggregati)                                       | #190       | 0084 | ✅ deployato |
| CI fix — Playwright senza apt (pg/ioredis)                                               | #192       | —    | (CI)         |
| P2 Badge — primitiva + token stati (6 var / 12 valori)                                   | #191       | 0085 | ✅ deployato |
| P2 dashboard FE — rebuild, Badge prima cliente, migrazione sentinel                      | #193       | —    | ✅ deployato |
| Fix flaky — single-flight deterministico (waiter espliciti)                              | #194, #195 | —    | ✅ deployato |

**Deployato in prod:** tutto quanto sopra, a `cf0e521` (finestra S21, 2026-07-30). È il **primo deploy con un SHA unico su tutti e 4 i servizi**: prima la produzione era su due revisioni diverse (`bc36e7d` restaurant / `f7b5d19` accountant) e "cosa gira in prod?" era rispondibile solo dalle label OCI.

## Deploy cassa — cosa è stato fatto

- Migration additiva `20260726215242_add_pagamento_cassa` applicata al DB prod condiviso (`Pagamento` + RLS + colonna `riepilogo_iva_snapshot`).
- **Riconciliazione Super Admin** all'invariante `ALL_PERMISSION_CODES` (idempotente, via `DIRECT_URL`): ha portato `cassa.pagamento.registra` + i 3 `notespese.*` arretrati ai ruoli Super Admin materializzati (60 permessi ciascuno). Ruoli operativi NON toccati (propagazione generale resta differita).
- **Primo deploy con rollback point vero:** tag `deploy/s19-f7b5d19` + immagini `gestionale/restaurant-{api,web}:rollback-s19-f7b5d19`. Migration e permessi additivi → rollback = solo-container, nessun rollback DB.

---

# PARTE B — Contesto, debiti, prossimi passi

## Registro TD (con trigger)

**Aperti — prioritari:**

- `TD-prepush-hook-blocca-tag` 🆕 — **primo candidato dopo il deploy S21.** `.husky/pre-push` decide **solo** su `git symbolic-ref HEAD` e **ignora i ref che riceve su stdin**: da `main` blocca quindi anche il push di tag annotati. ADR-0004 vuole impedire i **commit** diretti su `main`, non la pubblicazione di tag. Conseguenza già materializzata: `git ls-remote --tags origin` è **vuoto** — `origin` non ha **alcun** tag, dal primo in poi. La cronologia deploy non è mai stata pubblicata, e i 4 tag `deploy/*` esistono solo in locale (spariscono con la macchina; per questo lo SHA deployato va scritto in chiaro in PROGRESS). Fix: leggere stdin e lasciar passare `refs/tags/*`. **Efficacia dimostrabile**: il gate deve restare rosso su un push di commit su `main` e diventare verde su un push di soli tag. In S21 si è deciso di **non** usare `--no-verify`: bypassare un presidio dentro la finestra di deploy, per pubblicare documentazione, normalizza il bypass proprio nel contesto in cui il presidio serve di più.
- `TD-dev-env-punta-prod` — **ha morso 3 volte in S20**, più **2 manifestazioni nuove in S21** (totale 5 documentate). S20: quasi-incidente DB prod; divergenza template↔DB accountant; kill di un processo dentro un container durante pulizia dev. **S21 (i)**: `docker-compose.prod.yml` **non è auto-consistente** — la rete `gestionale_network` vive in `dev.yml`, quindi ogni comando contro il solo `prod.yml` fallisce; il file "dev" è in realtà il **base condiviso** e il nome mente. Il debito non è la configurazione, è il **nome**: qualsiasi comando scritto a memoria contro `prod.yml` fallisce o fa la cosa sbagliata in silenzio. **S21 (ii)**: `pnpm --filter @gestionale/db run prisma:migrate:status` ha interrogato la **produzione**, perché il root `.env` punta a `127.0.0.1:5432` (= `gestionale_postgres` prod; il dev è su `55432`). Era voluto ed è read-only, ma **nulla nella forma del comando distingue un `migrate status` da un `migrate reset`**: la sicurezza è venuta dall'operatore che sapeva cosa stava lanciando. Il criterio giusto resta: un comando di dev **non può** raggiungere un processo di prod, non "mi ricordo di verificare dopo". Check concreto emerso in S20: risalire al `ppid` → `containerd-shim` = container. È il più affilato dei quattro failure mode strutturali.
- `TD-deploy-perm-reconcile-gate` — trigger: prossimo deploy che aggiunge permessi. Il check "permessi Super Admin prod == set del codice" va **scriptato come GATE pre-build**. Il debito di propagazione ha morso 3 volte (notespese S19, cassa S20, Direzione accountant di Studio Ferretti) — il trigger reale è "qualsiasi permesso aggiunto a un ruolo materializzato", non "primo tenant via API". **Confermato aperto in S21**: nessuno script in `scripts/` (solo `check-no-api-next-routes.sh`), la prosa in questo file è tutto ciò che esiste. In S21 **non ha morso** — 60/60 su tutti e 4 i tenant, pre-build e post-deploy — ma il gate è rimasto manuale.
- `TD-engines-node-vs-dockerfile` 🆕 — i 4 Dockerfile usano `FROM node:22-alpine`, il `package.json` di root dichiara `"node": ">=20.18.0 <21"`. **Preesistente** (i Dockerfile non sono nel delta S21) e la produzione gira su Node 22 da sempre, senza problemi. Il difetto non è Node 22: è che **`engines` mente a chi lo legge** per scegliere la versione locale, e sviluppa contro un runtime diverso da quello di produzione. Il build lo segnala a ogni esecuzione (`WARN Unsupported engine`). Direzione di allineamento da decidere.
- `TD-registry-dentro-handoff` 🆕 — **il registro TD vive dentro questo file**, quindi ogni PR che registra un debito è costretta a toccare `HANDOFF.md`, e collide con la convenzione «HANDOFF e PROGRESS sono due PR docs separate». Emerso in S21: la PR #198 tocca entrambi, e dividerla avrebbe pagato ceremony per zero riduzione di rischio su una PR docs-only con CI verde. La causa non è la singola PR, è dove sta il registro. Fix: estrarre il registro in un file suo (es. `docs/TECH-DEBT.md`), così smette di trascinare HANDOFF a ogni registrazione e la convenzione torna applicabile senza eccezioni. Trigger: prossima PR che registra un debito **e** ha ragioni di suo per non toccare HANDOFF.
- `TD-caddyfile-root-placeholder` 🆕 — `./Caddyfile` alla root (6 righe, **zero** menzioni del food) sembra la config di produzione e non lo è. Quella reale è `./infra/caddy/conf/Caddyfile` (101 righe), versionata e bind-mounted **ro** su `/etc/caddy`. Chi legge il primo conclude il falso — in S21 è successo, con l'aggravante del troncamento (vedi lezioni). Fix: rimuovere il placeholder o rinominarlo in modo che non si possa scambiare per la config viva.
- `TD-backup-automation` — **rettifica S21.** [ADR-0079](../architecture/ADR-0079-storage-persistente-provenienza-immagini.md) §205 afferma «oggi non esiste alcun backup, nemmeno del DB»: **impreciso**. La procedura esiste (runbook Passo 1), è versionata, è provata e ha girato in S19 e S21; in `/home/deploy/backups` ci sono 3 dump con `.sha256` a fianco. Manca la **schedulazione**: `crontab -l` per l'utente `deploy` è vuoto, nessun `pg_dump` in `scripts/`/`.github/`/compose (il crontab di `root` richiede `sudo`, non verificato). Il debito reale è "backup manuale, nessun cron" — più piccolo e di natura diversa da come è scritto. Trigger invariato: primo cliente reale.
- `TD-ci-e2e-testcontainers-be` — pre-sessione; verificare se resta scoperto qualcosa nella copertura comportamentale in CI.

**Aperti — trigger-gated:**

- `TD-conti-list-amounts` — trigger: il cassiere deve prioritizzare i conti per importo dall'index. `GET /conti` è flat, senza importi. (`statoPagamento` non è badgeabile sulla dashboard per lo stesso motivo.)
- `TD-dashboard-service-day` — trigger: cliente reale con servizi oltre mezzanotte. "Oggi" = giorno solare Europe/Rome, non giorno di servizio.
- `TD-visual-regression-net` — trigger: prima di P4 (ritocco primitive condivise). Ridotto: il **diff dei valori CSS computati** copre già i cambi di token in modo deterministico; la rete screenshot serve solo per il residuo (geometria, spaziatura, ritorni a capo).
- `TD-smoke-punta-solo-a-prod` — trigger: serve una smoke per-ruolo gatante in CI su codice non deployato → il `baseURL` (oggi sull'URL pubblico) va parametrizzato su istanza effimera dal branch.
- `TD-e2e-validationpipe-missing` — il harness E2E non esercita il `ValidationPipe`: nessun DTO `@Body` è validato in e2e. Trigger: un DTO con constraint di sicurezza/integrità entra in un path senza copertura unit equivalente.
- `TD-cassa-resto-drawer` — trigger: cliente chiede riconciliazione cassetto/fondo cassa. Il resto contanti non è modellato.
- `TD-cassa-chiusura-giornaliera` — trigger: pilota chiede riepilogo fine giornata (Z-report). `cassa.chiusura.giornaliera` resta orfano.

**Chiusi questa sessione:** `TD-ci-apt-external-dep` (#192), `TD-tailwind-config-dup` (#189).

## Le lezioni della sessione (il filo comune)

**"Il verde dimostra meno di quanto sembra."** Quattro manifestazioni concrete:

1. La cassa sarebbe stata deployata read-only (403 su ogni pagamento) con CI e page-tour **verdi** — falliva con grazia. Presa dalla deploy-preflight.
2. Il `ValidationPipe` non valida i DTO in e2e — constraint verdi mai esercitati. Presa perché un test nuovo è fallito.
3. `report.operativo.visualizza` mancante su un ruolo materializzato pur avendolo il template — verificare **in DB, non nel seed**.
4. Il test single-flight passava su una race vinta, poi si è nascosto dietro un **job `success` con 1 flaky** (retry Playwright che maschera il primo tentativo). Regola operativa: **1 flaky non è verde; leggere la riga di riepilogo, non la conclusion.**

Corollario operativo: **la verifica empirica mirata batte il GATE**. Costruire le condizioni perché un check eserciti davvero il punto (utente Cameriere temporaneo + conti creati apposta, altrimenti la lista era vuota e il Badge non si renderizzava mai). E fare il **grep di chiusura sui residui E sulle assunzioni implicite**, non solo sui sentinel — `grep waitForURL.*dashboard` avrebbe trovato i 5 call-site di quiete prima del merge di #193. La domanda mancante: "chi altro assume che questa pagina sia ferma?".

**Rettifiche di metodo (S21) — quando è difettoso lo STRUMENTO di verifica, non il sistema verificato.**

Due casi nella stessa finestra, stessa famiglia: un check ha prodotto un **rosso falso** su un sistema sano, con la stessa confidenza di un rosso vero. È il rovescio esatto di "il verde che mente", e va guardato con lo stesso sospetto.

1. **Sonda CSS — il tema si imposta PRIMA del caricamento, mai dopo.** Mutare `document.documentElement.className` a runtime produce **colori derivati stantii**: la custom property risolve già al valore dark (`--accent-soft` → `224.4 64.3% 32.9%`, verificato) e il selettore matcha (`el.matches('.dark *')` → `true`), ma `backgroundColor`/`color` restano ai valori **light**. In S21 questo ha prodotto un falso allarme sulla sidebar accountant che, se accettato, avrebbe portato al **rollback ingiustificato di `accountant-web`**. La misura va fatta su una pagina con `class="dark"` **già presente nell'HTML** — che è anche come l'app serve realmente la pagina, la classe c'è prima del primo paint. Con la forma statica i 4 valori sono risultati identici agli attesi. **Questa è la condizione al contorno che rende affidabile la tecnica del diff dei valori computati**: senza, la tecnica produce guasti immaginari.
2. **Verifica alla fonte ≠ verifica COMPLETA della fonte.** Un `head -60` su un file di **101 righe**, letto dalla fonte giusta (`docker exec … cat /etc/caddy/Caddyfile`), ha prodotto la conclusione falsa «il restaurant non è dietro Caddy» — presentata come verifica empirica perché la _fonte_ era quella giusta. Il vhost `food.` stava alle righe 68-101. Conseguenza: una superficie pubblica dichiarata coperta senza essere stata toccata. Va accanto a «1 flaky non è verde» e «leggi la riga di riepilogo, non la conclusion»: sono tutte istanze di **un segnale accettato senza guardare cosa lo produceva**. Regola: quando un output è troncato da `head`/`tail`/`| head -n`, la conclusione vale solo per la porzione letta — e su una fonte di verità (config, Caddyfile, schema) non si tronca mai.

**Altri principi rafforzati:**

- Diff dei valori CSS computati > screenshot per i cambi di token (deterministico, nessuna baseline binaria). Ha trovato un letterale citato in un commento che Tailwind trasformava in CSS reale. **Vale solo con la condizione al contorno della rettifica 1 sopra.**
- Riconcilia all'**invariante**, non cherry-pick (Super Admin = `ALL_PERMISSION_CODES`).
- Un presidio che dipende da una risorsa che non controlli (apt source, memoria dell'operatore) **cede in silenzio** appena quella cambia.
- Il contratto del seam (7×2) e il conteggio token (6/12) vengono dalla **misura** (diff del build, contrasto WCAG), non dall'ispezione a vista né dalla lista di scope.
- Togliere a un test la dipendenza dalla quiete (waiter espliciti) invece di inseguirla con segnali parziali: deterministico batte "ridotto".

## Prossimi passi

1. **P3 — vernice A su tutto il restaurant** (dashboard inclusa, uniforme). Estetica scelta: **A · Servizio** = sistema di base (le ore), **C · Turno** = dark/KDS, **B · Sala** = layer di brand food. Le 4 leggi del design system (ADR-0083) sono la checklist di review di ogni PR visiva. Seam per-tenant previsto-e-vuoto, trigger scritto.
2. **P4 — ritocco delle 12 primitive esistenti** (unica fase non isolabile: 79 file, 2 app), ultima, con baseline visual-regression come strumento.
3. ~~**Deploy design + P2**~~ — ✅ **eseguito il 2026-07-30** (finestra S21, `cf0e521` su tutti e 4 i servizi). Rollback point applicato come passo bloccante ([ADR-0086](../architecture/ADR-0086-rollback-point-coppia-bloccante.md)) e GATE permessi eseguito in forma manuale (60/60 su 4 tenant, pre e post). Subito dopo: **`TD-prepush-hook-blocca-tag`**, poi si pubblicano insieme i 4 tag `deploy/*` oggi solo locali.
4. **Note Spese** (5 PR specced, ri-validare la spec per drift prima di costruire), **GroqService extraction**, **AI-pilot food**, **Cassa pre-fiscale RT** (differito a cliente reale) — per il piano a lungo termine.

## Convenzioni operative (invariate)

- Merge = `gh pr merge --squash --delete-branch` **da terminale Code**, dopo "vai" esplicito di Nicolò. MAI da UI. (La riga-indice stale in MEMORY.md che diceva "da UI" è stata corretta questa sessione.)
- `gh pr create` e `gh pr merge` sono turni separati; non ripetere un comando rifiutato uguale.
- `git add` sempre selettivo, mai `-A`.
- STOP-gate: STOP 0 read-only → STOP 1 lockato → STOP 2 self-check con riga "impatto sull'altro verticale: verificato/N.A." per PR su superfici condivise.
- HANDOFF e PROGRESS sono **due PR docs separate** (log vs stato di chiusura), via PR docs dedicata (`docs/...`, commit `docs(...): ...`, PR + CI verde + squash — NO push diretto, il pre-push hook ADR-0004 lo blocca).
- L'header _Ultimo aggiornamento / Fase corrente_ di PROGRESS è stale da giugno per convenzione: allinearlo è una decisione a sé, non un effetto collaterale di altre PR.
