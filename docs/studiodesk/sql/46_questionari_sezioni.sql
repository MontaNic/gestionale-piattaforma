-- ============================================================
-- migrations/46_questionari_sezioni.sql
-- Modulo Questionari — Fase 6A: sezioni ripetibili.
--
-- Un questionario diventa una lista ordinata di SEZIONI. Ogni
-- sezione è normale (compilata una volta) oppure ripetibile
-- (compilata 0..N volte = "istanze"), con opzione "nessuna
-- variazione" per chiuderla a zero.
--
-- Per-tenant. Idempotente: applicabile/ri-applicabile in sicurezza
-- via `mysql <db> < 46_questionari_sezioni.sql`. Le stesse strutture
-- sono replicate in 01_studio_template.sql per i nuovi tenant.
-- Vedi docs/questionari-fase6-design.md.
-- ============================================================

-- 1. Sezioni del questionario.
CREATE TABLE IF NOT EXISTS questionari_sezioni (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    questionario_id   INT NOT NULL,
    titolo            VARCHAR(255) NOT NULL,
    descrizione       VARCHAR(500) NULL,
    ripetibile        TINYINT(1)   NOT NULL DEFAULT 0,
    consenti_zero     TINYINT(1)   NOT NULL DEFAULT 0,   -- abilita "Nessuna variazione"
    etichetta_istanza VARCHAR(60)  NOT NULL DEFAULT 'Voce',
    min_istanze       INT          NOT NULL DEFAULT 0,
    max_istanze       INT          NULL,                 -- NULL = illimitate
    ordine            INT          NOT NULL DEFAULT 0,
    INDEX idx_qs_quest (questionario_id, ordine),
    CONSTRAINT fk_qs_quest FOREIGN KEY (questionario_id) REFERENCES questionari(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Stato di compilazione per (risposta, sezione): quante istanze ha
--    compilato il cliente e se ha dichiarato "nessuna variazione".
CREATE TABLE IF NOT EXISTS questionari_risposte_sezioni (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    risposta_id        INT NOT NULL,
    sezione_id         INT NOT NULL,
    n_istanze          INT        NOT NULL DEFAULT 0,
    nessuna_variazione TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_qrs (risposta_id, sezione_id),
    CONSTRAINT fk_qrs_risp FOREIGN KEY (risposta_id) REFERENCES questionari_risposte(id) ON DELETE CASCADE,
    CONSTRAINT fk_qrs_sez  FOREIGN KEY (sezione_id)  REFERENCES questionari_sezioni(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Colonne nuove + cambio UNIQUE — racchiuse in una procedura per
--    renderle ri-applicabili (MySQL 8 non ha ADD COLUMN IF NOT EXISTS).
DELIMITER $$
DROP PROCEDURE IF EXISTS _mig46$$
CREATE PROCEDURE _mig46()
BEGIN
    DECLARE db VARCHAR(64) DEFAULT DATABASE();

    -- questionari_domande.sezione_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA=db AND TABLE_NAME='questionari_domande'
                     AND COLUMN_NAME='sezione_id') THEN
        ALTER TABLE questionari_domande
            ADD COLUMN sezione_id INT NULL DEFAULT NULL AFTER questionario_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
                   WHERE TABLE_SCHEMA=db AND TABLE_NAME='questionari_domande'
                     AND CONSTRAINT_NAME='fk_qd_sezione') THEN
        ALTER TABLE questionari_domande ADD CONSTRAINT fk_qd_sezione
            FOREIGN KEY (sezione_id) REFERENCES questionari_sezioni(id) ON DELETE CASCADE;
    END IF;

    -- questionari_risposte_dettaglio.istanza
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA=db AND TABLE_NAME='questionari_risposte_dettaglio'
                     AND COLUMN_NAME='istanza') THEN
        ALTER TABLE questionari_risposte_dettaglio
            ADD COLUMN istanza INT NOT NULL DEFAULT 1 AFTER domanda_id;
    END IF;

    -- UNIQUE uq_qrd deve includere `istanza` (3 colonne). Se ne ha meno,
    -- lo ricreo. Serve un indice d'appoggio su risposta_id perche' la FK
    -- fk_qrd_risp non resti senza indice durante il DROP.
    IF (SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=db AND TABLE_NAME='questionari_risposte_dettaglio'
          AND INDEX_NAME='uq_qrd') < 3 THEN
        ALTER TABLE questionari_risposte_dettaglio ADD INDEX idx_qrd_risp (risposta_id);
        ALTER TABLE questionari_risposte_dettaglio DROP INDEX uq_qrd;
        ALTER TABLE questionari_risposte_dettaglio
            ADD UNIQUE KEY uq_qrd (risposta_id, domanda_id, istanza);
        ALTER TABLE questionari_risposte_dettaglio DROP INDEX idx_qrd_risp;
    END IF;
END$$
DELIMITER ;

CALL _mig46();
DROP PROCEDURE _mig46;

-- 4. Backfill: una sezione "Generale" per ogni questionario esistente;
--    tutte le domande orfane vi confluiscono. Comportamento invariato.
INSERT INTO questionari_sezioni (questionario_id, titolo, ripetibile, ordine)
SELECT q.id, 'Generale', 0, 0
FROM questionari q
WHERE NOT EXISTS (SELECT 1 FROM questionari_sezioni s WHERE s.questionario_id = q.id);

UPDATE questionari_domande d
JOIN questionari_sezioni s ON s.questionario_id = d.questionario_id AND s.ordine = 0
SET d.sezione_id = s.id
WHERE d.sezione_id IS NULL;
