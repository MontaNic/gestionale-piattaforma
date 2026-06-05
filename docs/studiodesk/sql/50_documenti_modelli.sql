-- ============================================================
-- migrations/50_documenti_modelli.sql
-- Modulo Questionari/Documenti — Fase 6C: modelli documento.
--
-- Un "modello documento" (es. Carta d'Identità) è un tipo di
-- documento dotato di uno SCHEMA DI CAMPI standard obbligatori e
-- di una data di scadenza: serve sia alle domande "documento" dei
-- questionari sia all'anagrafica documenti del cliente.
--
--   documenti_tipi.is_modello = 1  → è un modello (ha campi, è
--      tracciato per scadenza/riuso). I 16 tipi semplici restano a 0.
--   documenti_tipi_campi          → schema dei campi del modello
--   documenti.scade_il (esistente) + documenti.dati → scadenza e campi
--
-- Per-tenant. Idempotente. Vedi docs/questionari-fase6-design.md.
-- ============================================================

-- 1. Schema dei campi di un modello documento.
CREATE TABLE IF NOT EXISTS documenti_tipi_campi (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    tipo_id      INT NOT NULL,
    etichetta    VARCHAR(120) NOT NULL,
    tipo_campo   ENUM('testo','numero','data') NOT NULL DEFAULT 'testo',
    -- ruolo: 'data_scadenza' alimenta documenti.scade_il (riuso/avvisi)
    ruolo        ENUM('generico','numero_documento','ente_rilascio',
                      'data_rilascio','data_scadenza') NOT NULL DEFAULT 'generico',
    obbligatorio TINYINT(1) NOT NULL DEFAULT 1,
    ordine       INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_dtc (tipo_id, etichetta),
    INDEX idx_dtc_tipo (tipo_id, ordine),
    CONSTRAINT fk_dtc_tipo FOREIGN KEY (tipo_id) REFERENCES documenti_tipi(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Colonne nuove (idempotenti via procedura).
DELIMITER $$
DROP PROCEDURE IF EXISTS _mig49$$
CREATE PROCEDURE _mig49()
BEGIN
    DECLARE db VARCHAR(64) DEFAULT DATABASE();

    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=db
                   AND TABLE_NAME='documenti_tipi' AND COLUMN_NAME='is_modello') THEN
        ALTER TABLE documenti_tipi ADD COLUMN is_modello TINYINT(1) NOT NULL DEFAULT 0 AFTER attivo;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=db
                   AND TABLE_NAME='documenti_tipi' AND COLUMN_NAME='validita_mesi') THEN
        ALTER TABLE documenti_tipi ADD COLUMN validita_mesi INT NULL DEFAULT NULL AFTER is_modello;
    END IF;

    -- La data di scadenza usa la colonna ESISTENTE documenti.scade_il
    -- (già gestita da bin/cron-alert-scadenze-doc.php). Qui aggiungiamo
    -- solo la data di rilascio e il contenitore JSON dei campi.
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=db
                   AND TABLE_NAME='documenti' AND COLUMN_NAME='data_rilascio') THEN
        ALTER TABLE documenti ADD COLUMN data_rilascio DATE NULL DEFAULT NULL AFTER note;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=db
                   AND TABLE_NAME='documenti' AND COLUMN_NAME='dati') THEN
        ALTER TABLE documenti ADD COLUMN dati JSON NULL DEFAULT NULL AFTER data_rilascio;
    END IF;
END$$
DELIMITER ;
CALL _mig49();
DROP PROCEDURE _mig49;

-- 3. Seed dei modelli pronti (CIE, Passaporto, Tessera sanitaria, Visura)
--    con i loro campi standard. studio_id NULL = modello di base del
--    tenant; lo studio può modificarlo o crearne di nuovi dal pannello.
INSERT IGNORE INTO documenti_tipi
    (studio_id, codice, etichetta, direzione, icona, conferma_default,
     password_default, visibilita_default, ordine, attivo, is_modello, validita_mesi)
VALUES
    (NULL,'modello_cie',              'Carta d''identità (CIE)','cliente_studio','fa-id-card',     'nessuna',0,'utente',210,1,1,120),
    (NULL,'modello_passaporto',       'Passaporto',             'cliente_studio','fa-passport',    'nessuna',0,'utente',220,1,1,120),
    (NULL,'modello_tessera_sanitaria','Tessera sanitaria',      'cliente_studio','fa-id-card-alt', 'nessuna',0,'utente',230,1,1,72),
    (NULL,'modello_visura',           'Visura camerale',        'cliente_studio','fa-building',    'nessuna',0,'azienda',240,1,1,6);

SET @cie  := (SELECT id FROM documenti_tipi WHERE codice='modello_cie'               AND studio_id IS NULL);
SET @pass := (SELECT id FROM documenti_tipi WHERE codice='modello_passaporto'        AND studio_id IS NULL);
SET @ts   := (SELECT id FROM documenti_tipi WHERE codice='modello_tessera_sanitaria' AND studio_id IS NULL);
SET @vis  := (SELECT id FROM documenti_tipi WHERE codice='modello_visura'            AND studio_id IS NULL);

INSERT IGNORE INTO documenti_tipi_campi (tipo_id, etichetta, tipo_campo, ruolo, obbligatorio, ordine) VALUES
    -- Carta d'identità (CIE)
    (@cie,'Numero documento',  'testo','numero_documento',1,1),
    (@cie,'Comune di rilascio','testo','ente_rilascio',   1,2),
    (@cie,'Data di rilascio',  'data', 'data_rilascio',   1,3),
    (@cie,'Data di scadenza',  'data', 'data_scadenza',   1,4),
    -- Passaporto
    (@pass,'Numero passaporto',   'testo','numero_documento',1,1),
    (@pass,'Autorità di rilascio','testo','ente_rilascio',   1,2),
    (@pass,'Data di rilascio',    'data', 'data_rilascio',   1,3),
    (@pass,'Data di scadenza',    'data', 'data_scadenza',   1,4),
    -- Tessera sanitaria
    (@ts,'Codice fiscale',        'testo','generico',        1,1),
    (@ts,'Numero identificativo', 'testo','numero_documento',0,2),
    (@ts,'Data di scadenza',      'data', 'data_scadenza',   1,3),
    -- Visura camerale
    (@vis,'Numero REA',         'testo','numero_documento',1,1),
    (@vis,'Camera di Commercio','testo','ente_rilascio',   1,2),
    (@vis,'Data della visura',  'data', 'data_rilascio',   1,3);
