-- ============================================================
-- MIGRATION 53 — Wizard onboarding (W1 cliente, W2 azienda, W3 studio)
--
-- Una sola tabella `wizard_state` con UNIQUE su (wizard_id, user_id):
-- ogni utente ha la propria istanza per ogni wizard. State JSON contiene
-- sia i dati raccolti dagli step sia i marker __steps_done/__steps_skipped
-- per supportare "salta per ora" granulare.
--
-- Applicare con: sudo -u www-data php bin/migrate-wizard.php
-- ============================================================

CREATE TABLE IF NOT EXISTS wizard_state (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    wizard_id     VARCHAR(20)  NOT NULL,                -- 'W1' | 'W2' | 'W3'
    user_id       INT          NULL,                    -- utente owner della state
    azienda_id    INT          NULL,                    -- W2: scope azienda
    studio_scope  TINYINT(1)   NOT NULL DEFAULT 0,      -- W3: 1
    step_corrente VARCHAR(40)  NOT NULL DEFAULT '',     -- id dello step corrente
    state_json    JSON         NOT NULL,                -- dati raccolti + marker __steps_*
    done          TINYINT(1)   NOT NULL DEFAULT 0,
    skipped       TINYINT(1)   NOT NULL DEFAULT 0,      -- "Salta wizard intero"
    completed_at  DATETIME     NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wizard_user (wizard_id, user_id),
    INDEX idx_wizard_az    (wizard_id, azienda_id),
    INDEX idx_wizard_done  (user_id, wizard_id, done, skipped)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
