-- ============================================================
-- migrations/44_questionari.sql
-- Modulo Questionari: lo studio crea questionari (anche con AI),
-- salvabili come modello, e li invia a uno o piu' clienti per
-- raccogliere informazioni strutturate.
--
-- Per-tenant. Idempotente (IF NOT EXISTS / INSERT IGNORE).
-- Applicare su ogni tenant attivo; le tabelle sono gia' incluse
-- in 01_studio_template.sql per i nuovi tenant.
-- ============================================================

-- Testata: un record = un questionario (modello o istanza inviata).
CREATE TABLE IF NOT EXISTS questionari (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    titolo            VARCHAR(255) NOT NULL,
    descrizione       TEXT NULL,
    stato             ENUM('bozza','inviato','chiuso','archiviato') NOT NULL DEFAULT 'bozza',
    is_template       TINYINT(1) NOT NULL DEFAULT 0,
    template_padre_id INT NULL,
    modalita          ENUM('manuale','ai') NOT NULL DEFAULT 'manuale',
    created_by        INT NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    inviato_at        DATETIME NULL,
    chiuso_at         DATETIME NULL,
    INDEX idx_q_stato (stato),
    INDEX idx_q_template (is_template),
    CONSTRAINT fk_q_creator  FOREIGN KEY (created_by)        REFERENCES users(id)       ON DELETE SET NULL,
    CONSTRAINT fk_q_tplpadre FOREIGN KEY (template_padre_id) REFERENCES questionari(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Domande tipizzate del questionario.
CREATE TABLE IF NOT EXISTS questionari_domande (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    questionario_id INT NOT NULL,
    ordine          INT NOT NULL DEFAULT 0,
    tipo            ENUM('testo_breve','testo_lungo','scelta_singola','scelta_multipla','numero','data') NOT NULL,
    testo           VARCHAR(500) NOT NULL,
    descrizione     VARCHAR(500) NULL,
    opzioni         JSON NULL,                    -- array di stringhe per scelta_singola/multipla
    obbligatoria    TINYINT(1) NOT NULL DEFAULT 1,
    INDEX idx_qd_quest (questionario_id, ordine),
    CONSTRAINT fk_qd_quest FOREIGN KEY (questionario_id) REFERENCES questionari(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Targeting dell'invio (stesso pattern di circolari_destinatari).
CREATE TABLE IF NOT EXISTS questionari_destinatari (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    questionario_id INT NOT NULL,
    target_tipo     ENUM('tutti','azienda','reparto','utente') NOT NULL,
    azienda_id      INT NULL,
    reparto_id      INT NULL,
    user_id         INT NULL,
    INDEX idx_qdest_quest (questionario_id),
    CONSTRAINT fk_qdest_quest   FOREIGN KEY (questionario_id) REFERENCES questionari(id)     ON DELETE CASCADE,
    CONSTRAINT fk_qdest_azienda FOREIGN KEY (azienda_id)      REFERENCES aziende(id)         ON DELETE CASCADE,
    CONSTRAINT fk_qdest_reparto FOREIGN KEY (reparto_id)      REFERENCES reparti_azienda(id) ON DELETE CASCADE,
    CONSTRAINT fk_qdest_user    FOREIGN KEY (user_id)         REFERENCES users(id)           ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Stato di compilazione per ciascun cliente destinatario.
CREATE TABLE IF NOT EXISTS questionari_risposte (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    questionario_id INT NOT NULL,
    user_id         INT NOT NULL,
    stato           ENUM('da_compilare','in_corso','completato') NOT NULL DEFAULT 'da_compilare',
    iniziato_at     DATETIME NULL,
    completato_at   DATETIME NULL,
    ip              VARCHAR(45) NULL,
    UNIQUE KEY uq_q_risp (questionario_id, user_id),
    INDEX idx_qr_user (user_id),
    CONSTRAINT fk_qr_quest FOREIGN KEY (questionario_id) REFERENCES questionari(id) ON DELETE CASCADE,
    CONSTRAINT fk_qr_user  FOREIGN KEY (user_id)         REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Risposta puntuale a una domanda.
CREATE TABLE IF NOT EXISTS questionari_risposte_dettaglio (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    risposta_id  INT NOT NULL,
    domanda_id   INT NOT NULL,
    valore       TEXT NULL,         -- testo / numero / data / scelta singola
    valore_multi JSON NULL,         -- array per scelta multipla
    UNIQUE KEY uq_qrd (risposta_id, domanda_id),
    CONSTRAINT fk_qrd_risp FOREIGN KEY (risposta_id) REFERENCES questionari_risposte(id) ON DELETE CASCADE,
    CONSTRAINT fk_qrd_dom  FOREIGN KEY (domanda_id)  REFERENCES questionari_domande(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── ACL: permesso di gestione questionari ───────────────────
INSERT INTO permessi (codice, etichetta, area, ordine) VALUES
    ('questionari.gestire', 'Gestione questionari', 'Lavoro', 42)
ON DUPLICATE KEY UPDATE etichetta = VALUES(etichetta);

-- Default ruoli_permessi: operativita' pura -> operatore/responsabile/direzione.
INSERT IGNORE INTO ruoli_permessi (ruolo_id, permesso_id)
SELECT r.id, p.id FROM ruoli r JOIN permessi p
WHERE p.codice = 'questionari.gestire'
  AND r.nome IN ('direzione','responsabile','operatore');
