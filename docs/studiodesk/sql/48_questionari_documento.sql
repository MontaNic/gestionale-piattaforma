-- ============================================================
-- migrations/48_questionari_documento.sql
-- Modulo Questionari — Fase 6B: tipo di domanda "documento".
--
-- Una domanda di tipo 'documento' chiede al cliente di allegare
-- un file: il file passa per Storage e diventa un record
-- `documenti` (DMS del cliente). La risposta punta a quel documento.
--
-- Per-tenant. Idempotente. Strutture replicate in 01_studio_template.sql.
-- Vedi docs/questionari-fase6-design.md.
-- ============================================================

-- 1. Nuovo valore ENUM 'documento' fra i tipi di domanda.
ALTER TABLE questionari_domande
    MODIFY COLUMN tipo ENUM('testo_breve','testo_lungo','scelta_singola',
                            'scelta_multipla','numero','data','documento') NOT NULL;

-- 2. Colonne nuove (idempotenti via procedura).
DELIMITER $$
DROP PROCEDURE IF EXISTS _mig48$$
CREATE PROCEDURE _mig48()
BEGIN
    DECLARE db VARCHAR(64) DEFAULT DATABASE();

    -- questionari_domande.documento_tipo_id: che tipo di documento chiede
    -- la domanda (gancio verso l'anagrafica documenti — Fase 6C).
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA=db AND TABLE_NAME='questionari_domande'
                     AND COLUMN_NAME='documento_tipo_id') THEN
        ALTER TABLE questionari_domande
            ADD COLUMN documento_tipo_id INT NULL DEFAULT NULL AFTER opzioni;
        ALTER TABLE questionari_domande ADD CONSTRAINT fk_qd_doctipo
            FOREIGN KEY (documento_tipo_id) REFERENCES documenti_tipi(id) ON DELETE SET NULL;
    END IF;

    -- questionari_risposte_dettaglio.documento_id: il file allegato come
    -- risposta a una domanda di tipo 'documento'.
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA=db AND TABLE_NAME='questionari_risposte_dettaglio'
                     AND COLUMN_NAME='documento_id') THEN
        ALTER TABLE questionari_risposte_dettaglio
            ADD COLUMN documento_id INT NULL DEFAULT NULL AFTER valore_multi;
        ALTER TABLE questionari_risposte_dettaglio ADD CONSTRAINT fk_qrd_documento
            FOREIGN KEY (documento_id) REFERENCES documenti(id) ON DELETE SET NULL;
    END IF;
END$$
DELIMITER ;

CALL _mig48();
DROP PROCEDURE _mig48;
