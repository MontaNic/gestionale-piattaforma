-- ============================================================
-- Migration 39 — Quota aziende modulo Agevolazioni (per studio)
--
-- Il modulo Agevolazioni lavora sulle aziende dell'anagrafica del
-- portale, ma solo su quelle che lo studio ATTIVA esplicitamente.
-- Il numero di aziende attivabili e' limitato da una fascia
-- commerciale che il superadmin assegna a ogni studio.
-- Fasce di riferimento: 10 / 25 / 50 / 100 / 200 aziende.
-- 0 = add-on non venduto (nessuna azienda attivabile).
-- ============================================================

USE portal_master;

ALTER TABLE studios
    ADD COLUMN agevolazioni_quota INT NOT NULL DEFAULT 0
        COMMENT 'Max aziende attivabili nel modulo Agevolazioni (0 = non venduto)';
