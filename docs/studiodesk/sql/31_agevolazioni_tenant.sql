-- ============================================================
-- migrations/31_agevolazioni_tenant.sql
--
-- Modulo Agevolazioni - tabelle PER-TENANT.
-- Dati specifici del tenant: monitoraggi bandi, bandi salvati per
-- azienda, cache plafond, snapshot storico mensili.
-- Aggiunge anche permessi ACL, impostazioni di default, evento
-- notifica per alert plafond >80%.
--
-- Da eseguire su ogni tenant (portal_<slug>):
--   for db in $(mysql -N -B -u root -e "SELECT db_name FROM portal_master.studios WHERE attivo=1"); do
--     mysql -u root "$db" < migrations/31_agevolazioni_tenant.sql
--   done
--
-- Idempotente.
-- ============================================================

-- ── 1. agevolazioni_monitoraggi ──────────────────────────────
-- Profili di monitoraggio bandi salvati dall'utente. I filtri sono
-- in JSON: l'utente li costruisce dalla UI di ricerca e clicca "Salva".
CREATE TABLE IF NOT EXISTS agevolazioni_monitoraggi (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id              INT NULL,
    user_id                 INT NOT NULL,
    nome_profilo            VARCHAR(255) NOT NULL,
    filtri                  JSON NOT NULL,
    notifiche_attive        TINYINT(1) NOT NULL DEFAULT 1,
    frequenza_notifica      ENUM('immediata','giornaliera','settimanale') NOT NULL DEFAULT 'settimanale',
    email_notifica          VARCHAR(255) NULL,
    attivo                  TINYINT(1) NOT NULL DEFAULT 1,
    data_creazione          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_aggiornamento      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    data_ultima_notifica    TIMESTAMP NULL,
    ultimo_bando_visto_id   INT NULL,
    INDEX idx_az      (azienda_id),
    INDEX idx_user    (user_id),
    INDEX idx_attivo  (attivo, notifiche_attive),
    INDEX idx_freq    (frequenza_notifica),
    CONSTRAINT fk_agev_mon_az   FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE,
    CONSTRAINT fk_agev_mon_user FOREIGN KEY (user_id)    REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. agevolazioni_monitoraggi_notifiche ────────────────────
-- Log delle notifiche bandi inviate (idempotente su monitoraggio+bando).
CREATE TABLE IF NOT EXISTS agevolazioni_monitoraggi_notifiche (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    monitoraggio_id    INT NOT NULL,
    bando_id           INT NOT NULL,
    data_invio         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    email_destinatario VARCHAR(255) NULL,
    esito              ENUM('inviata','errore','saltata') NOT NULL DEFAULT 'inviata',
    messaggio_errore   VARCHAR(2000) NULL,
    UNIQUE KEY uk_mon_bando (monitoraggio_id, bando_id),
    INDEX idx_mon (monitoraggio_id),
    INDEX idx_bando (bando_id),
    CONSTRAINT fk_agev_mon_not_mon FOREIGN KEY (monitoraggio_id)
        REFERENCES agevolazioni_monitoraggi(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. agevolazioni_bandi_salvati ────────────────────────────
-- Preferiti / pipeline: l'utente segna i bandi su cui sta valutando.
-- Vincolato a un'azienda (admin studio + responsabile azienda).
CREATE TABLE IF NOT EXISTS agevolazioni_bandi_salvati (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    bando_id            INT NOT NULL,    -- FK logica a portal_master.bandi
    azienda_id          INT NULL,
    user_id             INT NOT NULL,
    note                TEXT NULL,
    stato_interesse     ENUM('interessato','in_valutazione','candidatura_inviata','vinto','scartato')
                        NOT NULL DEFAULT 'interessato',
    data_salvataggio    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_aggiornamento  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_bando_user_az (bando_id, user_id, azienda_id),
    INDEX idx_az (azienda_id),
    INDEX idx_user (user_id),
    INDEX idx_stato (stato_interesse),
    CONSTRAINT fk_agev_bs_az   FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE,
    CONSTRAINT fk_agev_bs_user FOREIGN KEY (user_id)    REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. agevolazioni_plafond_cache ────────────────────────────
-- Cache 24h del calcolo de minimis per azienda. Evita rebuild continuo:
-- la maschera widget carica il valore in cache se < ttl_ore, altrimenti
-- ricalcola (e aggiorna la cache).
CREATE TABLE IF NOT EXISTS agevolazioni_plafond_cache (
    azienda_id              INT PRIMARY KEY,
    cf_calcolato            VARCHAR(20) NOT NULL,
    esl_consumato           DECIMAL(15,2) NOT NULL DEFAULT 0,
    plafond_totale          DECIMAL(15,2) NOT NULL DEFAULT 300000.00,
    plafond_disponibile     DECIMAL(15,2) NOT NULL DEFAULT 300000.00,
    percentuale_utilizzata  DECIMAL(5,2)  NOT NULL DEFAULT 0,
    triennio_da             DATE NOT NULL,
    triennio_a              DATE NOT NULL,
    aiuti_count             INT NOT NULL DEFAULT 0,
    data_calcolo            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- ttl_ore di default 24, configurabile via impostazioni se serve
    ttl_ore                 SMALLINT NOT NULL DEFAULT 24,
    INDEX idx_cf (cf_calcolato),
    INDEX idx_pct (percentuale_utilizzata),
    INDEX idx_calc (data_calcolo),
    CONSTRAINT fk_agev_cache_az FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. agevolazioni_plafond_storico ──────────────────────────
-- Snapshot mensile dello stato plafond per azienda. Popolato dal cron
-- alla fine di ogni mese -> permette grafico storico nel widget cliente.
CREATE TABLE IF NOT EXISTS agevolazioni_plafond_storico (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id              INT NOT NULL,
    anno                    SMALLINT NOT NULL,
    mese                    TINYINT  NOT NULL,
    esl_consumato           DECIMAL(15,2) NOT NULL,
    plafond_disponibile     DECIMAL(15,2) NOT NULL,
    percentuale_utilizzata  DECIMAL(5,2)  NOT NULL,
    aiuti_count             INT NOT NULL DEFAULT 0,
    snapshot_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_az_anno_mese (azienda_id, anno, mese),
    INDEX idx_az (azienda_id),
    CONSTRAINT fk_agev_stor_az FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. agevolazioni_alert_plafond_log ────────────────────────
-- Log degli alert email mandati quando plafond > soglia (default 80%).
-- Idempotente per evitare spam: una sola email per (azienda, soglia, mese).
CREATE TABLE IF NOT EXISTS agevolazioni_alert_plafond_log (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id      INT NOT NULL,
    soglia_pct      TINYINT NOT NULL,
    pct_al_momento  DECIMAL(5,2) NOT NULL,
    anno_mese       VARCHAR(7) NOT NULL,   -- "2026-05"
    data_invio      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_az_soglia_mese (azienda_id, soglia_pct, anno_mese),
    CONSTRAINT fk_agev_alert_az FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. Permessi ACL ──────────────────────────────────────────
INSERT INTO permessi (codice, etichetta, area, ordine) VALUES
    ('agevolazioni.vedere',  'Agevolazioni - visualizza',  'Lavoro', 60),
    ('agevolazioni.gestire', 'Agevolazioni - gestisce CRUD bandi/monitoraggi', 'Lavoro', 61)
ON DUPLICATE KEY UPDATE etichetta = VALUES(etichetta);

-- Default ruoli:
--  direzione: vedere + gestire (rank 2)
--  responsabile: vedere + gestire (lead operativo)
--  operatore + capoufficio: solo vedere
INSERT IGNORE INTO ruoli_permessi (ruolo_id, permesso_id)
SELECT r.id, p.id FROM ruoli r JOIN permessi p
WHERE
    (r.nome IN ('direzione','responsabile') AND p.codice IN ('agevolazioni.vedere','agevolazioni.gestire'))
 OR (r.nome IN ('operatore','capoufficio')  AND p.codice = 'agevolazioni.vedere');

-- ── 8. Impostazioni tenant (seed off) ────────────────────────
INSERT INTO impostazioni (chiave, valore, tipo, gruppo, etichetta) VALUES
    ('agevolazioni_attivo',           '0',   'booleano', 'agevolazioni', 'Modulo Agevolazioni (RNA + Bandi) attivo'),
    ('agevolazioni_alert_plafond_pct','80',  'numero',   'agevolazioni', 'Soglia % per alert plafond (0=disattivo)'),
    ('agevolazioni_cache_ore',        '24',  'numero',   'agevolazioni', 'TTL cache plafond (ore)'),
    ('agevolazioni_snapshot_mensile', '1',   'booleano', 'agevolazioni', 'Snapshot storico mensile plafond'),
    ('agevolazioni_bandi_default_regione', '', 'testo',  'agevolazioni', 'Regione di default per bandi suggeriti (es. "Lombardia")')
ON DUPLICATE KEY UPDATE chiave = VALUES(chiave);

-- ── 9. Eventi notifica email (default off, configurabili da /admin/notifiche) ──
INSERT INTO notifiche_config (evento, destinatario, attiva) VALUES
    ('plafond_alert_80',         'cliente_azienda', 0),
    ('nuovi_bandi_compatibili',  'cliente_azienda', 0)
ON DUPLICATE KEY UPDATE destinatario = VALUES(destinatario);

