-- ============================================================
-- 15_ai_cliente.sql
-- Tabelle a supporto del bot AI cliente:
--   - ai_rate_limit: tracking richieste/ora per utente, evita spam crediti Groq
--   - ai_domande_non_risolte: log delle domande dove il bot consiglia "apri ticket".
--     Diventa una todo-list per scrivere FAQ nella KB.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_rate_limit (
    user_id      INT          NOT NULL,
    hour_bucket  CHAR(13)     NOT NULL COMMENT 'YYYY-MM-DD-HH',
    count        INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, hour_bucket),
    INDEX idx_bucket (hour_bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_domande_non_risolte (
    id              INT          NOT NULL AUTO_INCREMENT,
    testo           VARCHAR(500) NOT NULL,
    testo_norm      VARCHAR(500) NOT NULL COMMENT 'lowercase + trim, per dedup',
    count           INT          NOT NULL DEFAULT 1,
    first_seen      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    risolta         TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'flag manuale: FAQ scritta',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_testo_norm (testo_norm),
    INDEX idx_count (count DESC),
    INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
