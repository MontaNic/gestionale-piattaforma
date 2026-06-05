-- migrations/35_provider_bilanci.sql
-- Predisposizione provider esterni per dati bilancio + scoring credito.
-- Multi-provider: ogni anno di bilancio per azienda è salvato 1 volta,
-- tracciando provider (openapi.com | infocamere | cerved | manuale).

CREATE TABLE IF NOT EXISTS aziende_bilanci_storico (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id      INT NOT NULL,
    anno            SMALLINT NOT NULL,
    fatturato       DECIMAL(15,2) NULL,
    ebitda          DECIMAL(15,2) NULL,
    ebit            DECIMAL(15,2) NULL,
    utile_netto    DECIMAL(15,2) NULL,
    patrimonio_netto DECIMAL(15,2) NULL,
    debiti_totali   DECIMAL(15,2) NULL,
    capitale_sociale DECIMAL(15,2) NULL,
    n_dipendenti    INT NULL,
    -- Scoring (popolato da provider con servizio rating; default null)
    rating_score    DECIMAL(5,2) NULL,
    rating_label    VARCHAR(10) NULL,            -- es. "CCC", "B", "BBB"
    rating_provider VARCHAR(50) NULL,            -- es. "modefinance"
    -- Tracking origine
    fonte           VARCHAR(50) NOT NULL DEFAULT 'openapi.com',
    raw_data        JSON NULL,                   -- payload originale (debug)
    fetched_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_az_anno (azienda_id, anno),
    INDEX idx_az (azienda_id),
    INDEX idx_anno (anno),
    INDEX idx_fonte (fonte),
    CONSTRAINT fk_bil_az FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings provider (gruppo 'integrazioni'). Idempotente.
INSERT INTO impostazioni (chiave, valore, tipo, gruppo, etichetta) VALUES
    ('bilanci_provider',         'openapi', 'testo',   'integrazioni', 'Provider dati bilancio attivo'),
    ('infocamere_token',         '',        'testo',   'integrazioni', 'InfoCamere API token (predisposizione)'),
    ('infocamere_attivo',        '0',       'booleano','integrazioni', 'InfoCamere abilitato'),
    ('cerved_token',             '',        'testo',   'integrazioni', 'Cerved API token (predisposizione)'),
    ('cerved_attivo',            '0',       'booleano','integrazioni', 'Cerved abilitato'),
    ('rating_provider',          'none',    'testo',   'integrazioni', 'Provider rating/scoring credito (none|modefinance|cerved)'),
    ('rating_provider_token',    '',        'testo',   'integrazioni', 'Token rating provider')
ON DUPLICATE KEY UPDATE etichetta = VALUES(etichetta);
