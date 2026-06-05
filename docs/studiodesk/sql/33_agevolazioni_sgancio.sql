-- migrations/33_agevolazioni_sgancio.sql
-- Sgancio di un'azienda dal modulo Agevolazioni.
-- L'azienda esce dai conteggi/KPI/cron del modulo ma resta nell'anagrafica.
-- Per 30 giorni puo' essere riagganciata. Dopo, il cleanup elimina cache/storico.
-- Idempotente.

DELIMITER //
DROP PROCEDURE IF EXISTS _add_agev_sgancio_col//
CREATE PROCEDURE _add_agev_sgancio_col(IN c VARCHAR(80), IN def TEXT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende' AND COLUMN_NAME = c) THEN
        SET @sql = CONCAT('ALTER TABLE aziende ADD COLUMN ', c, ' ', def);
        PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;
END//
DELIMITER ;

CALL _add_agev_sgancio_col('agev_sganciata_at',    'DATETIME NULL DEFAULT NULL');
CALL _add_agev_sgancio_col('agev_motivo_sgancio',  'VARCHAR(255) NULL');
CALL _add_agev_sgancio_col('agev_sganciata_da',    'INT NULL');

-- Indice per query veloci sulle aziende attive nel modulo
SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende' AND INDEX_NAME = 'idx_az_agev_sgancio');
SET @sql := IF(@idx_exists = 0, 'ALTER TABLE aziende ADD INDEX idx_az_agev_sgancio (agev_sganciata_at)', "SELECT 'idx exists' AS skip");
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

DROP PROCEDURE _add_agev_sgancio_col;
