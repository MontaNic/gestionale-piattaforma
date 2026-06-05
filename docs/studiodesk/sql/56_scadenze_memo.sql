-- ============================================================
-- FILE: migrations/56_scadenze_memo.sql
-- Tabella anti-duplicato per memo automatici delle scadenze.
-- Triggata dal cron bin/cron-scadenze-memo.php (eventi
-- `scadenza_memo_7gg` e `scadenza_memo_1gg`, già definiti in
-- `src/notifiche_default.php` e configurabili da /admin/notifiche).
--
-- Idempotente — riapplicabile su tenant già esistenti senza errori.
-- ============================================================

CREATE TABLE IF NOT EXISTS scadenze_memo_inviati (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    scadenza_id  INT NOT NULL,
    soglia_gg    TINYINT UNSIGNED NOT NULL,      -- 7 oppure 1 (giorni di anticipo)
    user_id      INT NULL,                       -- destinatario (NULL = broadcast tutti)
    inviato_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_smi_dest (scadenza_id, soglia_gg, user_id),
    INDEX idx_smi_scadenza (scadenza_id, inviato_at),
    CONSTRAINT fk_smi_scadenza FOREIGN KEY (scadenza_id)
        REFERENCES scadenze(id) ON DELETE CASCADE,
    CONSTRAINT fk_smi_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
