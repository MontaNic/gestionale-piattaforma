-- ============================================================
-- 58_schema_migrations.sql
-- Tabella di tracking delle migration applicate a questo schema.
-- Usata dal runner bin/migrate-tenants.php per applicare solo
-- le migration non ancora presenti, e per fare l'audit di quando
-- ciascuna è stata applicata.
--
-- Convivente su:
--   - portal_master (tracking migration master)
--   - portal_<slug> (tracking migration tenant)
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    filename   VARCHAR(160) NOT NULL,
    sha256     CHAR(64)     NULL,
    applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes      VARCHAR(255) NULL,
    UNIQUE KEY ux_sm_filename (filename),
    KEY idx_sm_applied (applied_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
