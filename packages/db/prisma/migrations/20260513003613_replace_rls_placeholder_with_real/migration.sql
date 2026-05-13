-- =============================================================================
-- replace_rls_placeholder_with_real — D3b activation (security enforcement)
-- =============================================================================
-- Sostituisce le 7 policy placeholder `<table>_policy USING(true)` con policy
-- reali tenant-scoped + Super Admin bypass app-side. Aggiunge FORCE ROW LEVEL
-- SECURITY su tutte le 7 tabelle: senza, il table owner (postgres) bypasserebbe
-- RLS by design — superuser ALWAYS bypassa, ma anche un non-superuser owner
-- senza FORCE skippa (rolforcerowsecurity).
--
-- Pattern policy (decisione 3 + 5 + 7 + 8 ADR-0009):
--   - Standard (tenant_id diretto, 5 tabelle): is_super_admin OR tenant_id match
--   - user_roles: EXISTS join su roles (no tenant_id colonna diretta)
--   - sessions: EXISTS join su users (no tenant_id colonna diretta)
--
-- Naming (decisione 5 ADR-0009): da `<table>_policy` (placeholder)
-- a `<table>_tenant_isolation` (reale, espressivo, ammette future policy
-- multiple per tabella).
--
-- ⚠️ NO ::uuid cast: `tenant_id` e' TEXT in DB (Prisma String mapping).
-- Confronto text-to-text. Scoperto a STOP 1 D3a.
--
-- Settings letti: app.tenant_id (TEXT), app.is_super_admin ('true'|'false').
-- Settati per-operation tx dall'extension RLS (vedi packages/db/src/rls.ts).
-- `current_setting(name, true)` con missing_ok=true ritorna NULL se non settato;
-- NULL = any -> NULL -> false -> row excluded (fail-safe by PostgreSQL).
--
-- Rollback (NON eseguito automaticamente, commento di reference):
--   DROP POLICY tenants_tenant_isolation ON tenants;
--   CREATE POLICY tenants_policy ON tenants USING (true);
--   -- ... ripeti per le altre 6 tabelle ...
--   ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
--   -- ... ripeti per le altre 6 tabelle ...
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tenants — colonna `id` (root entity)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenants_policy" ON "tenants";
CREATE POLICY "tenants_tenant_isolation" ON "tenants"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR id = current_setting('app.tenant_id', true)
  );
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- sedi — colonna `tenant_id` diretta
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "sedi_policy" ON "sedi";
CREATE POLICY "sedi_tenant_isolation" ON "sedi"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
ALTER TABLE "sedi" FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- users — colonna `tenant_id` diretta
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "users_policy" ON "users";
CREATE POLICY "users_tenant_isolation" ON "users"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- roles — colonna `tenant_id` diretta
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "roles_policy" ON "roles";
CREATE POLICY "roles_tenant_isolation" ON "roles"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- user_roles — no tenant_id diretta, EXISTS join su roles.tenant_id
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_roles_policy" ON "user_roles";
CREATE POLICY "user_roles_tenant_isolation" ON "user_roles"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "roles"
      WHERE "roles"."id" = "user_roles"."role_id"
        AND "roles"."tenant_id" = current_setting('app.tenant_id', true)
    )
  );
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- sessions — no tenant_id diretta, EXISTS join su users.tenant_id
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "sessions_policy" ON "sessions";
CREATE POLICY "sessions_tenant_isolation" ON "sessions"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "users"
      WHERE "users"."id" = "sessions"."user_id"
        AND "users"."tenant_id" = current_setting('app.tenant_id', true)
    )
  );
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- audit_logs — colonna `tenant_id` diretta (NOT NULL, verificato a STOP 0 D3a)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "audit_logs_policy" ON "audit_logs";
CREATE POLICY "audit_logs_tenant_isolation" ON "audit_logs"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
