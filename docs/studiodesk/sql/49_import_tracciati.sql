-- ============================================================
-- Migration 49 — Import strutturato (tracciati F24)
--
-- Sezione che importa file STRUTTURATI prodotti da software esterni
-- (gestionali di contabilita') e li splitta per beneficiario,
-- instradando ogni documento al cliente giusto tramite il codice
-- fiscale / partita IVA (chiave univoca e ufficiale, mai il nome).
--
-- import_tracciati       = un file caricato (batch)
-- import_tracciati_righe = una delega/unita' del file, con l'esito
--                          dell'abbinamento e i riferimenti al
--                          documento + scadenza creati alla pubblicazione.
-- ============================================================

USE portal_template;

CREATE TABLE IF NOT EXISTS import_tracciati (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    nome_file          VARCHAR(255) NOT NULL,
    formato            VARCHAR(30)  NOT NULL,              -- f24_xml | f24_telematico
    stato              ENUM('bozza','pubblicato','annullato') NOT NULL DEFAULT 'bozza',
    n_deleghe          INT NOT NULL DEFAULT 0,
    n_abbinate         INT NOT NULL DEFAULT 0,
    n_revisione        INT NOT NULL DEFAULT 0,
    n_pubblicate       INT NOT NULL DEFAULT 0,
    totale_complessivo DECIMAL(14,2) NULL,
    caricato_da        INT NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    pubblicato_at      DATETIME NULL,
    KEY idx_stato (stato, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS import_tracciati_righe (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    tracciato_id    INT NOT NULL,
    progressivo     INT NOT NULL DEFAULT 0,
    codice_fiscale  VARCHAR(20)  NOT NULL DEFAULT '',
    intestatario    VARCHAR(200) NOT NULL DEFAULT '',
    tipo_modello    VARCHAR(20)  NULL,
    data_versamento DATE         NULL,
    saldo_finale    DECIMAL(14,2) NOT NULL DEFAULT 0,
    azienda_id      INT NULL,                              -- cliente abbinato
    stato_match     ENUM('abbinato','non_trovato','ambiguo') NOT NULL DEFAULT 'non_trovato',
    stato_riga      ENUM('da_pubblicare','pubblicato','saltato') NOT NULL DEFAULT 'da_pubblicare',
    documento_id    INT NULL,                              -- doc DMS creato alla pubblicazione
    scadenza_id     INT NULL,                              -- scadenza creata alla pubblicazione
    anomalie        VARCHAR(500) NULL,                     -- avvisi di validazione
    dati_json       JSON NULL,                             -- delega normalizzata (sezioni, tributi)
    raw             MEDIUMTEXT NULL,                       -- frammento originale, per tracciabilita'
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_imptr_tracciato FOREIGN KEY (tracciato_id)
        REFERENCES import_tracciati(id) ON DELETE CASCADE,
    KEY idx_tracciato (tracciato_id),
    KEY idx_cf (codice_fiscale)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
