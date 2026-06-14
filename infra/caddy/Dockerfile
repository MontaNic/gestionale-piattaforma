# Build custom di Caddy con il modulo DNS Cloudflare.
#
# Perché serve: l'immagine ufficiale `caddy:2-alpine` NON include i provider DNS.
# Per il challenge ACME DNS-01 (richiesto dai certificati wildcard *.studiodesk.cloud)
# Caddy deve poter creare/rimuovere record TXT _acme-challenge via API Cloudflare,
# e quel modulo va compilato dentro il binario con xcaddy. Vedi ADR-0041.
#
# Aggiornamento versione: bumpare i due tag `caddy:2.*` insieme (builder + runtime
# DEVONO essere la stessa minor) e rebuildare con `docker compose -f
# docker-compose.prod.yml build caddy`. Versioning esplicito come da ADR-0001.

# Pin esplicito alla minor (build riproducibile). Builder e runtime DEVONO
# restare sulla stessa minor. NB: evitare 2.8.x → mismatch zapslog con xcaddy.
FROM caddy:2.11-builder AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2.11-alpine

# Sostituisce il binario stock con quello che include dns.providers.cloudflare.
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
