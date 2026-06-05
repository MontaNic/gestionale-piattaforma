-- ============================================================
-- 57_comunicazioni_snooze.sql
-- Aggiunge il supporto "snooze" alle comunicazioni (campi già usati
-- dal controller e dall'admin detail page, ma mai propagati allo schema).
--
-- Colonne:
--   snoozed_until DATETIME NULL  -- se valorizzato e futuro: ticket "in pausa"
--   snoozed_by    INT NULL       -- operatore che ha messo in snooze
-- Indice:
--   idx_snoozed (snoozed_until)
--
-- Idempotente: usa INFORMATION_SCHEMA per skip se già presenti.
-- Eseguibile su tutti i tenant attivi (no-op per chi ce le ha già).
-- ============================================================

-- ── snoozed_until ────────────────────────────────────────────
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'comunicazioni'
             AND COLUMN_NAME  = 'snoozed_until');
SET @s := IF(@c = 0,
    'ALTER TABLE comunicazioni ADD COLUMN snoozed_until DATETIME NULL DEFAULT NULL AFTER auto_chiusa_motivo',
    'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── snoozed_by ───────────────────────────────────────────────
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'comunicazioni'
             AND COLUMN_NAME  = 'snoozed_by');
SET @s := IF(@c = 0,
    'ALTER TABLE comunicazioni ADD COLUMN snoozed_by INT NULL DEFAULT NULL AFTER snoozed_until',
    'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── indice idx_snoozed ──────────────────────────────────────
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'comunicazioni'
             AND INDEX_NAME   = 'idx_snoozed');
SET @s := IF(@c = 0,
    'ALTER TABLE comunicazioni ADD INDEX idx_snoozed (snoozed_until)',
    'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
