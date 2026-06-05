-- ============================================================
-- FILE: migrations/11_backup.sql
-- Aggiunge metadata di backup alla tabella studios (master DB).
-- Da applicare SOLO su portal_master, non sui tenant.
-- ============================================================

ALTER TABLE studios
    ADD COLUMN last_backup_at      DATETIME NULL DEFAULT NULL,
    ADD COLUMN last_backup_size    BIGINT   NULL DEFAULT NULL,
    ADD COLUMN last_backup_status  ENUM('never','running','ok','failed') NOT NULL DEFAULT 'never',
    ADD COLUMN last_backup_error   VARCHAR(500) NULL DEFAULT NULL;

-- ── Master schema notes ─────────────────────────────────────
-- Usato dal cron bin/cron-backup-tenant.php (03:00 daily) per
-- tracciare l'ultima esecuzione + dal pannello superadmin
-- /superadmin/sistema (widget "Stato backup").
