-- =============================================================================
-- tighten_app_role_attributes — D3b defense in depth (role attribute symmetry)
-- =============================================================================
-- Allinea gli attributi del role `gestionale_app` tra le 2 source-of-truth:
--   - Migration `create_app_role_and_grants` (creava LOGIN NOSUPERUSER NOBYPASSRLS)
--   - Docker init `infra/postgres/init/01-create-app-role.sh` (creava anche
--     NOCREATEDB NOCREATEROLE NOINHERIT)
--
-- Asimmetria scoperta a STOP 7 D3b. Funzionalmente entrambe le strade sono safe
-- per RLS, ma defense in depth richiede simmetria: il role app NON deve mai
-- poter creare DB/role/ereditare gruppi privilegiati.
--
-- ALTER ROLE e' idempotente: nessun errore se gli attributi sono gia' settati
-- ai valori target. Tutta la migration e' safe da rieseguire.
--
-- Pattern adottato (decisione D3b STOP 7): NON modificare la migration
-- esistente (immutability principle), ma aggiungere ALTER incrementale.
--
-- Rollback (NON eseguito automaticamente, commento di reference):
--   ALTER ROLE gestionale_app CREATEDB CREATEROLE INHERIT;
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestionale_app') THEN
    ALTER ROLE gestionale_app NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    RAISE NOTICE 'gestionale_app role missing — skip tighten (will inherit from create_app_role_and_grants)';
  END IF;
END
$$;
