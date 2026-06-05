-- ============================================================
-- Migration 07 — Circolari (comunicazioni broadcast)
--
-- Una circolare è una comunicazione UNIDIREZIONALE inviata dallo studio
-- a una o più aziende/utenti. Differenze rispetto ai documenti:
--   - non un singolo file, ma testo HTML + eventuale allegato
--   - un solo "broadcast" = molti destinatari (azienda, utente, intero tenant)
--   - in futuro: anche l'azienda potrà inviarle ai propri dipendenti
--     (campo `azienda_mittente_id` predisposto, UI lato azienda non attiva)
--
-- Eliminazione: soft delete (`deleted_at`).
-- Tracking lettura: tabella `circolari_destinatari`.
-- ============================================================

USE portal_template;

-- ── 1. Le circolari (testata) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS circolari (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    studio_id           INT          NOT NULL,
    -- Mittente: NULL = studio (default attuale).
    -- In futuro: ID azienda → l'azienda invia ai propri dipendenti.
    azienda_mittente_id INT          DEFAULT NULL,
    titolo              VARCHAR(200) NOT NULL,
    -- Categoria libera per organizzare (es. "HR", "Aggiornamenti normativi", "Eventi")
    categoria           VARCHAR(80)  DEFAULT NULL,
    -- Oggetto + body HTML (lo studio scrive con un editor base)
    oggetto             VARCHAR(255) DEFAULT NULL,
    body_html           TEXT         NOT NULL,
    -- Allegato singolo opzionale: FK debole su `documenti.id` (Storage gestisce il file)
    allegato_doc_id     INT          DEFAULT NULL,
    -- Importanza (per UI, non per ACL)
    priorita            ENUM('normale','alta','urgente') NOT NULL DEFAULT 'normale',
    -- Conferma di lettura richiesta?
    richiede_conferma   TINYINT(1)   NOT NULL DEFAULT 0,
    -- Pubblicazione e scadenza
    pubblicata_il       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    scade_il            DATE         DEFAULT NULL,
    created_by          INT          NOT NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          TIMESTAMP    NULL DEFAULT NULL,
    INDEX idx_circ_studio    (studio_id, deleted_at),
    INDEX idx_circ_pubblic   (pubblicata_il, deleted_at),
    INDEX idx_circ_categoria (categoria),
    CONSTRAINT fk_circ_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_circ_alleg   FOREIGN KEY (allegato_doc_id) REFERENCES documenti(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Routing destinatari ────────────────────────────────────
-- Una riga per ogni "target": azienda intera, singolo utente, o "tutti"
-- (broadcast a tutto il tenant). La normalizzazione consente in futuro
-- selettori più ricchi (es. aziende per categoria).
CREATE TABLE IF NOT EXISTS circolari_destinatari (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    circolare_id    INT NOT NULL,
    -- target_tipo:
    --   'tutti'    → broadcast a tutti i clienti del tenant (target_*_id NULL)
    --   'azienda'  → tutti gli utenti di un'azienda
    --   'utente'   → singolo utente (può essere senza azienda)
    target_tipo     ENUM('tutti','azienda','utente') NOT NULL,
    azienda_id      INT          DEFAULT NULL,
    user_id         INT          DEFAULT NULL,
    INDEX idx_dest_circ    (circolare_id),
    INDEX idx_dest_azienda (azienda_id),
    INDEX idx_dest_user    (user_id),
    CONSTRAINT fk_dest_circ    FOREIGN KEY (circolare_id) REFERENCES circolari(id) ON DELETE CASCADE,
    CONSTRAINT fk_dest_azienda FOREIGN KEY (azienda_id)   REFERENCES aziende(id)   ON DELETE CASCADE,
    CONSTRAINT fk_dest_user    FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. Letture / conferme per utente ──────────────────────────
CREATE TABLE IF NOT EXISTS circolari_letture (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    circolare_id    INT NOT NULL,
    user_id         INT NOT NULL,
    letta_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confermata_at   TIMESTAMP    NULL DEFAULT NULL,
    ip              VARCHAR(45)  DEFAULT NULL,
    UNIQUE KEY uq_letturacirc (circolare_id, user_id),
    INDEX idx_lettcirc_user (user_id, letta_at),
    CONSTRAINT fk_lettcirc_circ FOREIGN KEY (circolare_id) REFERENCES circolari(id) ON DELETE CASCADE,
    CONSTRAINT fk_lettcirc_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
