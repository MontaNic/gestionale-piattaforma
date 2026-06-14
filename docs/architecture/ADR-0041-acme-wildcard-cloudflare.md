# ADR-0041 — Strategia ACME: wildcard via DNS-01 Cloudflare, build Caddy custom

- **Status:** Accepted
- **Date:** 2026-06-14
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** ADR-0001 (Caddy come container — questo ADR è quello "futuro" lì promesso), `PROJECT_BRIEF.md` §A3 (Caddy + auto-SSL), §B5 (tenant `<slug>.dominio`), §C8 (deployment)

## Context

[ADR-0001](ADR-0001-caddy-as-container.md) ("Notes") rimandava a un ADR successivo la
definizione della strategia ACME una volta comparso un dominio reale. È arrivato il momento:
mettiamo HTTPS sull'host di produzione (`gestionale-test`, Hetzner — IPv4 `178.105.56.116`,
IPv6 `2a01:4f8:1c18:f1c0::1`) sul dominio `studiodesk.cloud`, con DNS gestito su Cloudflare
(registrar Aruba, nameserver delegati a Cloudflare).

Vincoli che discriminano la scelta:

- Il brief (§B5) prevede tenant come `<slug>.studiodesk.cloud` → serve un **certificato
  wildcard** `*.studiodesk.cloud`, non un cert per host noto a priori.
- Let's Encrypt emette wildcard **solo** via challenge **DNS-01** (HTTP-01 non è ammesso per
  i wildcard).
- L'immagine ufficiale `caddy:2-alpine` **non** include i provider DNS: il modulo
  `dns.providers.cloudflare` va compilato nel binario.
- Il vecchio server StudioDesk usava già `*.studiodesk.cloud`; viene **dismesso** e il
  wildcard ripuntato su questo host.

## Decision

1. **Challenge DNS-01 con provider Cloudflare.** Caddy crea/rimuove i record TXT
   `_acme-challenge` via API Cloudflare. Il blocco `studiodesk.cloud, *.studiodesk.cloud`
   fa emettere a Caddy **due certificati distinti** (uno apex, uno wildcard); serve quello
   giusto in base all'SNI.

2. **Build Caddy custom via xcaddy.** [`infra/caddy/Dockerfile`](../../infra/caddy/Dockerfile)
   compila `github.com/caddy-dns/cloudflare` su `caddy:2.11` (builder + runtime stessa minor,
   tag pinnati per riproducibilità — coerente con il versioning esplicito di ADR-0001).

3. **Override di produzione dedicato.**
   [`docker-compose.prod.yml`](../../docker-compose.prod.yml) si applica _in aggiunta_ al base
   dev e cambia il solo servizio `caddy`: `build` al posto di `image`, porte `80/443` (+443/udp
   HTTP/3) con tag `!override` (rimpiazza, non concatena, la `8080:80` del dev),
   [`infra/caddy/conf/Caddyfile`](../../infra/caddy/conf/Caddyfile) al posto del placeholder. Il
   `docker-compose.dev.yml` resta intatto. La config è montata come **directory**
   (`./infra/caddy/conf:/etc/caddy`), non come singolo file: il bind-mount per-inode di un
   file non riflette le riscritture dell'editor nel container (`caddy reload` vedrebbe la
   versione vecchia) — montare la dir evita il problema.

4. **Segreti fuori dal repo.** `CF_API_TOKEN` (scope `Zone:DNS:Edit` + `Zone:Read` sulla zona
   `studiodesk.cloud`) e `ACME_EMAIL` vivono solo in `.env` (gitignored), iniettati nel
   container via env. Il Caddyfile li referenzia con `{env.CF_API_TOKEN}` /
   `{env.ACME_EMAIL}` — nessun valore in chiaro versionato. Il token NON transita dall'AI: lo
   crea e lo installa Nicolò.

5. **Validazione graduale.** Prima emissione contro la CA **Let's Encrypt staging**
   (`acme_ca` staging, commentato di default nel Caddyfile) per validare la catena senza
   intaccare i rate-limit di produzione (5 cert/settimana per dominio registrato); poi switch
   a LE produzione e verifica `curl https://`.

6. **DNS-only in avvio.** I record A/AAAA partono **non proxati** (grey cloud) per validare il
   certificato d'origine diretto; l'eventuale attivazione del proxy Cloudflare (orange +
   modalità Full strict) è una decisione successiva.

7. **HTTPS-only, mai HTTP in chiaro.** Requisito esplicito dell'owner. Caddy apre la :80
   solo per il redirect 308 → `https://` (`auto_https` default). In aggiunta serviamo l'header
   `Strict-Transport-Security: max-age=31536000; includeSubDomains` così i browser, dopo la
   prima visita, non tentano nemmeno più l'HTTP. `includeSubDomains` è sicuro perché tutti i
   tenant `*.studiodesk.cloud` sono serviti in HTTPS.

## Consequences

### Positive

- Wildcard reale → ogni `<slug>.studiodesk.cloud` è servito in HTTPS senza emissione
  per-host e senza esporre porta 80 al challenge (DNS-01 non la richiede).
- Pipeline TLS validata end-to-end (DNS → ACME → rinnovo automatico) **prima** di mettere le
  app dietro il proxy: de-risca il deploy applicativo vero.
- Nessun segreto nel repo; separazione netta di responsabilità (AI = plumbing, owner = token+DNS).

### Negative / Trade-off

- **Build custom da mantenere:** ad ogni bump di Caddy vanno riallineati i due tag nel
  Dockerfile e rifatta la build (non basta `docker compose pull`). Accettabile: è l'unico modo
  per avere il provider DNS nel binario.
- **Token Cloudflare = superficie sensibile:** deve essere scoped alla sola zona
  `studiodesk.cloud`; un token troppo ampio darebbe a Caddy potere su tutto l'account DNS.
- **Backup cert ancora più critico** (ribadisce ADR-0001 "Negative"): `caddy_data` contiene
  ora certificati _veri_ wildcard. Perderlo = riemissione e consumo rate-limit. Da includere
  nello script di backup F1.

### Neutral

- L'apex `studiodesk.cloud` è incluso nello stesso cert: comodo se servirà una landing.
- Dietro il proxy oggi c'è solo un placeholder; la sostituzione con `reverse_proxy` verso le
  app sarà un task separato (richiede la containerizzazione di api/web).

## Considered Alternatives

### 1. HTTP-01 challenge per host singoli

- ❌ Non supporta wildcard: servirebbe un cert per ogni tenant, con emissione al primo accesso
  e gestione della porta 80 esposta. Incompatibile con il modello `<slug>.dominio` del brief.

### 2. Immagine `caddy:2-alpine` stock

- ❌ Niente provider DNS → DNS-01 impossibile. Scartata per vincolo tecnico.

### 3. Certbot + Nginx sull'host

- ❌ Viola §A3 (Caddy) e ADR-0001 (proxy in container, host pulito).

### 4. Proxy Cloudflare (orange) come unico TLS edge, origine in HTTP

- ❌ "Flexible SSL" lascia in chiaro il tratto edge→origine ed è sconsigliato. Con DNS-01 Caddy
  ha comunque un cert valido in origine: si potrà passare a Full(strict) senza compromessi.

## Notes

- Comando di deploy prod:
  `docker compose -f docker-compose.dev.yml -f docker-compose.prod.yml up -d --build caddy`
- Prerequisito a carico dell'owner: token Cloudflare + `ACME_EMAIL` in `.env`, record A/AAAA di
  `studiodesk.cloud` e `*.studiodesk.cloud` ripuntati su questo host.
