-- migrations/36_bandi_filtri_estesi.sql
-- Aggiunge campi filtrabili a portal_master.bandi + tabella segnalazioni in master.

USE portal_master;

DELIMITER //
DROP PROCEDURE IF EXISTS _add_bandi_col//
CREATE PROCEDURE _add_bandi_col(IN c VARCHAR(80), IN def TEXT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bandi' AND COLUMN_NAME = c) THEN
        SET @sql = CONCAT('ALTER TABLE bandi ADD COLUMN ', c, ' ', def);
        PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;
END//
DELIMITER ;

CALL _add_bandi_col('tipo_bando', "ENUM('a_sportello','a_graduatoria','click_day','misto') NULL");
CALL _add_bandi_col('cumulabile', "TINYINT(1) NULL");   -- NULL=sconosciuto, 1=yes, 0=no
CALL _add_bandi_col('tipo_investimento', "VARCHAR(120) NULL");
CALL _add_bandi_col('emanazione', "VARCHAR(120) NULL"); -- es. "MIMIT", "Regione Toscana", "EU Commission"

DROP PROCEDURE _add_bandi_col;

-- Tabella segnalazioni bandi mancanti (in master perche' i bandi sono pubblici)
CREATE TABLE IF NOT EXISTS bandi_segnalazioni (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    studio_id       INT NULL,                        -- da portal_master.studios.id
    studio_slug     VARCHAR(64) NULL,
    user_email      VARCHAR(255) NULL,
    user_nome       VARCHAR(120) NULL,
    titolo_bando    VARCHAR(500) NOT NULL,
    url_bando       VARCHAR(500) NULL,
    ente            VARCHAR(255) NULL,
    note            TEXT NULL,
    stato           ENUM('nuova','in_lavorazione','aggiunta','rifiutata') NOT NULL DEFAULT 'nuova',
    risposta        TEXT NULL,
    aggiunto_bando_id INT NULL,                      -- se aggiunto, FK logica a bandi.id
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at    TIMESTAMP NULL,
    INDEX idx_stato (stato),
    INDEX idx_studio (studio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

GRANT SELECT, INSERT, UPDATE, DELETE ON portal_master.bandi_segnalazioni TO 'portal_master_user'@'localhost';
FLUSH PRIVILEGES;
