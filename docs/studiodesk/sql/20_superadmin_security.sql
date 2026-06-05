-- ============================================================
-- 20_superadmin_security.sql
--
-- 2FA TOTP + Passkey/WebAuthn per il pannello superadmin.
-- Specchio delle migrazioni 10_security.sql + 14_passkey.sql che
-- hanno aggiunto le stesse colonne su `users` (per-tenant).
--
-- RP ID delle passkey superadmin = host fisso `studiodesk.cloud`
-- (vedi SuperadminPasskeyService::rpId).
-- ============================================================

USE portal_master;

-- ── 1. Estensione superadmin_users con campi TOTP ──
ALTER TABLE superadmin_users
    ADD COLUMN totp_secret          VARBINARY(64)  NULL AFTER attivo,
    ADD COLUMN totp_enabled         TINYINT(1)     NOT NULL DEFAULT 0 AFTER totp_secret,
    ADD COLUMN totp_recovery_codes  JSON           NULL AFTER totp_enabled,
    ADD COLUMN totp_enabled_at      DATETIME       NULL AFTER totp_recovery_codes;

-- ── 2. Tabella credenziali WebAuthn (passkey) per superadmin ──
CREATE TABLE IF NOT EXISTS superadmin_webauthn_credentials (
    id              INT          AUTO_INCREMENT PRIMARY KEY,
    superadmin_id   INT          NOT NULL,
    credential_id   VARCHAR(512) NOT NULL,
    public_key      MEDIUMTEXT   NOT NULL,
    transports      VARCHAR(255) NULL,
    aaguid          CHAR(36)     NULL,
    sign_count      INT UNSIGNED NOT NULL DEFAULT 0,
    label           VARCHAR(80)  NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at    DATETIME     NULL,
    UNIQUE KEY uq_credential_id (credential_id),
    KEY idx_superadmin (superadmin_id),
    CONSTRAINT fk_sa_webauthn_user
        FOREIGN KEY (superadmin_id) REFERENCES superadmin_users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
