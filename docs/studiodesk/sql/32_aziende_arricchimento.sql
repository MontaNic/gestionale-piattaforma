-- migrations/32_aziende_arricchimento.sql
-- Colonne per cache dati arricchiti via OpenAPI.com (o input manuale).
-- Idempotente: usa information_schema per skip se gia' presenti.

DELIMITER //
DROP PROCEDURE IF EXISTS _add_az_col//
CREATE PROCEDURE _add_az_col(IN c VARCHAR(80), IN def TEXT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende' AND COLUMN_NAME = c) THEN
        SET @sql = CONCAT('ALTER TABLE aziende ADD COLUMN ', c, ' ', def);
        PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;
END//
DELIMITER ;

CALL _add_az_col('forma_giuridica',   'VARCHAR(120) NULL');
CALL _add_az_col('dimensione_impresa','ENUM("micro","piccola","media","grande") NULL');
CALL _add_az_col('numero_dipendenti', 'INT NULL');
CALL _add_az_col('fatturato_annuo',   'DECIMAL(15,2) NULL');
CALL _add_az_col('cap',               'VARCHAR(10) NULL');
CALL _add_az_col('indirizzo',         'VARCHAR(255) NULL');
CALL _add_az_col('arricchito_at',     'TIMESTAMP NULL');
CALL _add_az_col('arricchito_fonte',  'VARCHAR(40) NULL');

DROP PROCEDURE _add_az_col;
