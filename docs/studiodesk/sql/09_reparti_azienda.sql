-- ============================================================
-- FILE: migrations/09_reparti_azienda.sql
-- Reparti interni alle AZIENDE clienti (es. HR / Amministrazione /
-- Operations dentro "ACME Spa"). Distinti dai 'reparti' del template
-- che si riferiscono ai team interni dello STUDIO.
--
-- Permettono allo studio di scopare documenti (e in futuro circolari /
-- comunicazioni) ai soli dipendenti di un sotto-gruppo della stessa
-- azienda. La gestione dei reparti è in mano all'admin azienda
-- (cliente_ruolo = 'admin').
-- ============================================================

CREATE TABLE IF NOT EXISTS reparti_azienda (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id  INT          NOT NULL,
    nome        VARCHAR(100) NOT NULL,
    descrizione VARCHAR(500) NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_az_nome (azienda_id, nome),
    INDEX idx_az (azienda_id),
    CONSTRAINT fk_repaz_azienda FOREIGN KEY (azienda_id)
        REFERENCES aziende(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS reparti_azienda_utenti (
    reparto_id  INT NOT NULL,
    user_id     INT NOT NULL,
    PRIMARY KEY (reparto_id, user_id),
    INDEX idx_user (user_id),
    CONSTRAINT fk_repazut_rep  FOREIGN KEY (reparto_id) REFERENCES reparti_azienda(id) ON DELETE CASCADE,
    CONSTRAINT fk_repazut_user FOREIGN KEY (user_id)    REFERENCES users(id)           ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── Estensione documenti: 'reparto' come livello di visibilità ─────
-- Tra 'azienda' (tutti i dipendenti) e 'utente' (singolo) si inserisce
-- 'reparto' (sotto-gruppo). Il file viene visto solo dai dipendenti
-- dell'azienda assegnati al reparto indicato.
ALTER TABLE documenti
    MODIFY COLUMN visibilita ENUM('tutti','azienda','reparto','utente') NOT NULL,
    ADD COLUMN reparto_id INT NULL AFTER azienda_id,
    ADD INDEX idx_doc_reparto (reparto_id, deleted_at),
    ADD CONSTRAINT fk_doc_reparto FOREIGN KEY (reparto_id)
        REFERENCES reparti_azienda(id) ON DELETE SET NULL;

-- Idem sui tipi documento (default visibilita)
ALTER TABLE documenti_tipi
    MODIFY COLUMN visibilita_default ENUM('tutti','azienda','reparto','utente') NOT NULL DEFAULT 'tutti';


-- ── Inviti: ruolo cliente proposto ────────────────────────────
-- Permette al pannello /admin/inviti di scegliere se il nuovo cliente
-- diventerà 'admin' azienda o 'utente' (default). Letto da
-- public/registrati.php in fase di accettazione invito.
ALTER TABLE inviti
    ADD COLUMN cliente_ruolo ENUM('admin','utente') NOT NULL DEFAULT 'utente' AFTER azienda_id;

