-- ============================================================
-- FILE: migrations/52_pannello_azienda.sql
-- Rifacimento pannello "La mia azienda" (lato cliente).
-- Vedi: docs/prompt-pannello-azienda.md
--
-- 1) Nuove colonne operative su `aziende` (auto-modificabili dall'admin azienda)
-- 2) Tabella `aziende_modifiche_log` per audit delle modifiche admin-azienda
-- 3) Tabella `aziende_referenti` per ruoli formali (legale rapp., ammin., ecc.)
--
-- Tutto idempotente — riapplicabile su tenant già esistenti senza errori.
-- ============================================================

-- ── 1. Nuove colonne su `aziende` ─────────────────────────────
-- Campi che l'admin azienda può modificare in autonomia (telefono secondario,
-- email operativa distinta da PEC, sito web, note interne). NON intaccano i
-- campi fiscali immutabili (codice, ragione sociale, P.IVA, CF).

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende'
               AND COLUMN_NAME = 'telefono_2');
SET @sql := IF(@col = 0,
    'ALTER TABLE aziende ADD COLUMN telefono_2 VARCHAR(40) NULL DEFAULT NULL AFTER telefono',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende'
               AND COLUMN_NAME = 'email_operativa');
SET @sql := IF(@col = 0,
    'ALTER TABLE aziende ADD COLUMN email_operativa VARCHAR(255) NULL DEFAULT NULL AFTER pec',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende'
               AND COLUMN_NAME = 'sito_web');
SET @sql := IF(@col = 0,
    'ALTER TABLE aziende ADD COLUMN sito_web VARCHAR(255) NULL DEFAULT NULL AFTER email_operativa',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende'
               AND COLUMN_NAME = 'note_operative');
SET @sql := IF(@col = 0,
    'ALTER TABLE aziende ADD COLUMN note_operative TEXT NULL DEFAULT NULL AFTER sito_web',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. Audit delle modifiche fatte dall'admin azienda ─────────
-- Una riga per ogni campo modificato (no JSON blob: query più semplici).
-- Visibile lato studio in /admin/aziende; in futuro anche all'admin azienda
-- come storico delle proprie modifiche (decisione aperta).

CREATE TABLE IF NOT EXISTS aziende_modifiche_log (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id  INT NOT NULL,
    user_id     INT NOT NULL,
    campo       VARCHAR(60)  NOT NULL,
    valore_pre  TEXT NULL,
    valore_post TEXT NULL,
    ip          VARCHAR(45) NULL,
    user_agent  VARCHAR(255) NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_aml_azienda (azienda_id, created_at),
    INDEX idx_aml_user (user_id, created_at),
    CONSTRAINT fk_aml_azienda FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE,
    CONSTRAINT fk_aml_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Referenti aziendali ────────────────────────────────────
-- Ruoli formali dell'azienda cliente (legale rappresentante, responsabile
-- amministrativo, referente tecnico, altro). Possono essere dipendenti
-- collegati (user_id) oppure persone esterne (form libero).

CREATE TABLE IF NOT EXISTS aziende_referenti (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id  INT NOT NULL,
    user_id     INT NULL,
    nome        VARCHAR(150) NOT NULL,
    ruolo       ENUM('legale_rappresentante','amministrativo','tecnico','altro') NOT NULL DEFAULT 'altro',
    email       VARCHAR(255) NULL,
    telefono    VARCHAR(40)  NULL,
    note        VARCHAR(255) NULL,
    attivo      TINYINT(1) NOT NULL DEFAULT 1,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ar_azienda (azienda_id, attivo),
    INDEX idx_ar_ruolo (ruolo),
    CONSTRAINT fk_ar_azienda FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE,
    CONSTRAINT fk_ar_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Tracking ultimo accesso per visibilità lato admin azienda ────
-- Aggiunge users.last_login_at (già tracciato in user_disponibilita.last_seen
-- ma non per i clienti). Più semplice e affidabile farne uno dedicato qui.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
               AND COLUMN_NAME = 'last_login_at');
SET @sql := IF(@col = 0,
    'ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL DEFAULT NULL AFTER attivo, ADD INDEX idx_u_last_login (last_login_at)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
