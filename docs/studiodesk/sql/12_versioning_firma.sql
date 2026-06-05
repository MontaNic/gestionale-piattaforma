-- ============================================================
-- FILE: migrations/12_versioning_firma.sql
-- Documenti: versioning + firma elettronica via OTP email.
--
-- Versioning:
--   · documenti.versione         INT, default 1
--   · documenti.versione_padre_id INT NULL → FK self-reference
--     (NULL = è la v.1; valorizzato = è una versione successiva
--      che riferisce al padre v.1 o all'ultimo nodo della catena)
--
-- Firma:
--   · documenti.richiede_firma TINYINT
--   · documenti_firme(documento_id, user_id) — UNIQUE: una firma
--     per coppia. codice_otp_hash bcrypt; firmato_at NULL finché
--     non confermato.
-- ============================================================

ALTER TABLE documenti
    ADD COLUMN versione INT NOT NULL DEFAULT 1 AFTER size,
    ADD COLUMN versione_padre_id INT NULL DEFAULT NULL AFTER versione,
    ADD COLUMN richiede_firma TINYINT(1) NOT NULL DEFAULT 0 AFTER conferma_lettura,
    ADD INDEX idx_doc_versione_padre (versione_padre_id, deleted_at),
    ADD CONSTRAINT fk_doc_versione_padre FOREIGN KEY (versione_padre_id)
        REFERENCES documenti(id) ON DELETE SET NULL;

ALTER TABLE documenti_tipi
    ADD COLUMN richiede_firma_default TINYINT(1) NOT NULL DEFAULT 0 AFTER conferma_default;


-- ── Tabella firme ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documenti_firme (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    documento_id       INT          NOT NULL,
    user_id            INT          NOT NULL,
    codice_otp_hash    VARCHAR(255) NULL,
    codice_inviato_at  TIMESTAMP    NULL DEFAULT NULL,
    tentativi          INT          NOT NULL DEFAULT 0,
    firmato_at         TIMESTAMP    NULL DEFAULT NULL,
    ip                 VARCHAR(45)  NULL,
    user_agent         VARCHAR(255) NULL,
    nota_utente        TEXT         NULL,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_doc_user (documento_id, user_id),
    INDEX idx_doc (documento_id),
    INDEX idx_user_firmato (user_id, firmato_at),
    CONSTRAINT fk_firma_doc  FOREIGN KEY (documento_id) REFERENCES documenti(id) ON DELETE CASCADE,
    CONSTRAINT fk_firma_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Notifiche: nuovo evento firma_otp + estensione enum destinatario per
-- accettare un nuovo valore "utente_target_firma" (riusiamo utente_target).
INSERT INTO notifiche_config (evento, attiva, destinatario)
VALUES ('firma_otp', 1, 'utente_target')
ON DUPLICATE KEY UPDATE destinatario = VALUES(destinatario);
