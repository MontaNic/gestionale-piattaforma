-- ============================================================
-- 29_maintenance_mode.sql
--
-- Migrazione master.
--
-- Aggiunge il "maintenance mode" a 2 livelli, indipendenti:
--   - Piattaforma  (landing www.studiodesk.cloud + /platform/*)
--                  → chiave in platform_settings
--   - Singolo tenant (studio specifico per slug)
--                  → colonne sulla tabella studios
--
-- Vantaggio di tenere il flag tenant nel master (non nel DB del tenant):
-- si può mettere uno studio in manutenzione anche se il suo DB tenant
-- è offline / in restore / in migrazione di schema.
--
-- Il superadmin (e l'admin in ispezione) bypassa sempre la pagina di
-- manutenzione. Lo controlla l'helper MaintenanceMode in PHP.
--
-- Idempotente: rilanciabile in sicurezza.
-- ============================================================

USE portal_master;

-- (1) Flag piattaforma: 2 chiavi in platform_settings (active + message).
INSERT INTO platform_settings (chiave, valore, updated_by)
VALUES ('maintenance_active', '0', NULL),
       ('maintenance_message', NULL, NULL)
ON DUPLICATE KEY UPDATE valore = valore;

-- (2) Per ogni studio: maintenance_active + maintenance_message.
-- ALTER guard per essere rilanciabile.
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'portal_master'
     AND TABLE_NAME   = 'studios'
     AND COLUMN_NAME  = 'maintenance_active'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE studios ADD COLUMN maintenance_active TINYINT(1) NOT NULL DEFAULT 0 AFTER attivo, ADD COLUMN maintenance_message TEXT NULL AFTER maintenance_active',
  'SELECT ''maintenance cols already exist'' AS skipped'
);
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
