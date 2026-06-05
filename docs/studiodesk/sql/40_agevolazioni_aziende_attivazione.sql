-- ============================================================
-- Migration 40 — Opt-in aziende nel modulo Agevolazioni (per-tenant)
--
-- Le aziende NON entrano automaticamente nel modulo Agevolazioni:
-- lo studio le ATTIVA singolarmente, fino al tetto fissato dalla
-- fascia in portal_master.studios.agevolazioni_quota.
-- Le aziende si creano comunque solo nell'anagrafica del portale
-- (/admin/aziende): nel modulo si sceglie quale attivare.
-- Rimpiazza il vecchio modello opt-out (agev_sganciata_at).
-- ============================================================

USE portal_template;

ALTER TABLE aziende
    ADD COLUMN agev_attivata_at DATETIME NULL DEFAULT NULL
        COMMENT 'Quando l azienda e stata attivata nel modulo Agevolazioni (NULL = non attivata)',
    ADD COLUMN agev_attivata_da INT NULL DEFAULT NULL
        COMMENT 'user_id che ha attivato l azienda nel modulo Agevolazioni',
    ADD INDEX idx_agev_attivata (agev_attivata_at);
