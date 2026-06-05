-- ============================================================
-- Migration 41 — Dettaglio aiuti RNA: obiettivo, settore, strumento
--
-- Campi presenti nell'XML Open Data RNA (COMPONENTE_AIUTO):
--   DES_OBIETTIVO    -> obiettivo dell'aiuto
--   SETTORE_ATTIVITA -> settore (codice NACE)
--   DES_STRUMENTO    -> strumento di aiuto (sovvenzione, garanzia, ecc.)
-- Popolati dall'import (bin/cron-rna-import.php) e mostrati nel
-- "Dettaglio aiuti ricevuti" della scheda azienda.
-- ============================================================
USE portal_master;

ALTER TABLE rna_aiuti
    ADD COLUMN obiettivo VARCHAR(500) NULL DEFAULT NULL COMMENT 'DES_OBIETTIVO',
    ADD COLUMN settore   VARCHAR(150) NULL DEFAULT NULL COMMENT 'SETTORE_ATTIVITA (NACE)',
    ADD COLUMN strumento VARCHAR(255) NULL DEFAULT NULL COMMENT 'DES_STRUMENTO';
