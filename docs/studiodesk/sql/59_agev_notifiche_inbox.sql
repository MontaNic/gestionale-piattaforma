-- ============================================================
-- 59_agev_notifiche_inbox.sql
--
-- Estende agevolazioni_monitoraggi_notifiche per trasformarla
-- da semplice log delle email inviate a "inbox notifiche per
-- l'operatore di studio":
--   - letta_at        DATETIME NULL  → marker click "Vista"
--   - archiviata_at   DATETIME NULL  → marker click "Archivia"
--   - circolare_id    INT NULL       → link alla circolare bozza
--                                       generata dall'operatore
--                                       (per non rifare le cose due volte)
--
-- Idempotente.
-- ============================================================

-- letta_at
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'agevolazioni_monitoraggi_notifiche'
             AND COLUMN_NAME  = 'letta_at');
SET @s := IF(@c = 0,
    'ALTER TABLE agevolazioni_monitoraggi_notifiche ADD COLUMN letta_at DATETIME NULL DEFAULT NULL AFTER esito',
    'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- archiviata_at
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'agevolazioni_monitoraggi_notifiche'
             AND COLUMN_NAME  = 'archiviata_at');
SET @s := IF(@c = 0,
    'ALTER TABLE agevolazioni_monitoraggi_notifiche ADD COLUMN archiviata_at DATETIME NULL DEFAULT NULL AFTER letta_at',
    'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- circolare_id (link alla circolare bozza generata)
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'agevolazioni_monitoraggi_notifiche'
             AND COLUMN_NAME  = 'circolare_id');
SET @s := IF(@c = 0,
    'ALTER TABLE agevolazioni_monitoraggi_notifiche ADD COLUMN circolare_id INT NULL DEFAULT NULL AFTER archiviata_at',
    'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Indice "inbox": query principale è "non lette/non archiviate"
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'agevolazioni_monitoraggi_notifiche'
             AND INDEX_NAME   = 'idx_inbox');
SET @s := IF(@c = 0,
    'ALTER TABLE agevolazioni_monitoraggi_notifiche ADD INDEX idx_inbox (archiviata_at, letta_at, data_invio)',
    'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
