-- migrations/37_provider_api_log.sql
-- Audit log chiamate API ai provider esterni (OpenAPI, InfoCamere, Cerved).
-- Per controllo costi + debug + trasparenza.
CREATE TABLE IF NOT EXISTS provider_api_log (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    provider        VARCHAR(40) NOT NULL,           -- 'openapi.com', 'infocamere', 'cerved', 'vies'
    endpoint        VARCHAR(255) NOT NULL,          -- es. 'IT-full', '/credit/balance'
    request_summary VARCHAR(500) NULL,              -- CF, descrizione operazione, ecc.
    response_status INT NULL,                       -- HTTP code
    response_ok     TINYINT(1) NOT NULL DEFAULT 0,
    response_excerpt VARCHAR(500) NULL,             -- primi 500 char della risposta (NO payload completo)
    latency_ms      INT NULL,
    costo_stimato   DECIMAL(8,4) NULL,              -- in EUR (es. 0.0500)
    user_id         INT NULL,
    user_email      VARCHAR(255) NULL,
    azienda_id      INT NULL,
    ip              VARCHAR(45) NULL,
    error_msg       VARCHAR(500) NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_provider (provider, created_at DESC),
    INDEX idx_user (user_id),
    INDEX idx_azienda (azienda_id),
    INDEX idx_created (created_at DESC),
    INDEX idx_ok (response_ok)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
