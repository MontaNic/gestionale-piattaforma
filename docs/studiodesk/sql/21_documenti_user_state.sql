-- ============================================================
-- FILE: migrations/21_documenti_user_state.sql
-- Stato per-utente di un documento: ogni cliente può "archiviare"
-- (nascondere dalla lista principale ma recuperabile) o "eliminare
-- definitivamente" (nascondere senza recupero) un documento dalla
-- propria vista. Lo studio continua a vedere tutto: il record in
-- `documenti` resta intatto, cambia solo cosa vede l'utente.
--
-- Idempotente: solo CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS documenti_user_state (
    documento_id  INT NOT NULL,
    user_id       INT NOT NULL,
    stato         ENUM('archiviato','eliminato') NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (documento_id, user_id),
    INDEX idx_dus_user_stato (user_id, stato),
    CONSTRAINT fk_dus_doc  FOREIGN KEY (documento_id) REFERENCES documenti(id) ON DELETE CASCADE,
    CONSTRAINT fk_dus_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
