-- ============================================================
-- FILE: migrations/10_security.sql
-- Hardening sicurezza Fase 1:
--  · login_attempts (già esistente nella maggior parte dei tenant
--    via auto-CREATE in AuthController; qui assicuriamo che ci sia)
--  · users.totp_* (2FA)
--  · CSRF non richiede schema (sessione PHP)
-- ============================================================

-- ── Login attempts (idempotente) ─────────────────────────────
CREATE TABLE IF NOT EXISTS login_attempts (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(255) NULL,
    ip          VARCHAR(45) NOT NULL,
    successo    TINYINT(1) NOT NULL DEFAULT 0,
    user_agent  VARCHAR(255) NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_la_ip_time    (ip, created_at),
    INDEX idx_la_email_time (email, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2FA TOTP (users) ─────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN totp_secret VARBINARY(64) NULL AFTER password_hash,
    ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER totp_secret,
    ADD COLUMN totp_recovery_codes JSON NULL AFTER totp_enabled,
    ADD COLUMN totp_enabled_at DATETIME NULL AFTER totp_recovery_codes;

-- Estende l'ENUM destinatario per supportare alert "admin studio"
-- (eventi come login_brute_force che notificano admin/direzione/responsabile).
ALTER TABLE notifiche_config
    MODIFY COLUMN destinatario ENUM('cliente_azienda','operatore_assegnato','utente_target','admin_studio') NOT NULL;

-- Nuovo evento: alert per tentativi sospetti di brute-force.
INSERT INTO notifiche_config (evento, attiva, destinatario)
VALUES ('login_brute_force', 1, 'admin_studio')
ON DUPLICATE KEY UPDATE destinatario = VALUES(destinatario);
