-- ============================================================
-- FILE: migrations/22_backup_duration.sql
-- Aggiunge durata dell'ultimo backup (in secondi) per il widget
-- "Stato backup" del pannello superadmin.
-- Da applicare SOLO su portal_master, non sui tenant.
-- ============================================================

ALTER TABLE studios
    ADD COLUMN last_backup_duration_sec INT UNSIGNED NULL DEFAULT NULL
    AFTER last_backup_size;
