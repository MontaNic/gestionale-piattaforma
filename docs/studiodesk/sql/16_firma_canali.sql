-- ============================================================
-- 16_firma_canali.sql
-- Predispone canali multipli per la firma documenti via OTP.
--
-- Aggiunge:
--   - users.telefono_verificato_at: opzionale, segna quando il numero
--     è stato verificato (per ora non bloccante; placeholder per fase 2)
--   - documenti_firme.canale: traccia attraverso quale canale è stato
--     inviato/ricevuto il codice OTP della firma
--
-- I settings tenant (provider SMS, API key, ecc.) usano la tabella
-- `impostazioni` esistente — nessuna modifica schema lì.
-- ============================================================

-- 1. users.telefono_verificato_at (idempotente con stored procedure trick)
SET @sql_check_col = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'users'
              AND COLUMN_NAME = 'telefono_verificato_at'
        ),
        'SELECT 1',
        'ALTER TABLE users ADD COLUMN telefono_verificato_at DATETIME NULL AFTER telefono'
    )
);
PREPARE stmt FROM @sql_check_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. documenti_firme.canale
SET @sql_check_col2 = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'documenti_firme'
              AND COLUMN_NAME = 'canale'
        ),
        'SELECT 1',
        "ALTER TABLE documenti_firme ADD COLUMN canale ENUM('email','sms','voice') NOT NULL DEFAULT 'email' AFTER tentativi"
    )
);
PREPARE stmt FROM @sql_check_col2;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
