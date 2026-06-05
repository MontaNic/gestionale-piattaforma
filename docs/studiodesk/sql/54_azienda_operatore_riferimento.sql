-- ============================================================
-- FILE: migrations/54_azienda_operatore_riferimento.sql
-- Scheda azienda lato studio (admin/azienda-detail.php) — Step 1.
-- Vedi: docs/prompt-azienda-detail-admin.md
--
-- 1) `aziende.operatore_riferimento_id` (FK SET NULL su users.id)
--    — "operatore di riferimento" (RFM): chi è il referente
--    relazionale dello studio per questo cliente. Indipendente
--    dall'assegnatario di un singolo ticket.
--
-- Idempotente — riapplicabile su tenant già esistenti senza errori.
-- ============================================================

-- 1) Colonna operatore_riferimento_id
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende'
               AND COLUMN_NAME = 'operatore_riferimento_id');
SET @sql := IF(@col = 0,
    'ALTER TABLE aziende ADD COLUMN operatore_riferimento_id INT NULL DEFAULT NULL AFTER attivo',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Indice (separato per essere safely ri-eseguibile)
SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende'
               AND INDEX_NAME = 'idx_az_op_rfm');
SET @sql := IF(@idx = 0,
    'ALTER TABLE aziende ADD INDEX idx_az_op_rfm (operatore_riferimento_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Foreign key (anch'essa idempotente)
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aziende'
              AND CONSTRAINT_NAME = 'fk_az_op_rfm');
SET @sql := IF(@fk = 0,
    'ALTER TABLE aziende ADD CONSTRAINT fk_az_op_rfm
        FOREIGN KEY (operatore_riferimento_id) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
