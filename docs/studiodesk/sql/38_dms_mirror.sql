-- ============================================================
-- Migration 38 — DMS Mirror (per-tenant)
--
-- Add-on "Backup DMS su Drive". I file del DMS su disco hanno nome
-- UUID e struttura a ID numerici; il mirror ricostruisce un albero
-- LEGGIBILE (Azienda > Dipendente > Tipo) in hardlink, poi
-- sincronizzato su Drive/OneDrive/SharePoint via rclone (Fase 2).
--
-- dms_mirror_state: una riga per documento -> path nel mirror.
-- Rende incrementale il giro (rileva rinomine e doc spariti) senza
-- riscansionare l'intero filesystem.
-- ============================================================

USE portal_template;

CREATE TABLE IF NOT EXISTS dms_mirror_state (
    documento_id INT NOT NULL PRIMARY KEY,
    mirror_path  VARCHAR(900) NOT NULL,
    synced_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_dms_mirror_doc FOREIGN KEY (documento_id)
        REFERENCES documenti(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed impostazioni dell'add-on (tutte spente di default).
INSERT INTO impostazioni (chiave, valore, tipo, gruppo, etichetta) VALUES
    ('dms_mirror_attivo',     '0', 'booleano', 'integrazioni', 'Backup DMS su Drive attivo'),
    ('dms_mirror_provider',   '',  'testo',    'integrazioni', 'Provider drive (drive/onedrive/sharepoint)'),
    ('dms_mirror_remote',     '',  'testo',    'integrazioni', 'Nome remote rclone'),
    ('dms_mirror_base_path',  '',  'testo',    'integrazioni', 'Cartella base sul drive'),
    ('dms_mirror_last_run',   '',  'testo',    'integrazioni', 'Ultima sincronizzazione (timestamp)'),
    ('dms_mirror_last_esito', '',  'testo',    'integrazioni', 'Esito ultima sincronizzazione')
ON DUPLICATE KEY UPDATE chiave = VALUES(chiave);
