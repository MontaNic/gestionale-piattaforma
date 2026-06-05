-- ============================================================
-- @target: master
-- FILE: migrations/61_fic_billing.sql
--
-- Integrazione Fatture in Cloud (TeamSystem) per fatturare i
-- tenant studi della piattaforma StudioDesk.
--
-- Composta da:
--   1) Estensione tabella studios con anagrafica fiscale + map FIC
--   2) platform_billing_settings  (singleton, token OAuth cifrati)
--   3) platform_billing_subscriptions (1 riga per piano/studio)
--   4) platform_billing_invoices  (cache fatture emesse)
--   5) platform_billing_events    (log eventi webhook + chiamate API)
--
-- Idempotente: usa INFORMATION_SCHEMA per skippare colonne/indici/tabelle
-- già presenti.
-- ============================================================

-- ── 1) studios: anagrafica fiscale + map FIC ────────────────────

-- ragione_sociale
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'ragione_sociale');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN ragione_sociale VARCHAR(255) NULL AFTER nome', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- partita_iva
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'partita_iva');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN partita_iva VARCHAR(20) NULL AFTER ragione_sociale', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- codice_fiscale
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'codice_fiscale');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN codice_fiscale VARCHAR(16) NULL AFTER partita_iva', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sede_indirizzo
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'sede_indirizzo');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN sede_indirizzo VARCHAR(255) NULL AFTER codice_fiscale', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sede_cap
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'sede_cap');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN sede_cap VARCHAR(10) NULL AFTER sede_indirizzo', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sede_citta
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'sede_citta');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN sede_citta VARCHAR(100) NULL AFTER sede_cap', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sede_provincia
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'sede_provincia');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN sede_provincia VARCHAR(5) NULL AFTER sede_citta', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sede_nazione
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'sede_nazione');
SET @s := IF(@c = 0, "ALTER TABLE studios ADD COLUMN sede_nazione VARCHAR(3) NOT NULL DEFAULT 'IT' AFTER sede_provincia", 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sdi_codice (Codice Destinatario SDI per fatturazione elettronica)
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'sdi_codice');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN sdi_codice VARCHAR(7) NULL AFTER sede_nazione', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- pec_email
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'pec_email');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN pec_email VARCHAR(255) NULL AFTER sdi_codice', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- fatturazione_email (override email destinatario fattura; fallback su email referente)
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'fatturazione_email');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN fatturazione_email VARCHAR(255) NULL AFTER pec_email', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- fic_client_id (id del cliente in Fatture in Cloud)
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND COLUMN_NAME = 'fic_client_id');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD COLUMN fic_client_id BIGINT NULL AFTER fatturazione_email', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- index su fic_client_id (per lookup reverse dal webhook)
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'studios' AND INDEX_NAME = 'idx_studios_fic_client');
SET @s := IF(@c = 0, 'ALTER TABLE studios ADD INDEX idx_studios_fic_client (fic_client_id)', 'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ── 2) Singleton settings con token cifrati ─────────────────────

CREATE TABLE IF NOT EXISTS platform_billing_settings (
    id                TINYINT(1) NOT NULL PRIMARY KEY DEFAULT 1,
    fic_company_id    BIGINT NULL,
    fic_company_name  VARCHAR(255) NULL,
    access_token      VARBINARY(2048) NULL,
    refresh_token     VARBINARY(2048) NULL,
    token_iv          VARBINARY(16) NULL,
    token_expires_at  DATETIME NULL,
    sandbox           TINYINT(1) NOT NULL DEFAULT 0,
    dry_run           TINYINT(1) NOT NULL DEFAULT 1,
    iva_default       DECIMAL(5,2) NOT NULL DEFAULT 22.00,
    iva_natura        VARCHAR(10) NULL,
    regime_fiscale    VARCHAR(10) NOT NULL DEFAULT 'RF01',
    scadenza_gg       INT NOT NULL DEFAULT 30,
    metodo_pag        VARCHAR(50) NOT NULL DEFAULT 'TP02',
    iban_bonifico     VARCHAR(34) NULL,
    intestatario_conto VARCHAR(255) NULL,
    nome_banca        VARCHAR(255) NULL,
    invia_email       TINYINT(1) NOT NULL DEFAULT 1,
    auto_invia        TINYINT(1) NOT NULL DEFAULT 0,
    numerazione       VARCHAR(20) NOT NULL DEFAULT '/STUDIODESK',
    last_refresh_at   DATETIME NULL,
    last_error        TEXT NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- riga singleton (id=1) se manca
INSERT IGNORE INTO platform_billing_settings (id, dry_run) VALUES (1, 1);


-- ── 3) Sottoscrizioni studi ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_billing_subscriptions (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    studio_id           INT NOT NULL,
    piano               ENUM('base','pro','enterprise') NOT NULL,
    addon_agevolazioni  TINYINT(1) NOT NULL DEFAULT 0,
    addon_whatsapp      TINYINT(1) NOT NULL DEFAULT 0,
    addon_dms_mirror    TINYINT(1) NOT NULL DEFAULT 0,
    prezzo_mensile      DECIMAL(10,2) NOT NULL,
    sconto_pct          DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    ciclo               ENUM('mensile','annuale') NOT NULL DEFAULT 'mensile',
    iva_pct             DECIMAL(5,2) NOT NULL DEFAULT 22.00,
    decorrenza          DATE NOT NULL,
    prossima_emissione  DATE NOT NULL,
    giorno_emissione    TINYINT NOT NULL DEFAULT 1,
    stato               ENUM('attiva','sospesa','disdetta') NOT NULL DEFAULT 'attiva',
    disdetta_at         DATETIME NULL,
    note                TEXT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_billsub_studio FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE,
    INDEX idx_billsub_prossima (stato, prossima_emissione),
    INDEX idx_billsub_studio (studio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 4) Fatture emesse (cache locale + cursor su FIC) ────────────

CREATE TABLE IF NOT EXISTS platform_billing_invoices (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    studio_id           INT NOT NULL,
    subscription_id     INT NULL,
    fic_doc_id          BIGINT NOT NULL,
    numero              VARCHAR(50) NOT NULL,
    data_emissione      DATE NOT NULL,
    data_scadenza       DATE NULL,
    periodo_da          DATE NULL,
    periodo_a           DATE NULL,
    importo_imponibile  DECIMAL(10,2) NOT NULL,
    importo_iva         DECIMAL(10,2) NOT NULL,
    importo_totale      DECIMAL(10,2) NOT NULL,
    stato               ENUM('bozza','inviata','vista','pagata','scaduta','stornata') NOT NULL DEFAULT 'bozza',
    pagata_at           DATETIME NULL,
    pdf_url             VARCHAR(500) NULL,
    payload_json        JSON NULL,
    is_dry_run          TINYINT(1) NOT NULL DEFAULT 0,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_billinv_fic_doc (fic_doc_id),
    CONSTRAINT fk_billinv_studio FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE RESTRICT,
    CONSTRAINT fk_billinv_sub FOREIGN KEY (subscription_id) REFERENCES platform_billing_subscriptions(id) ON DELETE SET NULL,
    INDEX idx_billinv_stato_scad (stato, data_scadenza),
    INDEX idx_billinv_studio_data (studio_id, data_emissione),
    INDEX idx_billinv_dry (is_dry_run, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 5) Log eventi webhook + chiamate API (dedup via UNIQUE) ────

CREATE TABLE IF NOT EXISTS platform_billing_events (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    tipo         VARCHAR(50) NOT NULL,
    fic_doc_id   BIGINT NULL,
    dedupe_key   VARCHAR(128) NULL,
    payload_json JSON NULL,
    esito        ENUM('ok','err','dup') NOT NULL,
    errore       TEXT NULL,
    ip           VARCHAR(45) NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_billevt_dedupe (dedupe_key),
    INDEX idx_billevt_tipo_data (tipo, created_at),
    INDEX idx_billevt_doc (fic_doc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── Grants per portal_master_user ───────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_master.platform_billing_settings      TO 'portal_master_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_master.platform_billing_subscriptions TO 'portal_master_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_master.platform_billing_invoices      TO 'portal_master_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_master.platform_billing_events        TO 'portal_master_user'@'localhost';
FLUSH PRIVILEGES;
