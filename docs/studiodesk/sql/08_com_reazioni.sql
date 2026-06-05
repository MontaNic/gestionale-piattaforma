-- ============================================================
-- Migration 08 — Reazioni emoji sui messaggi delle comunicazioni
--
-- Pattern stile WhatsApp/Slack: ogni utente può aggiungere una o più
-- reazioni a un messaggio (max 1 per coppia messaggio/user/emoji →
-- la stessa emoji non si può "spammare").
--
-- Toggle: re-postare la stessa emoji la rimuove (gestito lato endpoint).
-- ============================================================

USE portal_template;

CREATE TABLE IF NOT EXISTS com_reazioni (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    messaggio_id  INT NOT NULL,
    user_id       INT NOT NULL,
    emoji         VARCHAR(16) NOT NULL,        -- l'emoji come stringa UTF-8 (es. "👍")
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_reaz (messaggio_id, user_id, emoji),
    INDEX idx_reaz_msg (messaggio_id),
    CONSTRAINT fk_reaz_msg  FOREIGN KEY (messaggio_id) REFERENCES com_messaggi(id) ON DELETE CASCADE,
    CONSTRAINT fk_reaz_user FOREIGN KEY (user_id)      REFERENCES users(id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
