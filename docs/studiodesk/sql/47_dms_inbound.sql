-- ============================================================
-- Migration 47 — DMS Inbound (per-tenant)
--
-- Direzione INVERSA del "Backup DMS su Drive": una casella di
-- ingresso (inbox) su Drive. Il portale pre-crea un albero di
-- cartelle leggibile (Azienda > Dipendente, Reparti, Studio -
-- Condivisi); lo studio molla i file dentro e il cron li importa
-- nel DMS via Storage::upload(), poi sposta il file su Drive in
-- _Importati/<data>/.
--
-- Approccio "B": le cartelle sono create dal portale, quindi la
-- risoluzione cartella -> (azienda/dipendente/reparto) e'
-- deterministica. Le cartelle non riconosciute finiscono in una
-- coda di revisione (stato='errore') senza importare nulla.
--
-- dms_inbound_state: un record per file visto nell'inbox, usato
-- per la deduplica (non re-importare lo stesso file) e come log
-- della coda di revisione.
-- ============================================================

USE portal_template;

CREATE TABLE IF NOT EXISTS dms_inbound_state (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    remote_path  VARCHAR(700) NOT NULL,                 -- path relativo dentro l'inbox
    file_sig     VARCHAR(120) NOT NULL DEFAULT '',      -- firma "size|modtime": cambia se il file e' sostituito
    size         BIGINT       NOT NULL DEFAULT 0,
    stato        ENUM('importato','errore') NOT NULL,
    documento_id INT          NULL,                     -- valorizzato su import riuscito (no FK: il log sopravvive alla cancellazione del doc)
    azienda_id   INT          NULL,
    user_id      INT          NULL,
    tipo_id      INT          NULL,
    visibilita   VARCHAR(20)  NULL,
    errore       VARCHAR(500) NULL,                     -- motivo se stato='errore'
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_remote_path (remote_path(191)),
    KEY idx_stato (stato, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed impostazioni dell'inbound (spente di default).
-- Il drive collegato (dms_mirror_remote) e' condiviso con il mirror:
-- l'inbound riusa lo stesso remote rclone, solo una cartella diversa.
INSERT INTO impostazioni (chiave, valore, tipo, gruppo, etichetta) VALUES
    ('dms_inbound_attivo',     '0', 'booleano', 'integrazioni', 'Importazione da Drive attiva'),
    ('dms_inbound_base_path',  '',  'testo',    'integrazioni', 'Cartella inbox sul drive'),
    ('dms_inbound_tipo_default','', 'numero',   'integrazioni', 'Tipo documento di default per i file importati'),
    ('dms_inbound_post_import','sposta','testo','integrazioni', 'Dopo l''import: sposta in _Importati o elimina da Drive'),
    ('dms_inbound_last_run',   '',  'testo',    'integrazioni', 'Ultima importazione (timestamp)'),
    ('dms_inbound_last_esito', '',  'testo',    'integrazioni', 'Esito ultima importazione')
ON DUPLICATE KEY UPDATE chiave = VALUES(chiave);
