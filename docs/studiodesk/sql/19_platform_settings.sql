-- ============================================================
-- 19_platform_settings.sql
--
-- Tabella key/value su portal_master per impostazioni globali della
-- piattaforma modificabili da superadmin (es. email destinataria del
-- form contatti, future feature flag, ecc.).
--
-- I valori qui presenti hanno precedenza sui default definiti in
-- src/config/master.php (suffisso _DEFAULT).
-- ============================================================

USE portal_master;

CREATE TABLE IF NOT EXISTS platform_settings (
    chiave       VARCHAR(80)  NOT NULL,
    valore       TEXT         NULL,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by   INT          NULL,
    PRIMARY KEY (chiave),
    CONSTRAINT fk_platform_settings_user
        FOREIGN KEY (updated_by) REFERENCES superadmin_users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
