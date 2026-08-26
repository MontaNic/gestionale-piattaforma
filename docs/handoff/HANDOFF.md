# HANDOFF — gestionale-piattaforma

**Snapshot:** `Main @ bac2ada (+1 commit docs(handoff) in arrivo via PR)`
**Chiusura sessione S22:** due blocchi chiusi in sequenza — **deploy design-seam + P2 in produzione** (`cf0e521` su tutti e 4 i servizi, primo SHA unico su entrambi i verticali) e **`TD-prepush-hook-blocca-tag`** (#199, `bac2ada`). Conseguenza diretta del secondo: i 4 tag `deploy/*` sono su `origin` e **`git ls-remote --tags origin` non è più vuoto per la prima volta nella storia del repo**.

---

# PARTE A — Cosa è successo e cosa significa

## Dove siamo

**Il loop restaurant `menu → tavoli → comande → KDS → cassa` è chiuso end-to-end, e la cassa è LIVE in produzione**, verificata nell'app reale (pagamento 201, guardia saldo D3 attiva, riepilogo IVA congelato esatto). È lo step di usabilità del piano a lungo termine: il verticale food è passato da demo a operabile in un servizio reale.

**Nota stato produzione (critica, non dimenticare):** NON ci sono clienti reali né dati di valore in prod. Tutto pre-lancio/demo. Il blast radius su superfici condivise ha stakes BASSI ora; "corruzione irrecuperabile" non è uno scenario reale finché non arrivano clienti. La disciplina STOP-gate/test resta utile come abitudine e rete PER QUANDO arriveranno, ma va calibrata sul rischio attuale (basso), non su uno immaginato.

### I due blocchi chiusi in sequenza

**1. Deploy design-seam (#189) + P2 (#190–#193) in produzione.**
`cf0e521` su tutti e 4 i servizi — **primo deploy con un SHA unico su entrambi i verticali**. Prima: `bc36e7d` restaurant, `f7b5d19` accountant. La domanda "cosa gira in produzione" ha una sola risposta per la prima volta.

**2. `TD-prepush-hook-blocca-tag` chiuso** — PR #199, `bac2ada`.
L'hook decideva sulla sola `HEAD` e ignorava stdin, quindi da `main` bloccava anche i tag. Ora blocca **se e solo se** un ref in push ha `refs/heads/main` come destinazione remota.

Il fix **non è simmetrico**, e va letto così:

- _allarga_: i push di `refs/tags/*` e di altri branch passano anche da `main`;
- _stringe_: il **delete di `main`** prima passava — si esegue da un'altra branch e l'hook guardava solo `HEAD` — ora è bloccato.

Chi legge solo la prima riga conclude "l'hook è diventato più permissivo" e si ferma lì. Non è così: la superficie protetta è cresciuta, non calata.

Conseguenza diretta: i 4 tag `deploy/*` sono stati pubblicati su `origin`, **da `main`, senza `--no-verify`**. La cronologia dei deploy è leggibile da git e non più solo da `PROGRESS.md`, dove gli SHA erano scritti in chiaro proprio perché i tag sarebbero spariti con la macchina.

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
| Hook `pre-push` — blocca `refs/heads/main`, non i push di tag                            | #199       | 0004 | (locale)     |

**Deployato in prod:** tutto quanto sopra fino a #195, a `cf0e521`. #199 tocca solo un hook locale e documentazione: nessun impatto sulle immagini.

## Il deploy — cosa è stato fatto

**Design seam + P2 (`cf0e521`, 2026-07-30).** Eseguito con STOP 0 → Fase 0 (pre-condizioni) → Fase 1 (rollback point) → Fase 2 (GATE pre-build) → Fase 3 (build) → Fase 4 (cutover) → Fase 5 (GATE post-deploy) → Fase 6 (chiusura docs, PR #198, `a08c0d7`).

Esiti: health 200 via Caddy su entrambi i verticali; separazione upstream provata con **rotte esclusive per verticale** (le rotte comuni non discriminano); log puliti; permessi **60/60 su 4 tenant** invariati; resa accountant misurata e identica in light e dark. Tre check autenticati — dashboard food con KPI reali, riepilogo pagamenti, sidebar nella pagina reale — **verificati manualmente da Nicolò, 2026-07-30**.

**Cassa (finestra precedente) — recap.** Migration additiva `20260726215242_add_pagamento_cassa` sul DB prod condiviso (`Pagamento` + RLS + colonna `riepilogo_iva_snapshot`). **Riconciliazione Super Admin** all'invariante `ALL_PERMISSION_CODES` (idempotente, via `DIRECT_URL`): ha portato `cassa.pagamento.registra` + i 3 `notespese.*` arretrati ai Super Admin materializzati. Ruoli operativi NON toccati. Primo rollback point vero: tag `deploy/s19-f7b5d19` + immagini `gestionale/restaurant-{api,web}:rollback-s19-f7b5d19`; migration e permessi additivi → rollback solo-container, nessun rollback DB.

## Presidi che hanno funzionato, con prova

- **Rollback point = coppia inseparabile** (tag espliciti sulle immagini + divieto di prune). Prova empirica non simulata: al build `:latest` è stato riassegnato e le 4 immagini vecchie sono rimaste ancorate **dal solo tag** — senza la Fase 1 sarebbero dangling. Prima del cutover il tag era ridondante (i container ancoravano gli ID), dopo il cutover il tag è l'unica cosa che tiene in vita il rollback, e il divieto è l'unica cosa che protegge il tag. **Due regimi attraversati in 24 ore.**
- **Fermarsi invece di aggiustare.** Il caso 3 della matrice `pre-push` è risultato verde al primo giro; sotto c'era il **no-op silenzioso di husky riprodotto per caso** (stessa dinamica dell'incidente del 12/05: gli script spariti dal working tree, il runner esce 0 senza dire nulla). Aggiustare a tentativi avrebbe nascosto un **terzo canale di bypass** dell'unica protezione di `main`. È finito nell'amendment di [ADR-0004](../architecture/ADR-0004-local-git-hooks.md), che è il posto dove serve.
- **Il nome di un file è un'asserzione.** Un `pg_dump` rieseguito dopo il cutover avrebbe prodotto un `…_pre-deploy-…` contenente lo stato **post**-deploy, indistinguibile per nome da quello legittimo. Un falso documentale nei backup è peggio di un backup mancante.

## Le lezioni della sessione (il filo comune)

**"Il verde dimostra meno di quanto sembra."** Quattro manifestazioni concrete:

1. La cassa sarebbe stata deployata read-only (403 su ogni pagamento) con CI e page-tour **verdi** — falliva con grazia. Presa dalla deploy-preflight.
2. Il `ValidationPipe` non valida i DTO in e2e — constraint verdi mai esercitati. Presa perché un test nuovo è fallito.
3. `report.operativo.visualizza` mancante su un ruolo materializzato pur avendolo il template — verificare **in DB, non nel seed**.
4. Il test single-flight passava su una race vinta, poi si è nascosto dietro un **job `success` con 1 flaky** (retry Playwright che maschera il primo tentativo). Regola operativa: **1 flaky non è verde; leggere la riga di riepilogo, non la conclusion.**

Corollario operativo: **la verifica empirica mirata batte il GATE**. Costruire le condizioni perché un check eserciti davvero il punto (utente Cameriere temporaneo + conti creati apposta, altrimenti la lista era vuota e il Badge non si renderizzava mai). E fare il **grep di chiusura sui residui E sulle assunzioni implicite**, non solo sui sentinel — `grep waitForURL.*dashboard` avrebbe trovato i 5 call-site di quiete prima del merge di #193. La domanda mancante: "chi altro assume che questa pagina sia ferma?".

### Il principio da portare avanti — lo strumento di verifica è codice non testato

**Quattro istanze, tutte della stessa forma: strumento di misura difettoso su sistema sano.** Le prime tre sono descritte per esteso qui sotto, la quarta è di questa sessione. Il principio che le unisce:

> **Prima di riportare una misura anomala, si verifica che la misura sia valida.** Lo strumento di verifica non è mai stato testato, e va trattato come tale: una sonda, un `head`, un pattern di `ls-remote`, l'ordinamento assunto in una matrice sono tutti codice che nessuno ha messo sotto prova.

**Asimmetria da tenere presente.** Un **rosso falso** costa un rollback ingiustificato — ci è quasi successo con la sidebar `accountant-web`. Un **verde falso** costa un bug in produzione. Entrambi i versi vanno rimisurati, ma **il verde falso è quello che nessuno va a ricontrollare spontaneamente**: il rosso ti obbliga a guardare, il verde ti autorizza a smettere.

Sta accanto a _"1 flaky non è verde"_ e _"leggi la riga di riepilogo, non la conclusion"_: tutte istanze di **un segnale accettato senza guardare cosa lo produceva**.

**Rettifiche di metodo (S21–S22) — quando è difettoso lo STRUMENTO di verifica, non il sistema verificato.**

1. **Sonda CSS — il tema si imposta PRIMA del caricamento, mai dopo.** Mutare `document.documentElement.className` a runtime produce **colori derivati stantii**: la custom property risolve già al valore dark (`--accent-soft` → `224.4 64.3% 32.9%`, verificato) e il selettore matcha (`el.matches('.dark *')` → `true`), ma `backgroundColor`/`color` restano ai valori **light**. In S21 questo ha prodotto un falso allarme sulla sidebar accountant che, se accettato, avrebbe portato al **rollback ingiustificato di `accountant-web`**. La misura va fatta su una pagina con `class="dark"` **già presente nell'HTML** — che è anche come l'app serve realmente la pagina, la classe c'è prima del primo paint. Con la forma statica i 4 valori sono risultati identici agli attesi. **Questa è la condizione al contorno che rende affidabile la tecnica del diff dei valori computati**: senza, la tecnica produce guasti immaginari.
2. **Verifica alla fonte ≠ verifica COMPLETA della fonte.** Un `head -60` su un file di **101 righe**, letto dalla fonte giusta (`docker exec … cat /etc/caddy/Caddyfile`), ha prodotto la conclusione falsa «il restaurant non è dietro Caddy» — presentata come verifica empirica perché la _fonte_ era quella giusta. Il vhost `food.` stava alle righe 68-101. Conseguenza: una superficie pubblica dichiarata coperta senza essere stata toccata. Regola: quando un output è troncato da `head`/`tail`/`| head -n`, la conclusione vale solo per la porzione letta — e su una fonte di verità (config, Caddyfile, schema) non si tronca mai.
3. **S22 — un test la cui premessa è assunta invece che verificata non è un test.** La matrice di efficacia del `pre-push` (#199) conteneva un caso «push misto tag + `main`», scritto per dimostrare che il fix non si ferma alla prima riga di stdin. Non lo dimostrava: **git ordina `refs/heads/*` prima di `refs/tags/*` a prescindere dall'ordine sulla command line**, quindi in quel push il ref protetto è sempre il primo e il caso sarebbe passato anche con un fix che guarda solo la prima riga. **Era un gate che non poteva diventare rosso** — cioè il difetto che si pretende di escludere su tutti gli altri gate, presente nel gate stesso. Il caso valido è un misto in cui il ref protetto **non** è primo (`feature/y` + `main`). Il difetto stava nella premessa della prova, non nel codice provato. Registrato anche nell'[amendment di ADR-0004](../architecture/ADR-0004-local-git-hooks.md#prova-di-efficacia), dove vive la matrice.
4. **S22 — `git ls-remote --tags origin refs/tags/<nome>` sopprime le righe `^{}`.** Nella verifica finale della pubblicazione dei tag, il confronto per-tag interrogava `origin` **con un pattern**: il dereference dei tag annotati non compariva, il confronto è caduto sul fallback e ha dato **MISMATCH su 3 tag su 4 perfettamente corretti**. Rimisurato sul listing integrale, catturato una volta sola e non troncato: 4/4 esatti. Se riportato senza rimisurare, avrebbe detto "i tag sono sull'oggetto sbagliato" di tag validi — e la rettifica giusta sarebbe stata cercata nel posto sbagliato. Nota che è la **stessa famiglia del caso 2**: un output che non contiene quello che credi, per una ragione che non hai verificato.

**Altri principi rafforzati:**

- Diff dei valori CSS computati > screenshot per i cambi di token (deterministico, nessuna baseline binaria). Ha trovato un letterale citato in un commento che Tailwind trasformava in CSS reale. **Vale solo con la condizione al contorno della rettifica 1 sopra.**
- Riconcilia all'**invariante**, non cherry-pick (Super Admin = `ALL_PERMISSION_CODES`).
- Un presidio che dipende da una risorsa che non controlli (apt source, memoria dell'operatore) **cede in silenzio** appena quella cambia.
- Il contratto del seam (7×2) e il conteggio token (6/12) vengono dalla **misura** (diff del build, contrasto WCAG), non dall'ispezione a vista né dalla lista di scope.
- Togliere a un test la dipendenza dalla quiete (waiter espliciti) invece di inseguirla con segnali parziali: deterministico batte "ridotto".

---

# PARTE B — Stato operativo

## Repo

| voce             | valore                                     |
| ---------------- | ------------------------------------------ |
| main             | `bac2ada`                                  |
| worktree         | pulito                                     |
| branch su origin | solo `main`                                |
| branch locali    | solo `main`                                |
| tag su origin    | 4 (`deploy/*`) — pubblicati **2026-07-30** |
| PR aperte        | nessuna                                    |

Tag `deploy/*` su `origin`: `deploy/prod-restaurant-bc36e7d`, `deploy/prod-accountant-f7b5d19`, `deploy/s19-f7b5d19` (**lightweight** — una riga sola in `ls-remote`, gli altri tre sono annotati e ne hanno due), `deploy/s21-cf0e521`.

## Produzione

`cf0e521` su `accountant-api`, `accountant-web`, `restaurant-api`, `restaurant-web`.

**Asimmetria da sapere al prossimo preflight:** `main` è avanti rispetto alle immagini di **sola documentazione**. «prod == main» è **falso**, ma il codice deployato è allineato. Il drift va quindi calcolato filtrando i path:

```bash
git log --oneline <SHA_PROD>..HEAD -- apps/ packages/
```

Se è vuoto, il codice è allineato anche se `main` è avanti. Leggerlo senza filtro porta a concludere "va ricostruito" quando non serve.

## ⚠️ Stato vivo fuori dal repo — non toccare

**Le 4 immagini `rollback-pre-design-*` non si toccano fino al prossimo deploy.**
Sono `unused` per Docker: **il tag è l'unica cosa che le tiene in vita**. Nessun `docker system prune`, `image prune -a`, `builder prune -a`, **per nessun motivo**. Se emerge pressione sullo spazio: **STOP**, si nomina cosa liberare una voce per volta.

Regola corretta (già in pratica, **da formalizzare nel runbook**): le immagini di rollback sopravvivono **finché il deploy successivo non ne crea di nuove** — finestra scorrevole di uno. Il marcatore «fino al merge della PR docs» scritto oggi nel runbook è **arbitrario** e va sostituito con questo.

Backup più recente: `gestionale_20260729T234520Z_pre-deploy-design-p2_cf0e521.dump` (288 134 B, PGDMP, `0600`).

## Registro TD (con trigger)

**✅ CHIUSO — `TD-deploy-perm-reconcile-gate`.** Il più vecchio, aveva morso **tre volte** (notespese S19, cassa S20, `Direzione` di Studio Ferretti S21). Il gate è ora `packages/db/scripts/check-role-permissions-drift.ts` (`pnpm --filter @gestionale/db check:role-perms`), cablato nel runbook al posto della prosa, con [amendment ad ADR-0066](../architecture/ADR-0066-sync-permessi-template-tenant-differito.md).

Tre cose che non si deducono dal diff:

- **La deriva era viva in produzione**, non ipotetica: `studio-demo / Collaboratore` senza `notespese.gestisci` — il residuo dichiarato-e-differito di S19, rimasto lì dal 23/07. Riconciliata in un turno a sé **prima** di introdurre il gate (`role_permissions` 261→262), così il gate nasce su un verde vero. Un baseline di eccezioni sarebbe stato il primo passo verso un gate che nessuno legge.
- **Il set atteso è derivabile dal codice per _ogni_ ruolo, non solo per il Super Admin** — tutti e 11 i template sono liste versionate. È ciò che rende il gate possibile; se `Collaboratore` e `Cliente` fossero curatele solo-DB, non sarebbero riconciliabili. Ed è **bloccante** perché i permessi di ruolo **non sono editabili dall'app** (zero consumer di `sistema.ruolo.*`): «diverso dal template» implica «sbagliato». Se nasce una UI ruoli quella proprietà cade — scritto nell'intestazione dello script, non solo nell'ADR.
- **Il vecchio presidio del runbook non avrebbe preso né S19 né S21**: guardava solo `Super Admin` e contava. Entrambi erano su ruoli operativi, e un conteggio che torna non prova che il set sia quello giusto.

Efficacia provata su **8 casi** in DB dev (`:55432`), ripetuti dopo ogni modifica al codice; il caso che conta è il **falso verde**: sabotando deliberatamente il `SET LOCAL`, C1–C4 diventano **tutti verdi** perché non c'è nulla da esaminare — solo l'asserzione "zero ruoli esaminati = rosso" lo intercetta.

**Aperti — minori:**

- `TD-registry-dentro-handoff` — **il registro TD vive dentro questo file**, quindi ogni registrazione di debito trascina `HANDOFF.md` in una PR e collide con la convenzione «HANDOFF e PROGRESS in PR separate». Va in un file suo (es. `docs/TECH-DEBT.md`). Trigger: prossima PR che registra un debito **e** ha ragioni di suo per non toccare HANDOFF.
- `TD-engines-node-vs-dockerfile` — i 4 Dockerfile usano `FROM node:22-alpine`, il `package.json` di root dichiara `">=20.18.0 <21"`. Preesistente, la produzione gira su Node 22 da sempre. Il problema è che **`engines` mente a chi lo legge** per scegliere la versione locale, e sviluppa contro un runtime diverso da quello di produzione.
- `TD-caddyfile-root-placeholder` — `./Caddyfile` (6 righe, zero menzioni del food) sembra la config di produzione e non lo è; quella reale è `./infra/caddy/conf/Caddyfile` (101 righe), versionata e bind-mounted **ro**. Chi legge il primo conclude il falso.
- `TD-backup-automation` — la procedura esiste, è versionata ed è provata (ha girato in S19 e S21; in `/home/deploy/backups` 3 dump con `.sha256`). Manca la **schedulazione**: `crontab -l` per `deploy` è vuoto, nessun `pg_dump` in `scripts/`/`.github/`/compose. La formulazione di [ADR-0079](../architecture/ADR-0079-storage-persistente-provenienza-immagini.md) §205 («non esiste alcun backup, nemmeno del DB») è **imprecisa e va rettificata**. Il `crontab` di `root` non è verificato (richiede sudo). Trigger: primo cliente reale.
- `TD-dev-env-punta-prod` — **quinta manifestazione**: `prisma:migrate:status` ha interrogato la **produzione** perché il root `.env` punta a `127.0.0.1:5432` (il dev è su `55432`), e **nulla nella forma del comando distingue un `migrate status` read-only da un `migrate reset`**. Era voluto ed era read-only: la sicurezza è venuta dall'operatore che sapeva cosa stava lanciando — cioè il presidio è nella sua memoria. Le altre quattro: quasi-incidente DB prod, divergenza template↔DB accountant, kill di un processo dentro un container durante pulizia dev, `docker-compose.prod.yml` non auto-consistente (la rete vive in `dev.yml`, il nome mente). Check concreto: risalire al `ppid` → `containerd-shim` = container.
- `TD-ci-e2e-testcontainers-be` — pre-sessione; verificare se resta scoperto qualcosa nella copertura comportamentale in CI.
- `TD-seed-non-ripulisce-rimossi` — il seed è additivo/idempotente ma **non cancella**: un permesso o un mapping template rimosso dal codice resta in DB per sempre. Il gate lo rileva (C1-bis) come **informativo**, non bloccante — rimuovere un privilegio è un'azione che va decisa, non automatizzata. Trigger: prima rimozione reale di un permesso dal catalogo.

**Aperti — trigger-gated:**

- `TD-conti-list-amounts` — trigger: il cassiere deve prioritizzare i conti per importo dall'index. `GET /conti` è flat, senza importi. (`statoPagamento` non è badgeabile sulla dashboard per lo stesso motivo.)
- `TD-dashboard-service-day` — trigger: cliente reale con servizi oltre mezzanotte. "Oggi" = giorno solare Europe/Rome, non giorno di servizio.
- `TD-visual-regression-net` — trigger: prima di P4 (ritocco primitive condivise). Ridotto: il **diff dei valori CSS computati** copre già i cambi di token in modo deterministico; la rete screenshot serve solo per il residuo (geometria, spaziatura, ritorni a capo).
- `TD-smoke-punta-solo-a-prod` — trigger: serve una smoke per-ruolo gatante in CI su codice non deployato → il `baseURL` (oggi sull'URL pubblico) va parametrizzato su istanza effimera dal branch.
- `TD-e2e-validationpipe-missing` — il harness E2E non esercita il `ValidationPipe`: nessun DTO `@Body` è validato in e2e. Trigger: un DTO con constraint di sicurezza/integrità entra in un path senza copertura unit equivalente.
- `TD-cassa-resto-drawer` — trigger: cliente chiede riconciliazione cassetto/fondo cassa. Il resto contanti non è modellato.
- `TD-cassa-chiusura-giornaliera` — trigger: pilota chiede riepilogo fine giornata (Z-report). `cassa.chiusura.giornaliera` resta orfano.

**Chiusi questa sessione:** `TD-ci-apt-external-dep` (#192), `TD-tailwind-config-dup` (#189), `TD-prepush-hook-blocca-tag` (#199).

Sul chiuso più recente, due cose che non si deducono dal diff:

- **La formulazione con cui era registrato era sbagliata.** Diceva «ADR-0004 vuole impedire i **commit** diretti su `main`»: la parola "commit", in quel senso, in ADR-0004 non c'è. L'ADR e [ADR-0002](../architecture/ADR-0002-branching-strategy.md) §38 parlano entrambi di **push**. Il fix non è quindi un'attuazione fedele della lettera, è una **restrizione dichiarata del suo oggetto** — registrata come [amendment datato in ADR-0004](../architecture/ADR-0004-local-git-hooks.md#amendment-2026-07-30--loggetto-protetto-è-refsheadsmain), non come patch silenziosa.
- **Ha chiuso di rimbalzo un item di backlog** — il «parsing stdin per distinguere push regolari da delete» in `PROGRESS.md`, che chiedeva esattamente questo comportamento. Chiuso nella stessa PR: un item senza più oggetto costa più di uno aperto, perché il prossimo che lo legge spende tempo su un problema risolto.

Efficacia provata su una matrice di **9 casi** in repo usa-e-getta, con lo stesso runner `sh -e` della produzione e il file reale sotto test — dettaglio nell'amendment. Verifica finale eseguita: 4 tag su `origin`, 7 righe in `ls-remote`, dereference dei 3 annotati confrontati con i commit noti e con gli oggetti locali.

## Prossimi passi

1. **P3 — l'estetica A, che è il SISTEMA DI BASE e non una vernice sul restaurant** (amendment ADR-0083 2026-08-24: neutri, tipografia e radii vivono nel condiviso, quindi P3 tocca **anche l'accountant**; il seam per-verticale porta solo accento e brand). Ordine: **PR0** promozione `StatCard` → **P3a** seam restaurant + adozione → **P3b-0** estinzione dei 94 letterali accountant (**prerequisito bloccante**) → **P3b** sistema di base su entrambi i verticali. **C · Turno** = dark/KDS, **B · Sala** = layer di brand food. Le 4 leggi del design system (ADR-0083) sono la checklist di review di ogni PR visiva. Seam per-tenant previsto-e-vuoto, trigger scritto.
2. **Branding per-verticale**, poi **estrazione `GroqService`** in `@gestionale/platform`.
3. **P4 — ritocco delle 12 primitive esistenti** (unica fase non isolabile: 79 file, 2 app), ultima, con baseline visual-regression come strumento.
4. **Note Spese** (5 PR specced, ri-validare la spec per drift prima di costruire), **AI-pilot food**, **Cassa pre-fiscale RT** (differito a cliente reale) — per il piano a lungo termine.

## Convenzioni operative (invariate)

- Merge = `gh pr merge --squash --delete-branch` **da terminale Code**, dopo "vai" esplicito di Nicolò. MAI da UI.
- `gh pr create` e `gh pr merge` sono turni separati; non ripetere un comando rifiutato uguale.
- `git add` sempre selettivo, mai `-A`.
- STOP-gate: STOP 0 read-only → STOP 1 lockato → STOP 2 self-check con riga "impatto sull'altro verticale: verificato/N.A." per PR su superfici condivise.
- HANDOFF e PROGRESS sono **due PR docs separate** (log vs stato di chiusura), via PR docs dedicata (`docs/...`, commit `docs(...): ...`, PR + CI verde + squash — NO push diretto, il pre-push hook ADR-0004 lo blocca).
- L'header _Ultimo aggiornamento / Fase corrente_ di PROGRESS è stale da giugno per convenzione: allinearlo è una decisione a sé, non un effetto collaterale di altre PR.
- Lo snapshot in testa a questo file si scrive in forma **anti-riferimento-circolare**: `Main @ <sha> (+N commit docs in arrivo via PR)`, mai citando la PR che lo introduce — sarebbe stale nell'istante del merge.
