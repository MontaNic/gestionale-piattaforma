# ADR-0001 — Caddy come container, non come servizio host

- **Status:** Accepted
- **Date:** 2026-05-11
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** `PROJECT_BRIEF.md` §A2 (principio "Multi-tenant strict, modulare, riproducibile"), §A3 (stack tecnico vincolante: Caddy), §C8 (deployment Ubuntu 22.04)

## Context

Il brief fissa Caddy come reverse proxy con gestione automatica dei certificati Let's Encrypt
(§A3, §C5, §C8). Resta aperta una scelta di delivery: installare Caddy come servizio
nativo sul host Ubuntu (`apt install caddy`) o eseguirlo in un container all'interno dello
stesso `docker-compose` che orchestra il resto dello stack (api, web, kds, postgres, redis,
minio, meilisearch, unleash).

Entrambe le strade soddisfano il vincolo "usa Caddy". La decisione discrimina:

- riproducibilità dell'ambiente (dev/staging/prod)
- pulizia del filesystem host
- backup e portabilità
- accoppiamento con il ciclo di vita degli altri servizi
- esperienza di tuning low-level

## Decision

**Caddy viene eseguito come container all'interno del `docker-compose`**, alla pari degli
altri servizi infrastrutturali. La sua configurazione (`Caddyfile`) e i suoi dati persistenti
(certificati Let's Encrypt, OCSP staples, autosave) vivono in bind mount + volumi named
gestiti da Compose.

Nessuna installazione di Caddy sul host. Il host ospita solo: Docker Engine, sshd, ufw,
fail2ban, l'agente di backup. Niente di applicativo.

## Consequences

### Positive

- **Stack autocontenuto e riproducibile**: `docker compose up` ricrea l'intera topologia di
  rete e dipendenze, incluso il reverse proxy. Coerente con il criterio di accettazione F1
  §D.1 del brief ("setup completo via `docker compose up` su Ubuntu 22.04 pulito").
- **Host pulito e portabile**: la migrazione del server (Hetzner → altrove, o upgrade
  Ubuntu) richiede solo `docker volume` + `Caddyfile` + immagine taggata. Niente
  configurazione `/etc/caddy/` da replicare a mano.
- **Versioning esplicito**: la versione di Caddy è inchiodata nell'immagine
  (`caddy:2-alpine`). Aggiornamenti volontari e rollback banali (`docker compose pull` +
  `up -d` o tag precedente). Niente sorprese da `apt upgrade`.
- **Networking coerente**: Caddy parla agli upstream (api, web, kds) tramite la rete
  Docker interna usando i nomi dei servizi come hostname — niente `127.0.0.1:porta` con
  conflitti di porte sull'host.
- **Convenzione interna**: tutto ciò che è "infrastruttura applicativa" sta in Compose;
  tutto ciò che è "sistema operativo" sta in `/etc/`. Demarcazione netta.

### Negative / Trade-off

- **Backup deve includere i volumi Caddy** (`caddy_data` e `caddy_config`), altrimenti la
  perdita del server causa la riemissione di nuovi certificati Let's Encrypt (con rate
  limit). Da formalizzare nello script di backup quando F1 inizierà ad emettere certificati
  veri.
- **Tuning low-level non standard** (es. `ulimit -n`, sysctl, network mode `host`) richiede
  configurazione esplicita nel servizio Compose, non semplice editing di unit systemd. In
  pratica nel nostro target di carico (5-30 sedi, ~300 utenti concorrenti — §A2.12) non è
  un problema.
- **Avvio leggermente più lento del bare-metal** (overhead container minimale, irrilevante
  in pratica con `live-restore: true` configurato nel daemon).

### Neutral

- Le porte 80/443 sull'host sono mappate al container Caddy. Nessun altro processo dovrà
  occupare quelle porte sul host. Tra gli avvenire: se servirà un secondo servizio HTTPS
  diretto sull'host (improbabile), si valuterà allora.
- In ambiente dev attuale (Caddy mappato su `8080:80`, niente SSL/Let's Encrypt) la scelta
  è priva di trade-off: produce un placeholder identico in struttura a quello che farà in
  prod.

## Considered Alternatives

### 1. Caddy installato sul host via `apt`

- ✅ Lifecycle gestito da systemd (riavvii puliti, log via journalctl).
- ❌ Stato di configurazione e certificati in `/etc/caddy/` e `/var/lib/caddy/` — fuori
  dal repo, fuori da Compose, da gestire con tooling separato (Ansible, file `cron` di
  backup dedicato).
- ❌ Split del concetto "stack applicativo": parte in Compose, parte sull'host. La FAQ
  "dov'è la config X" raddoppia in superficie.
- ❌ Aggiornamenti via `apt` rischiano di disallineare versione tra dev (container) e
  prod (host).

### 2. Nginx sul host

- ❌ Costa un altro processo manuale per gestire SSL (Certbot + auto-renew + reload).
- ❌ Viola il vincolo del brief §A3 ("Reverse Proxy: Caddy").

### 3. Nginx in container

- ❌ Viola il vincolo del brief §A3.

### 4. Traefik in container

- ✅ Discovery automatico via label Docker, comodo in alcuni scenari multi-app.
- ❌ Viola il vincolo del brief §A3.
- ⚠️ Config via label sparse nei singoli `docker-compose` è più rumorosa di un singolo
  `Caddyfile` quando il numero di route resta basso.

## Notes

- La scelta è del 2026-05-11 ed è stata formalizzata prima di scrivere il primo
  `docker-compose.dev.yml`. Il file di scoperta storica è
  [PROGRESS.md](../../PROGRESS.md) (sezione "Decisioni prese durante setup").
- Quando comparirà un dominio reale, aggiungere ADR-0002 che definisce strategia ACME
  (DNS challenge vs HTTP challenge), wildcard policy, e backup specifico di `caddy_data`.
