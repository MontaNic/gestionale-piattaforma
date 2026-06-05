-- ============================================================
-- FILE: migrations/55_wizard_snooze.sql
-- Wizard onboarding: snooze + reset.
-- Aggiunge colonna `wizard_state.snoozed_until` (DATETIME NULL).
-- Quando valorizzata e > NOW(), il banner non viene mostrato.
-- Quando l'utente clicca "Riapri" da impostazioni, done/skipped/
-- snoozed_until vengono azzerati ma step_corrente + state_json
-- restano (no perdita di progressi).
--
-- Idempotente.
-- ============================================================

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wizard_state'
               AND COLUMN_NAME = 'snoozed_until');
SET @sql := IF(@col = 0,
    'ALTER TABLE wizard_state ADD COLUMN snoozed_until DATETIME NULL DEFAULT NULL AFTER skipped',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wizard_state'
               AND INDEX_NAME = 'idx_wiz_snooze');
SET @sql := IF(@idx = 0,
    'ALTER TABLE wizard_state ADD INDEX idx_wiz_snooze (user_id, snoozed_until)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
