-- =============================================================================
-- create_app_role_and_grants — D3b RLS activation infrastructure
-- =============================================================================
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 🚨 POST-MIGRATION REQUIRED 🚨                                             ║
-- ║                                                                           ║
-- ║   Subito dopo l'applicazione di questa migration, ROTARE la password     ║
-- ║   del role gestionale_app dalla PLACEHOLDER al valore reale di          ║
-- ║   $APP_DB_PASSWORD. Senza questo step, il role NON puo' loggare e        ║
-- ║   l'app fallisce all'avvio.                                              ║
-- ║                                                                           ║
-- ║   Comando (dev):                                                          ║
-- ║     psql "$DIRECT_URL" -c \                                              ║
-- ║       "ALTER ROLE gestionale_app PASSWORD '$APP_DB_PASSWORD'"            ║
-- ║                                                                           ║
-- ║   In staging/prod: il deploy pipeline DEVE includere questo step come    ║
-- ║   parte del bootstrap (es. helm hook / k8s init container / CI script).  ║
-- ║   Tech debt F2 (vedi ADR-0009): integrare secret manager (Vault /        ║
-- ║   AWS Secrets Manager) per evitare il pattern placeholder-then-rotate.   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Crea il role `gestionale_app` (NOSUPERUSER, NOBYPASSRLS) usato come
-- connection runtime dall'app NestJS (DATABASE_URL post-D3b). Le migration
-- continuano a usare il superuser `postgres` via DIRECT_URL (vedi schema.prisma
-- directUrl + .env DIRECT_URL).
--
-- Razionale role non-superuser: senza, RLS e' no-op perche' postgres bypassa
-- policy by design (rolsuper + rolbypassrls). Vedi ADR-0009 sezioni
-- "R9 — superuser bypassa RLS" + "D3b — Activation".
--
-- Razionale password placeholder: la migration SQL e' committata in git;
-- non e' safe embedded la password reale. Pattern "create with placeholder +
-- rotate via ALTER" mantiene la migration safe-to-commit + idempotenza. Per
-- fresh bootstrap dev: il docker init script
-- `infra/postgres/init/01-create-app-role.sh` crea il role con la password
-- reale prima che questa migration giri (l'IF NOT EXISTS sotto la fa
-- diventare no-op).
--
-- Rollback (NON eseguito automaticamente, commento di reference):
--   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM gestionale_app;
--   REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM gestionale_app;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM gestionale_app;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     REVOKE SELECT, USAGE ON SEQUENCES FROM gestionale_app;
--   REVOKE USAGE ON SCHEMA public FROM gestionale_app;
--   DROP OWNED BY gestionale_app;  -- safety
--   DROP ROLE gestionale_app;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Role lifecycle: CREATE IF NOT EXISTS (idempotente con docker init script)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestionale_app') THEN
    CREATE ROLE gestionale_app
      LOGIN
      PASSWORD 'PLACEHOLDER_MUST_BE_ROTATED'
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. GRANT permessi minimi: schema USAGE + DML su tutte le tabelle esistenti
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO gestionale_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gestionale_app;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO gestionale_app;

-- -----------------------------------------------------------------------------
-- 3. ALTER DEFAULT PRIVILEGES: future tabelle/sequenze create da postgres
--    erediteranno automaticamente i GRANT necessari per gestionale_app.
-- -----------------------------------------------------------------------------
-- ALTER DEFAULT PRIVILEGES e' specifico per il ruolo che crea oggetti.
-- Specifichiamo `FOR ROLE postgres` per essere espliciti (postgres e' il role
-- che esegue tutte le migration future via DIRECT_URL).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gestionale_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, USAGE ON SEQUENCES TO gestionale_app;
