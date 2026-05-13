#!/bin/bash
# =============================================================================
# 01-create-app-role.sh — Bootstrap del role applicativo per RLS (D3b)
# =============================================================================
# Crea il role `gestionale_app` (NOSUPERUSER, NOBYPASSRLS) al primo avvio del
# container Postgres con volume vuoto. Idempotente via IF NOT EXISTS.
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
# Setup richiesto in docker-compose.dev.yml:
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

# psql --set fa binding sicuro come :'name' literal (escape automatico).
# Niente injection: la password non viene mai interpolata in shell quote.
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set app_db_password="$APP_DB_PASSWORD" \
  <<-'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestionale_app') THEN
    -- :'app_db_password' viene espanso da psql come SQL literal quoted+escaped.
    EXECUTE format(
      'CREATE ROLE gestionale_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT',
      :'app_db_password'
    );
    RAISE NOTICE 'gestionale_app role created (NOSUPERUSER, NOBYPASSRLS)';
  ELSE
    RAISE NOTICE 'gestionale_app role already exists - skip';
  END IF;
END
$$;
EOSQL

echo "01-create-app-role.sh: done"
