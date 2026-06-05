-- migrations/34_agevolazioni_app_v2.sql
-- Modulo Agevolazioni v2 (app dedicata):
--   - agevolazioni_progetti: matching bando x azienda con stato/workflow
--   - agevolazioni_bandi_pref: preferenze utente sui bandi (like/dislike/hide)
--   - agevolazioni_filtri_salvati: salvataggio filtri ricerca utente
-- Idempotente.

CREATE TABLE IF NOT EXISTS agevolazioni_progetti (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    codice          VARCHAR(40) NOT NULL,
    azienda_id      INT NOT NULL,
    bando_id        INT NOT NULL,
    nome            VARCHAR(500) NOT NULL,
    stato           ENUM('da_avviare','in_corso','presentato','vinto','perso','archiviato')
                    NOT NULL DEFAULT 'da_avviare',
    archived        TINYINT(1) NOT NULL DEFAULT 0,
    importo_richiesto DECIMAL(15,2) NULL,
    importo_ottenuto  DECIMAL(15,2) NULL,
    data_presentazione DATE NULL,
    data_esito        DATE NULL,
    note            TEXT NULL,
    created_by      INT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_codice (codice),
    INDEX idx_az (azienda_id),
    INDEX idx_bando (bando_id),
    INDEX idx_stato (stato, archived),
    CONSTRAINT fk_proj_az FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agevolazioni_bandi_pref (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    azienda_id  INT NULL,
    bando_id    INT NOT NULL,
    pref        ENUM('like','dislike','hide') NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_bando_az (user_id, bando_id, azienda_id),
    INDEX idx_user (user_id, pref),
    INDEX idx_bando (bando_id),
    INDEX idx_az (azienda_id),
    CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agevolazioni_filtri_salvati (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    nome        VARCHAR(120) NOT NULL,
    filtri      JSON NOT NULL,
    contesto    ENUM('bandi','aziende','progetti') NOT NULL DEFAULT 'bandi',
    last_used   TIMESTAMP NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id, contesto, last_used DESC),
    CONSTRAINT fk_filt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
