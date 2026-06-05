-- ============================================================
-- 17_firma_delega.sql
-- Adesione del cliente al servizio di firma elettronica avanzata
-- (necessaria per eIDAS: il cliente deve consentire UNA VOLTA al
-- metodo OTP prima di poterlo usare per firmare documenti).
--
-- Tabella `firma_deleghe`:
--   - una riga per utente
--   - quando il testo del modulo cambia (body_version), l'adesione
--     diventa "stale" e va ri-acquisita
-- ============================================================

CREATE TABLE IF NOT EXISTS firma_deleghe (
    user_id        INT          NOT NULL,
    accepted_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    body_version   VARCHAR(20)  NOT NULL COMMENT 'es. 1.0',
    body_hash      CHAR(64)     NOT NULL COMMENT 'sha256 del testo accettato',
    ip             VARCHAR(45)  NULL,
    user_agent     VARCHAR(255) NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_firma_deleghe_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
