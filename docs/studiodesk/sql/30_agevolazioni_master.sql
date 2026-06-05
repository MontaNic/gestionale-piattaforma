-- ============================================================
-- migrations/30_agevolazioni_master.sql
--
-- Modulo Agevolazioni - tabelle MASTER (portal_master).
-- I dati RNA e i bandi pubblici sono UGUALI per tutti i tenant:
-- li ospitiamo una volta sola in master, l'import gira una volta
-- al giorno per tutti. Risparmia GB di duplicazione storage.
--
-- Componenti:
--   - rna_aiuti           - singoli aiuti RNA importati dagli Open Data MIMIT
--   - rna_import_log      - log import (RNA + Bandi)
--   - bandi               - anagrafica bandi (import auto + inserimento manuale superadmin)
--
-- Idempotente. Grant in coda per portal_master_user.
-- Da eseguire come root su portal_master:
--   mysql -u root portal_master < migrations/30_agevolazioni_master.sql
-- ============================================================

USE portal_master;

-- 1. rna_aiuti
CREATE TABLE IF NOT EXISTS rna_aiuti (
    id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
    cor                         VARCHAR(50)  NOT NULL,
    cf_beneficiario             VARCHAR(20)  NOT NULL,
    denominazione_beneficiario  VARCHAR(255) NULL,
    data_concessione            DATE         NOT NULL,
    importo_nominale            DECIMAL(15,2) NULL,
    importo_esl                 DECIMAL(15,2) NULL,
    regolamento                 VARCHAR(100) NULL,
    regime                      ENUM('de_minimis','gber','sieg','notificato','altro') NOT NULL DEFAULT 'altro',
    titolo_misura               VARCHAR(500) NULL,
    soggetto_concedente         VARCHAR(255) NULL,
    anno_file                   SMALLINT     NULL,
    mese_file                   TINYINT      NULL,
    data_importazione           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_aggiornamento          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cor (cor),
    INDEX idx_cf            (cf_beneficiario),
    INDEX idx_data_conc     (data_concessione),
    INDEX idx_regime        (regime),
    INDEX idx_cf_regime_data (cf_beneficiario, regime, data_concessione),
    INDEX idx_anno_mese     (anno_file, mese_file)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. rna_import_log
CREATE TABLE IF NOT EXISTS rna_import_log (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    modulo              ENUM('rna','bandi_incentivi','bandi_eu','bandi_coesione','manuale') NOT NULL DEFAULT 'rna',
    anno                SMALLINT NULL,
    mese                TINYINT  NULL,
    fonte               VARCHAR(100) NULL,
    url_sorgente        VARCHAR(500) NULL,
    data_inizio         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_fine           TIMESTAMP NULL,
    records_letti       INT NOT NULL DEFAULT 0,
    records_inseriti    INT NOT NULL DEFAULT 0,
    records_aggiornati  INT NOT NULL DEFAULT 0,
    records_scartati    INT NOT NULL DEFAULT 0,
    esito               ENUM('ok','errore','parziale','running') NOT NULL DEFAULT 'running',
    messaggio           VARCHAR(2000) NULL,
    UNIQUE KEY uk_modulo_periodo_fonte (modulo, anno, mese, fonte),
    INDEX idx_data (data_inizio),
    INDEX idx_esito (esito)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. bandi
CREATE TABLE IF NOT EXISTS bandi (
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    codice_interno              VARCHAR(120) NULL,
    titolo                      VARCHAR(500) NOT NULL,
    descrizione                 TEXT NULL,
    descrizione_breve           VARCHAR(1000) NULL,
    livello                     ENUM('europeo','nazionale','regionale','provinciale','comunale') NOT NULL DEFAULT 'nazionale',
    regioni                     JSON NULL,
    settori                     JSON NULL,
    codici_ateco                JSON NULL,
    obiettivo                   VARCHAR(255) NULL,
    tipo_agevolazione           JSON NULL,
    regime_aiuto                ENUM('de_minimis','gber','notificato','non_aiuto') NOT NULL DEFAULT 'de_minimis',
    dimensione_impresa          JSON NULL,
    forma_giuridica             JSON NULL,
    eta_impresa_min_anni        INT NULL,
    eta_impresa_max_anni        INT NULL,
    requisiti_speciali          JSON NULL,
    importo_min                 DECIMAL(15,2) NULL,
    importo_max                 DECIMAL(15,2) NULL,
    percentuale_contributo      DECIMAL(5,2)  NULL,
    dotazione_totale            DECIMAL(15,2) NULL,
    data_apertura               DATE NULL,
    data_chiusura               DATE NULL,
    data_chiusura_stimata       TINYINT(1) NOT NULL DEFAULT 0,
    stato                       ENUM('bozza','aperto','chiuso','sospeso','esaurito') NOT NULL DEFAULT 'aperto',
    ente_concedente             VARCHAR(255) NULL,
    soggetto_gestore            VARCHAR(255) NULL,
    url_bando                   VARCHAR(500) NULL,
    url_modulistica             VARCHAR(500) NULL,
    documenti                   JSON NULL,
    documentazione_richiesta    TEXT NULL,
    modalita_presentazione      TEXT NULL,
    summary_html                TEXT NULL,
    summary_generated_at        TIMESTAMP NULL,
    fonte                       VARCHAR(100) NOT NULL DEFAULT 'manuale',
    fonte_id                    VARCHAR(255) NULL,
    inserito_manualmente        TINYINT(1) NOT NULL DEFAULT 0,
    verificato                  TINYINT(1) NOT NULL DEFAULT 0,
    inserito_da                 INT NULL,
    data_inserimento            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_aggiornamento          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_codice_interno (codice_interno),
    UNIQUE KEY uk_fonte_id (fonte, fonte_id),
    INDEX idx_stato (stato),
    INDEX idx_livello (livello),
    INDEX idx_data_chiusura (data_chiusura),
    INDEX idx_inserito_manuale (inserito_manualmente),
    INDEX idx_verificato (verificato),
    INDEX idx_fonte (fonte),
    FULLTEXT idx_ft_bandi (titolo, descrizione_breve, descrizione) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Grant per portal_master_user
GRANT SELECT, INSERT, UPDATE, DELETE
  ON portal_master.rna_aiuti      TO 'portal_master_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON portal_master.rna_import_log TO 'portal_master_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON portal_master.bandi          TO 'portal_master_user'@'localhost';

FLUSH PRIVILEGES;
