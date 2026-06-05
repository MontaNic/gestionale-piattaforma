-- ============================================================
-- Migration 42 — Bandi: campi di dettaglio dallo scraper incentivi.gov.it
--
-- Lo scraper (bin/cron-bandi-import.php) ora estrae i blocchi
-- "<div class=detail><h4 class=title>Etichetta</h4><div class=content>..."
-- delle pagine /it/catalogo/<slug> e popola i campi di dettaglio.
--
-- Mappatura etichetta pagina -> colonna bandi:
--   "Obiettivo - Finalita'"          -> obiettivo            (gia' esistente)
--   "Dimensione"                     -> dimensione_impresa   (gia' esistente)
--   "Costi ammessi" (sintesi)        -> tipo_investimento    (gia' esistente)
--   "Soggetto gestore" (normalizz.)  -> emanazione           (gia' esistente)
--   "Soggetto gestore"               -> soggetto_gestore     (gia' esistente)
--   "Stanziamento incentivo"         -> dotazione_totale     (gia' esistente)
--   "Agevolazione concedibile (m-m)" -> importo_min/max      (gia' esistenti)
--   "Forma agevolazione"             -> tipo_agevolazione    (gia' esistente)
--   "Costi ammessi"                  -> spese_ammissibili    >>> NUOVA
--   "Tipologia soggetto"             -> soggetti_beneficiari >>> NUOVA
--   "Spesa ammessa (min-max)"        -> spesa_min/spesa_max  >>> NUOVE
--
-- Questa migration aggiunge solo le 4 colonne non ancora presenti.
-- Idempotente: salta le colonne gia' esistenti.
-- ============================================================
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

CALL _add_bandi_col('spese_ammissibili',    "TEXT NULL DEFAULT NULL COMMENT 'Costi/spese ammissibili (testo da incentivi.gov.it)'");
CALL _add_bandi_col('soggetti_beneficiari', "VARCHAR(500) NULL DEFAULT NULL COMMENT 'Tipologia soggetto beneficiario (Impresa, Professionista, ...)'");
CALL _add_bandi_col('spesa_min',            "DECIMAL(15,2) NULL DEFAULT NULL COMMENT 'Spesa ammessa minima'");
CALL _add_bandi_col('spesa_max',            "DECIMAL(15,2) NULL DEFAULT NULL COMMENT 'Spesa ammessa massima'");

DROP PROCEDURE _add_bandi_col;
