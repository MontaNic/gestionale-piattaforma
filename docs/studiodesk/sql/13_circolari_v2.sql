-- ============================================================
-- FILE: migrations/13_circolari_v2.sql
-- Estende il sistema circolari con:
--   · Stato (bozza/scheduled/pubblicata/archiviata) + modalità (upload/editor/ai_*)
--   · Programmazione invii (publish_at)
--   · Versioning (versione, versione_padre_id) — pattern documenti
--   · PDF allegato + hash sha256 + retention
--   · Override solleciti per circolare
--   · Letture: user_agent, tipo_lettura, tombstone GDPR
--   · Destinatari estesi con 'reparto' (riusa reparti_azienda)
--   · Tabelle nuove: circolari_fonti, circolari_solleciti_inviati, circolari_audit
--   · Trigger immutabilità su circolari_audit
-- Da applicare a TUTTI i tenant attivi.
-- ============================================================

-- ── Estensione testata ─────────────────────────────────────
ALTER TABLE circolari
    ADD COLUMN stato ENUM('bozza','scheduled','pubblicata','archiviata') NOT NULL DEFAULT 'pubblicata' AFTER richiede_conferma,
    ADD COLUMN modalita ENUM('upload','editor','ai_polish','ai_genera') NOT NULL DEFAULT 'editor' AFTER stato,
    ADD COLUMN publish_at DATETIME NULL AFTER pubblicata_il,
    ADD COLUMN versione INT NOT NULL DEFAULT 1,
    ADD COLUMN versione_padre_id INT NULL,
    ADD COLUMN pdf_doc_id INT NULL AFTER allegato_doc_id,
    ADD COLUMN pdf_hash CHAR(64) NULL,
    ADD COLUMN solleciti_override JSON NULL,
    ADD COLUMN sollecito_disabilitato TINYINT(1) NOT NULL DEFAULT 0,
    ADD INDEX idx_circ_stato_publish (stato, publish_at),
    ADD INDEX idx_circ_pdf_hash (pdf_hash),
    ADD INDEX idx_circ_versione_padre (versione_padre_id),
    ADD CONSTRAINT fk_circ_versione_padre FOREIGN KEY (versione_padre_id)
        REFERENCES circolari(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_circ_pdf FOREIGN KEY (pdf_doc_id)
        REFERENCES documenti(id) ON DELETE SET NULL;

-- ── Letture: UA + tipo + tombstone GDPR ────────────────────
ALTER TABLE circolari_letture
    ADD COLUMN user_agent VARCHAR(255) NULL AFTER ip,
    ADD COLUMN tipo_lettura ENUM('implicita','esplicita') NOT NULL DEFAULT 'implicita' AFTER confermata_at,
    ADD COLUMN tombstone_at DATETIME NULL,
    MODIFY COLUMN user_id INT NULL,
    ADD INDEX idx_letture_tombstone (tombstone_at);

-- ── Destinatari: estendi tipi ──────────────────────────────
-- 'reparto' permette di mirare un sotto-gruppo di un'azienda (riusa reparti_azienda)
ALTER TABLE circolari_destinatari
    MODIFY COLUMN target_tipo ENUM('tutti','azienda','reparto','utente') NOT NULL,
    ADD COLUMN reparto_id INT NULL AFTER azienda_id,
    ADD INDEX idx_dest_reparto (reparto_id),
    ADD CONSTRAINT fk_dest_reparto FOREIGN KEY (reparto_id)
        REFERENCES reparti_azienda(id) ON DELETE CASCADE;

-- ── Fonti (per modalità AI "scrivi per me") ────────────────
CREATE TABLE IF NOT EXISTS circolari_fonti (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    circolare_id    INT NOT NULL,
    url             VARCHAR(2000) NULL,
    titolo_estratto VARCHAR(500) NULL,
    testo_estratto  MEDIUMTEXT NULL,
    fetched_at      TIMESTAMP NULL,
    fetch_ok        TINYINT(1) NOT NULL DEFAULT 0,
    fetch_error     VARCHAR(500) NULL,
    INDEX idx_fonti_circ (circolare_id),
    CONSTRAINT fk_fonti_circ FOREIGN KEY (circolare_id)
        REFERENCES circolari(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Solleciti: registro invii ──────────────────────────────
CREATE TABLE IF NOT EXISTS circolari_solleciti_inviati (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    circolare_id INT NOT NULL,
    user_id      INT NOT NULL,
    inviato_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tipo         ENUM('automatico','manuale') NOT NULL DEFAULT 'automatico',
    inviato_da   INT NULL,
    INDEX idx_sol_circ_user (circolare_id, user_id),
    INDEX idx_sol_inviato (inviato_at),
    CONSTRAINT fk_sol_circ FOREIGN KEY (circolare_id) REFERENCES circolari(id)  ON DELETE CASCADE,
    CONSTRAINT fk_sol_user FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
    CONSTRAINT fk_sol_op   FOREIGN KEY (inviato_da)   REFERENCES users(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Audit immutabile ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS circolari_audit (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    circolare_id INT NULL,
    user_id      INT NULL,
    ip           VARCHAR(45) NULL,
    user_agent   VARCHAR(255) NULL,
    azione       VARCHAR(60) NOT NULL,
    dettagli     JSON NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_caud_circ  (circolare_id, created_at),
    INDEX idx_caud_az    (azione, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Trigger anti-modifica (immutabilità DB-level)
DROP TRIGGER IF EXISTS trg_caud_no_update;
DROP TRIGGER IF EXISTS trg_caud_no_delete;

DELIMITER $$
CREATE TRIGGER trg_caud_no_update
BEFORE UPDATE ON circolari_audit
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'circolari_audit e append-only: UPDATE non consentito';
END$$

CREATE TRIGGER trg_caud_no_delete
BEFORE DELETE ON circolari_audit
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'circolari_audit e append-only: DELETE non consentito';
END$$
DELIMITER ;

-- ── Permessi: 5 nuovi codici ──────────────────────────────
INSERT INTO permessi (codice, etichetta, area, ordine) VALUES
    ('circolari.create',            'Crea bozze circolari',                'circolari', 10),
    ('circolari.publish',           'Pubblica e modifica circolari',       'circolari', 20),
    ('circolari.archive',           'Archivia circolari (soft-delete)',    'circolari', 30),
    ('circolari.read_report',       'Vedi report letture e export CSV',    'circolari', 40),
    ('circolari.config_solleciti',  'Modifica regole globali solleciti',   'circolari', 50)
ON DUPLICATE KEY UPDATE etichetta = VALUES(etichetta), area = VALUES(area);

-- Assegnazione default ai ruoli (la presenza della riga = concesso).
-- admin/direzione hanno sempre tutti i permessi via ACLController::puo() (early-true),
-- ma li registriamo comunque per coerenza con la matrice ACL.
INSERT IGNORE INTO ruoli_permessi (ruolo_id, permesso_id)
SELECT r.id, p.id
FROM ruoli r CROSS JOIN permessi p
WHERE p.codice IN ('circolari.create','circolari.publish','circolari.archive','circolari.read_report','circolari.config_solleciti')
  AND (
       (r.nome IN ('admin','direzione'))
    OR (r.nome = 'responsabile' AND p.codice IN ('circolari.create','circolari.publish','circolari.read_report'))
    OR (r.nome = 'operatore'    AND p.codice = 'circolari.create')
  );

-- ── Impostazioni default per studio ───────────────────────
INSERT INTO impostazioni (chiave, valore, tipo, gruppo, etichetta)
VALUES
    ('circolari_solleciti_default', '{"ritardi":[3,7],"max":2}', 'json', 'circolari', 'Solleciti automatici (default)'),
    ('circolari_retention_anni',    '10',                       'numero','circolari', 'Retention circolari (anni)')
ON DUPLICATE KEY UPDATE valore = valore;
