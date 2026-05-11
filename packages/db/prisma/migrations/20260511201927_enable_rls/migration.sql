-- =============================================================================
-- enable_rls — Row Level Security ATTIVO con policy placeholder permissiva
-- =============================================================================
-- Scopo: predisporre il binario "RLS on/off" su tutte le tabelle multi-tenant
-- prima che arrivi la auth NestJS reale. Le POLICY sono placeholder
-- (USING (true)) -> non isolano i dati per tenant adesso, ma il framework
-- e' pronto: quando NestJS impostera' `SET app.tenant_id = '<uuid>'` per
-- transaction, basta sostituire la policy con il check reale (vedi TODO).
--
-- Tabelle target (7 tenant-scoped):
--   tenants, sedi, users, roles, user_roles, sessions, audit_logs
--
-- Tabelle skip (4 globali o join globali):
--   permissions, system_role_templates, system_role_template_permissions,
--   role_permissions (join tenant-aware indiretto; rivalutare quando si
--   scriveranno policy reali — segnalato in ADR-0005 come follow-up)
--
-- Vedi ADR-0005 sezione "RLS strategy".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tenants
-- -----------------------------------------------------------------------------
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
-- TODO(F1 auth): replace with USING (id = current_setting('app.tenant_id')::uuid)
--                + admin bypass per Super Admin (BYPASSRLS o policy ad-hoc).
CREATE POLICY "tenants_policy" ON "tenants" USING (true);

-- -----------------------------------------------------------------------------
-- sedi
-- -----------------------------------------------------------------------------
ALTER TABLE "sedi" ENABLE ROW LEVEL SECURITY;
-- TODO(F1 auth): replace with USING (tenant_id = current_setting('app.tenant_id')::uuid)
CREATE POLICY "sedi_policy" ON "sedi" USING (true);

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
-- TODO(F1 auth): replace with USING (tenant_id = current_setting('app.tenant_id')::uuid)
CREATE POLICY "users_policy" ON "users" USING (true);

-- -----------------------------------------------------------------------------
-- roles
-- -----------------------------------------------------------------------------
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
-- TODO(F1 auth): replace with USING (tenant_id = current_setting('app.tenant_id')::uuid)
CREATE POLICY "roles_policy" ON "roles" USING (true);

-- -----------------------------------------------------------------------------
-- user_roles (no tenant_id diretto: filtra via JOIN con roles.tenant_id)
-- -----------------------------------------------------------------------------
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
-- TODO(F1 auth): replace with USING (EXISTS (
--   SELECT 1 FROM "roles" r WHERE r.id = user_roles.role_id
--     AND r.tenant_id = current_setting('app.tenant_id')::uuid
-- ))
CREATE POLICY "user_roles_policy" ON "user_roles" USING (true);

-- -----------------------------------------------------------------------------
-- sessions (no tenant_id diretto: filtra via JOIN con users.tenant_id)
-- -----------------------------------------------------------------------------
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
-- TODO(F1 auth): replace with USING (EXISTS (
--   SELECT 1 FROM "users" u WHERE u.id = sessions.user_id
--     AND u.tenant_id = current_setting('app.tenant_id')::uuid
-- ))
CREATE POLICY "sessions_policy" ON "sessions" USING (true);

-- -----------------------------------------------------------------------------
-- audit_logs
-- -----------------------------------------------------------------------------
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
-- TODO(F1 auth): replace with USING (tenant_id = current_setting('app.tenant_id')::uuid)
--                Direzione e admin sede vedono audit della propria sede;
--                Super Admin vede tutto via bypass.
CREATE POLICY "audit_logs_policy" ON "audit_logs" USING (true);
