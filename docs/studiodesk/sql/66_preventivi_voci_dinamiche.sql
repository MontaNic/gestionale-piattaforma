-- @target: tenant
-- ============================================================
-- migrations/66_preventivi_voci_dinamiche.sql
-- Spec: docs/prompt-preventivi-voci-dinamiche.md
--
-- Estende il modulo Preventivi con voci dinamiche che leggono dati
-- live dal portale (n. comunicazioni, documenti, circolari, ecc.) per
-- un'azienda in un periodo specifico. La voce viene salvata come
-- snapshot al momento dell'aggiunta; in stato bozza è possibile
-- ricalcolare la quantità con i dati attuali.
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS + INSERT IGNORE +
-- pattern condizionale information_schema per ALTER (MySQL 8.0 NON
-- supporta ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- ── Catalogo metriche disponibili nello studio ─────────────
CREATE TABLE IF NOT EXISTS servizi_metriche (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    codice          VARCHAR(64)  NOT NULL,
    nome            VARCHAR(180) NOT NULL,
    descrizione     TEXT         NULL,
    metric_key      VARCHAR(64)  NOT NULL,
    unita_misura_label VARCHAR(40) NOT NULL DEFAULT 'unità',
    periodo_default ENUM('mensile','trimestrale','semestrale','annuale','custom') NOT NULL DEFAULT 'annuale',
    prezzo_unitario_default DECIMAL(10,2) NOT NULL DEFAULT 0,
    iva_aliquota_default    DECIMAL(5,2)  NOT NULL DEFAULT 22.00,
    soglia_minima   INT          NOT NULL DEFAULT 0,
    attivo          TINYINT(1)   NOT NULL DEFAULT 1,
    ordine          INT          NOT NULL DEFAULT 0,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_metr_codice (codice),
    INDEX idx_metr_attivo (attivo, ordine)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Aggiunta colonne a preventivi_voci (pattern condizionale) ──
-- Helper: per ogni colonna, aggiungi solo se non esiste.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preventivi_voci' AND COLUMN_NAME='metrica_id');
SET @sql := IF(@col=0,
    'ALTER TABLE preventivi_voci ADD COLUMN metrica_id INT NULL AFTER servizio_id',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preventivi_voci' AND COLUMN_NAME='metric_key');
SET @sql := IF(@col=0,
    'ALTER TABLE preventivi_voci ADD COLUMN metric_key VARCHAR(64) NULL AFTER metrica_id',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preventivi_voci' AND COLUMN_NAME='periodo_tipo');
SET @sql := IF(@col=0,
    "ALTER TABLE preventivi_voci ADD COLUMN periodo_tipo ENUM('mensile','trimestrale','semestrale','annuale','custom') NULL AFTER metric_key",
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preventivi_voci' AND COLUMN_NAME='periodo_da');
SET @sql := IF(@col=0,
    'ALTER TABLE preventivi_voci ADD COLUMN periodo_da DATE NULL AFTER periodo_tipo',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preventivi_voci' AND COLUMN_NAME='periodo_a');
SET @sql := IF(@col=0,
    'ALTER TABLE preventivi_voci ADD COLUMN periodo_a DATE NULL AFTER periodo_da',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preventivi_voci' AND COLUMN_NAME='snapshot_at');
SET @sql := IF(@col=0,
    'ALTER TABLE preventivi_voci ADD COLUMN snapshot_at DATETIME NULL AFTER periodo_a',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Index + FK
SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preventivi_voci' AND INDEX_NAME='idx_voce_metrica');
SET @sql := IF(@idx=0,
    'ALTER TABLE preventivi_voci ADD INDEX idx_voce_metrica (metrica_id)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preventivi_voci' AND CONSTRAINT_NAME='fk_voce_metrica');
SET @sql := IF(@fk=0,
    'ALTER TABLE preventivi_voci ADD CONSTRAINT fk_voce_metrica FOREIGN KEY (metrica_id) REFERENCES servizi_metriche(id) ON DELETE SET NULL',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Seed catalogo metriche (5 voci) ────────────────────────
INSERT IGNORE INTO servizi_metriche
    (codice, nome, descrizione, metric_key, unita_misura_label, periodo_default,
     prezzo_unitario_default, iva_aliquota_default, soglia_minima, ordine, attivo)
VALUES
    ('METR-COM',    'Comunicazioni gestite',
        'Numero di comunicazioni/ticket aperti dal cliente nel periodo (incluse chiuse, escluse note interne).',
        'comunicazioni_gestite', 'comunicazioni', 'annuale', 0.00, 22.00, 1, 1, 1),
    ('METR-DOC',    'Documenti caricati',
        'Numero di documenti caricati dallo studio per il cliente nel periodo (esclusi soft-deleted).',
        'documenti_caricati', 'documenti', 'annuale', 0.00, 22.00, 1, 2, 1),
    ('METR-CIRC',   'Circolari ricevute',
        'Numero di circolari pubblicate raggiungenti il cliente nel periodo (deduplicate per catena versioni).',
        'circolari_inviate', 'circolari', 'annuale', 0.00, 22.00, 1, 3, 1),
    ('METR-QUEST',  'Questionari sottoposti',
        'Numero di questionari assegnati al cliente nel periodo.',
        'questionari_inviati', 'questionari', 'annuale', 0.00, 22.00, 1, 4, 1),
    ('METR-SCAD',   'Scadenze monitorate',
        'Numero di scadenze attive che riguardano il cliente nel periodo (qualsiasi visibilità che lo includa).',
        'scadenze_create', 'scadenze', 'annuale', 0.00, 22.00, 0, 5, 1);
