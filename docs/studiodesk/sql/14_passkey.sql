-- ============================================================
-- migrations/14_passkey.sql
--
-- Aggiunge supporto Passkey/WebAuthn (FIDO2) come 2° fattore
-- alternativo al TOTP. Una sola tabella `webauthn_credentials`:
-- ogni utente può registrare N passkey (telefono, laptop,
-- security key fisica, ecc.).
--
-- Apply per-tenant; idempotente (CREATE TABLE IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id              INT NOT NULL AUTO_INCREMENT,
    user_id         INT NOT NULL,

    -- credential_id è il token univoco emesso dall'authenticator
    -- (base64url-encoded bytes). Lookup in fase di assertion.
    credential_id   VARCHAR(512) NOT NULL,
    -- Public key in formato CBOR/COSE serializzato a JSON dalla libreria
    public_key      MEDIUMTEXT  NOT NULL,
    -- Lista di transport supportati (usb, nfc, ble, internal, hybrid)
    transports      VARCHAR(255) NULL,
    -- AAGUID: identificatore del modello di authenticator (per UI/policy)
    aaguid          CHAR(36)     NULL,
    -- Counter anti-replay; aggiornato ad ogni assertion riuscita
    sign_count      INT UNSIGNED NOT NULL DEFAULT 0,
    -- Etichetta utente: "iPhone Mario", "YubiKey ufficio"
    label           VARCHAR(80)  NULL,

    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at    DATETIME NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uniq_credential_id (credential_id),
    KEY idx_user_id (user_id),
    CONSTRAINT fk_webauthn_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
