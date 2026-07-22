#!/bin/bash
# =============================================================================
# 01-create-app-role.sh — Bootstrap del role applicativo per RLS (D3b)
# =============================================================================
# Crea il role `gestionale_app` (NOSUPERUSER, NOBYPASSRLS) al primo avvio del
# container Postgres con volume vuoto. Idempotente (create solo se assente).
#
# `docker-entrypoint-initdb.d/*.sh` gira SOLO al primo bootstrap quando
# /var/lib/postgresql/data e' vuoto. Su volume esistente (dev ricorrente,
# upgrade in-place) lo script non viene eseguito -> per quei casi la migration
# Prisma `create_app_role_and_grants` crea il role (placeholder password) +
# l'operatore esegue ALTER ROLE per ruotare al valore reale (vedi README
# sezione "Database setup").
#
# Quando questo script gira (fresh volume): il role e' creato CON la password
# reale da $APP_DB_PASSWORD direttamente -> niente rotazione post-migration
# necessaria (l'IF NOT EXISTS della migration fa diventare il CREATE no-op).
#
# ─────────────────────────────────────────────────────────────────────────────
# FIX interpolazione (TD-dev-env-punta-prod Sub-B, discovery a runtime):
# la versione precedente metteva `:'app_db_password'` DENTRO un blocco
# `DO $$ … $$`. psql NON interpola `:var` dentro il dollar-quoting -> il CREATE
# ROLE falliva con "syntax error at or near :" e il role non veniva creato
# (poi lo creava la migration con la password PLACEHOLDER). Qui l'interpolazione
# avviene in un SELECT semplice (fuori da qualunque dollar-quote); `%L` quota la
# password in modo sicuro; `\gexec` esegue il CREATE solo se la SELECT ritorna
# una riga (WHERE NOT EXISTS -> idempotente). Post-check fail-loud in coda.
# ─────────────────────────────────────────────────────────────────────────────
#
# Setup richiesto in docker-compose(.devdb).yml:
# - environment: APP_DB_PASSWORD: ${APP_DB_PASSWORD}
# - volumes:     ./infra/postgres/init:/docker-entrypoint-initdb.d:ro
#
# Vedi ADR-0009 sezione "D3b — Activation" + README sezione "Database setup".
# =============================================================================
set -euo pipefail

if [[ -z "${APP_DB_PASSWORD:-}" ]]; then
  echo "ERROR: APP_DB_PASSWORD env var required (set in docker-compose)" >&2
  exit 1
fi

# psql --set espone :'app_db_password' come SQL literal quoted+escaped.
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set app_db_password="$APP_DB_PASSWORD" \
  <<-'EOSQL'
	-- Costruisce il CREATE ROLE come stringa (%L quota la password) SOLO se il
	-- role e' assente: WHERE NOT EXISTS -> 0 righe se gia' presente -> \gexec
	-- no-op = idempotente. :'app_db_password' e' in un SELECT semplice, FUORI da
	-- qualunque dollar-quoting -> psql lo interpola correttamente (vedi header).
	SELECT format(
	  'CREATE ROLE gestionale_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT',
	  :'app_db_password'
	)
	WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestionale_app')
	\gexec
EOSQL

# Fail-loud: dopo il blocco il role DEVE esistere con gli attributi attesi.
# La versione rotta falliva in silenzio (container healthy, role assente); qui
# un init rotto ABORTA -> il container non diventa healthy, il bug non passa
# inosservato. `-tA` = tuples-only + unaligned -> output pulito '1' o vuoto.
role_ok="$(psql -tA -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -c "SELECT 1 FROM pg_roles WHERE rolname = 'gestionale_app' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls")"

if [[ "$role_ok" != "1" ]]; then
  echo "FATAL: gestionale_app assente o con attributi errati dopo l'init (bootstrap RLS non riuscito)" >&2
  exit 1
fi

echo "01-create-app-role.sh: done (gestionale_app verificato: LOGIN NOSUPERUSER NOBYPASSRLS)"
