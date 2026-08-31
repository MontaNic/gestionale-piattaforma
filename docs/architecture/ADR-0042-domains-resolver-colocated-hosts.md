# ADR-0042 — Modello domini/sottodomini + host co-locati di terzi fuori dal git di prodotto

- **Status:** Accepted
- **Date:** 2026-06-19
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** ADR-0041 (HTTPS wildcard ACME — questo ADR formalizza ciò che gira _dietro_ quel cert), ADR-0001 (Caddy come container), `PROJECT_BRIEF.md` §B5 (tenant `<slug>.dominio`), §A3 (Caddy + auto-SSL)

## Context

[ADR-0041](ADR-0041-acme-wildcard-cloudflare.md) ha messo HTTPS wildcard reale su `studiodesk.cloud` + `*.studiodesk.cloud` (cert Let's Encrypt, DNS-01 Cloudflare). Dietro il proxy, al momento dell'ADR-0041, c'era solo un placeholder `respond 200`.

Nelle settimane successive il server ha iniziato a ospitare app **co-locate** non appartenenti al gestionale: i verticali "game" della famiglia (Lumimondo Adventure, Superpang, Music). Sono container che girano sullo stesso host, raggiunti dal Caddy del gestionale via DNS docker sulla rete condivisa `web`, serviti come `adventure|superpang|music.studiodesk.cloud` sotto il cert wildcard già emesso.

Questo ha creato due problemi da formalizzare:

1. **Manca un modello esplicito** di come domini/sottodomini mappano sulle superfici servite, e di cosa sta _dentro_ vs _fuori_ dal resolver applicativo del gestionale.
2. **Host di terzi finivano nel git di prodotto.** I vhost co-locati (con credenziali `basic_auth` di terzi e nomi-container non-di-prodotto) erano scritti inline nel `Caddyfile` versionato. Viola il principio "il repo del gestionale descrive il prodotto gestionale", e mette credenziali altrui nella storia git.

Inoltre, durante il lavoro infra è emerso un **gotcha di mount** (vedi sotto) che va documentato per non ripeterlo.

## Decision

### 1. Modello domini / sottodomini / resolver / superfici

- **Dominio di prodotto:** `studiodesk.cloud`. L'apex e i sottodomini `*.studiodesk.cloud` sono serviti da **un solo** site block Caddy, sotto i due cert (apex + wildcard) di ADR-0041.
- **Superfici del gestionale** (tenant `<slug>.studiodesk.cloud`, app `api`/`web` quando containerizzate) sono — o saranno — risolte dal **resolver applicativo** del gestionale: routing multi-tenant, RLS, RBAC. Oggi dietro il proxy c'è ancora il placeholder; la sostituzione con `reverse_proxy` verso i service della `gestionale_network` è un task separato (richiede containerizzare api/web).
- **Fuori dal resolver:** gli host co-locati di terzi (verticale "game"/Lumimondo). Decisione già presa il **14/06**: questi NON passano dal resolver/multi-tenancy del gestionale — sono reverse-proxy diretti verso container indipendenti, con la sola protezione `basic_auth` a livello di gateway. Non hanno tenant, non toccano il DB del gestionale, non condividono la `gestionale_network` (solo la rete `web`).

### 2. Pattern "host co-locati → snippet import-ato e gitignored"

Gli host co-locati di terzi **non entrano nel git di prodotto**. Concretamente:

- I loro vhost (`@adventure`/`@superpang`/`@music` + `handle` + `basic_auth` + `reverse_proxy`) vivono in uno **snippet separato** `infra/caddy/conf/colocated.adventure.caddy`, **gitignored** (pattern `infra/caddy/conf/colocated.*.caddy`).
- Il `Caddyfile` **committato** contiene solo: config gestionale (TLS, HSTS) + la direttiva `import colocated.*.caddy` + il `handle` di fallback. Nessun host di terzi, nessuna credenziale altrui versionata.
- Il bind-mount di ADR-0041 monta l'**intera dir** `infra/caddy/conf/` → lo snippet vive su disco nel container ed è caricato a runtime, pur non essendo in git.
- **Adventure è il caso motivante** di questo pattern, ma il pattern vale per qualunque host co-locato: superpang e music sono già nello stesso snippet.

### 3. Glob tollerante per la resilienza su host pulito (DP2)

L'`import` usa un **glob** (`import colocated.*.caddy`), non un path letterale. Motivo verificato empiricamente su Caddy **v2.11.4**:

| Forma                                  | Snippet assente | Esito                                                                       |
| -------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| `import ./colocated.caddy` (letterale) | sì              | **Errore** `File to import not found` → config non adatta → Caddy non parte |
| `import colocated.*.caddy` (glob)      | sì              | **No-op** → `Valid configuration`, Caddy parte                              |

Così un `git clone` + deploy su host pulito **senza** lo snippet non rompe: il glob matcha zero file, l'import è un no-op, Caddy serve solo gestionale + fallback. Niente file `.example` placeholder da committare e mantenere, niente step di copia manuale. Lo snippet va creato a mano sull'host quando si vogliono (ri)attivare i vhost co-locati — alla pari della rete `web` external (vedi §5).

### 4. Mount-stale: discovery, fix, prevenzione (DP4)

- **Discovery:** durante ADR-0041 il bind-mount di un **singolo file** legava l'inode → le riscritture dell'editor non erano viste dal container (`caddy reload` continuava a servire la versione vecchia). Risolto già in ADR-0041 montando la **directory** `infra/caddy/conf/`.
- **Fix residuo osservato in questa sessione:** sostituendo/ricreando la dir `conf/` sotto un container già in esecuzione, il mount può puntare a un inode stale finché il container non viene ricreato.
- **Prevenzione (scelta: runbook, no re-architettura — YAGNI):** non si introduce un named volume. Si documenta la regola operativa: se si sostituisce la directory `conf/` sotto il container, ricreare il container, non solo `reload`:
  ```
  docker compose -f docker-compose.dev.yml -f docker-compose.prod.yml up -d --force-recreate caddy
  ```
  Per le **normali modifiche al contenuto** dei file dentro `conf/` (incluso lo snippet) basta invece il reload a caldo:
  ```
  docker exec gestionale_caddy caddy reload --config /etc/caddy/Caddyfile
  ```

### 5. Note operative

- **Rete `web` external — one-time su host pulito.** Il servizio `caddy` (in `docker-compose.prod.yml`) è connesso a `gestionale_network` + `web`; `web` è `external: true`: la sua vita non è legata al compose. Su un host nuovo va creata una tantum **prima** del primo `up`:
  ```
  docker network create web
  ```
  È la stessa rete a cui si connette il container co-locato (es. `lumimondo-adventure`), che NON pubblica porte host (raggiungibile solo via `web` dal reverse proxy → niente bypass della basic_auth).
- **Ordine al deploy del refactor:** il refactor SPOSTA i 3 vhost nello snippet. Al deploy, lo snippet `colocated.adventure.caddy` deve esistere su disco **prima** del reload, altrimenti il glob lo ignora silenziosamente e i 3 host smettono di rispondere (fallback 200 al loro posto). ⚠️ Questo fallimento è **silenzioso a livello di config**: `caddy validate` resta `Valid` anche con lo snippet assente (il glob è un no-op legale), quindi la validate **non** lo intercetta. L'unico modo per accorgersene è un **probe HTTP** sui 3 host dopo il reload: se rispondono `200 "HTTPS it works"` invece di `401`, lo snippet non è stato caricato.
- **TODO backup `caddy_data`** (ribadito da ADR-0041): il volume contiene i certificati wildcard _veri_; perderlo = riemissione + consumo rate-limit LE. Da includere nello script di backup F1.

## Consequences

### Positive

- **Repo == prodotto.** Il git del gestionale non contiene più host, container-name o credenziali di terzi. Superficie di leak ridotta.
- **Resilienza host pulito.** Clone + deploy non rompe se lo snippet manca (glob no-op).
- **Modello esplicito** di cosa sta dentro/fuori il resolver: i co-locati sono reverse-proxy diretti, non tenant.

### Negative / Trade-off

- **Snippet fuori da git = fuori dal versioning.** Lo stato reale dei vhost co-locati non è tracciato dalla storia del repo di prodotto: va gestito a mano sull'host (accettabile, non è codice di prodotto). Il backup dell'host resta l'unica copia.
- **Step manuale al provisioning.** Su host pulito vanno creati a mano sia la rete `web` sia lo snippet co-locato. Documentato nel runbook qui sopra.

### Neutral

- Il fallback `handle { respond 200 }` resta versionato: è comportamento del gateway gestionale (apex + tenant non ancora dietro proxy), non un host co-locato (DP1).

## Considered Alternatives

### 1. Vhost co-locati inline nel Caddyfile committato (stato pre-ADR)

- ❌ Mette host e credenziali di terzi nel git di prodotto. È esattamente il problema che l'ADR risolve.

### 2. `import` di path letterale + `colocated.caddy.example` committato placeholder

- ❌ Reintroduce l'import letterale (che su file assente è errore hard) e richiede un file morto nel repo + uno step di copia manuale. Il glob tollerante ottiene lo stesso risultato senza placeholder.

### 3. Named volume al posto del bind-mount dir (per il mount-stale)

- ❌ Re-architettura non necessaria (YAGNI): aggiunge complessità di backup/migrazione del volume. Il bind-mount della directory + il runbook `--force-recreate` risolvono già il problema.

### 4. Host co-locati dietro il resolver multi-tenant del gestionale

- ❌ Non sono tenant del gestionale: non hanno modello dati, RLS, RBAC. Forzarli nel resolver introdurrebbe accoppiamento tra prodotto e app di terzi. Reverse-proxy diretto + basic_auth è il confine giusto.

## Notes

- Snippet co-locato (gitignored): `infra/caddy/conf/colocated.adventure.caddy` — contiene adventure + superpang + music.
- Caddyfile committato: config gestionale + `import colocated.*.caddy` + fallback.
- Verifica config valida: `docker exec gestionale_caddy caddy validate --config /etc/caddy/Caddyfile` (NB: passa anche con glob vuoto).
- Verifica che i co-locati siano caricati: probe HTTP sui 3 host (atteso `401`, non `200`).

## Update 2026-08-31 — `food.studiodesk.cloud` diventa un redirect (PR1/6)

Con la rimozione del verticale ristorazione non c'è più alcun upstream dietro
`food.studiodesk.cloud`. Il site block **non è stato cancellato**: è stato
sostituito da un `redir https://studiodesk.cloud{uri} permanent`.

Cancellarlo sarebbe stato peggio che lasciarlo rotto. Il DNS ha un **wildcard `A`
su `*.studiodesk.cloud`** che deve restare (serve i tenant dell'accountant),
quindi non esiste un record `food` da rimuovere: senza site block l'host
ricadrebbe sul wildcard e verrebbe servito da `accountant-web`. E `accountant-web`
**non fallisce** su un host che non conosce — il suo routing tenant è path-based
(`/t/<slug>/...`) e `middleware.ts` non legge mai l'`Host`: `GET /` risponde 200 e
reindirizza al login di `studio-demo`, sotto l'hostname sbagliato. **Uno stato che
risponde è peggio di un errore.**

Il blocco è collocato **prima** del wildcard nel file. Caddy ordina per
specificità e l'host esatto vincerebbe comunque — verificato con `caddy adapt`,
che genera `[0] host=[food.studiodesk.cloud] → static_response` e
`[1] host=[studiodesk.cloud, *.studiodesk.cloud] → reverse_proxy` — ma tenere
l'ordine di precedenza anche nel file evita che una lettura veloce concluda il
contrario. Conservati il blocco `tls` esplicito (un site block per host esatto fa
partire la gestione del certificato per quel nome; DNS-01 dietro Cloudflare è più
affidabile di HTTP-01/TLS-ALPN, e il certificato è già nel volume `caddy_data`) e
l'header HSTS.

### 🆕 `TD-dns-wildcard-accountant` — tier BASSO, registrato non risolto

Il wildcard DNS fa sì che **qualunque** sottodominio di `studiodesk.cloud` risolva
e arrivi all'accountant, che risponde 200 su ogni hostname inventato
reindirizzando al login del tenant di default. Non è una falla di isolamento (il
tenant si decide dal path, non dall'host, e RLS/RBAC restano interi) ma è una
superficie che nessuno ha scelto: espone la stessa applicazione sotto infiniti
nomi, e rende impossibile distinguere «host previsto» da «host qualsiasi».

Emerso mentre si decideva il destino di `food.` — è la ragione per cui quel
redirect è necessario. **Non risolto qui di proposito**: la risposta sta nel
Caddyfile (un site block esplicito per gli host previsti + un fallback che chiude
gli altri) oppure nel middleware, ed è una decisione di modello dei domini, non
una riga da infilare in una PR di rimozione.

**Trigger:** il primo tenant reale servito su un proprio sottodominio, oppure la
prima volta che serve distinguere gli host previsti dal resto.
