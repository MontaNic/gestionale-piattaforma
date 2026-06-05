-- @target: tenant
-- ============================================================
-- migrations/65_rapporti_lavoro.sql
-- Fase 5 modulo Preventivi: rapporti di lavoro + prestazioni.
--
-- Un rapporto di lavoro è la "lettera d'incarico" che nasce da un
-- preventivo accettato. Traccia esecuzione del mandato e le
-- prestazioni svolte (ore + descrizione + operatore) che alimentano
-- il riepilogo fatturabile.
--
-- Idempotente.
-- ============================================================

-- ── RAPPORTI DI LAVORO ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS rapporti_lavoro (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    codice          VARCHAR(32)  NOT NULL,        -- "RDL-2026-0001"
    preventivo_id   INT          NOT NULL,
    azienda_id      INT          NOT NULL,
    stato           ENUM('in_corso','sospeso','concluso','annullato')
                    NOT NULL DEFAULT 'in_corso',
    inizio          DATE         NULL,
    fine_prevista   DATE         NULL,
    fine_effettiva  DATE         NULL,
    note            TEXT         NULL,
    -- Snapshot importi al momento dell'accettazione del preventivo
    importo_concordato DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      INT          NULL,
    chiuso_at       DATETIME     NULL,
    chiuso_by       INT          NULL,
    UNIQUE KEY uk_rdl_codice (codice),
    INDEX idx_rdl_stato (stato),
    INDEX idx_rdl_az (azienda_id),
    INDEX idx_rdl_prev (preventivo_id),
    CONSTRAINT fk_rdl_prev FOREIGN KEY (preventivo_id)
        REFERENCES preventivi(id) ON DELETE RESTRICT,
    CONSTRAINT fk_rdl_az FOREIGN KEY (azienda_id)
        REFERENCES aziende(id) ON DELETE CASCADE,
    CONSTRAINT fk_rdl_cb FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_rdl_chiusoby FOREIGN KEY (chiuso_by)
        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── PRESTAZIONI (timesheet) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS rapporti_prestazioni (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    rapporto_id     INT NOT NULL,
    voce_id         INT NULL,                     -- riferimento opzionale alla voce preventivo
    data            DATE NOT NULL,
    user_id         INT NULL,                     -- chi ha svolto la prestazione
    ore             DECIMAL(5,2) NULL,
    descrizione     VARCHAR(500) NOT NULL,
    fatturabile     TINYINT(1) NOT NULL DEFAULT 1,
    importo         DECIMAL(10,2) NULL,           -- calcolato/manuale
    fatturato_at    DATETIME NULL,                -- per fatturazione futura (D-FAT B)
    fattura_id      VARCHAR(64) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pre_rdl FOREIGN KEY (rapporto_id)
        REFERENCES rapporti_lavoro(id) ON DELETE CASCADE,
    CONSTRAINT fk_pre_voce FOREIGN KEY (voce_id)
        REFERENCES preventivi_voci(id) ON DELETE SET NULL,
    CONSTRAINT fk_pre_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_pre_rdl_data (rapporto_id, data),
    INDEX idx_pre_fatt (fatturabile, fatturato_at),
    INDEX idx_pre_user (user_id, data)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
