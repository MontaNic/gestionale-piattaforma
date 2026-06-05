-- ============================================================
-- portal_template — schema STUDIO (1 DB per tenant)
-- Schema multi-tenant ripulito:
--  - Niente tickets/messaggi legacy (sostituiti da comunicazioni)
--  - Niente routing automatico, niente operatori_competenze, niente numerixl
--  - Foreign key ON DELETE coerenti (CASCADE / SET NULL)
--  - Indici minimi per query ricorrenti
-- ============================================================

-- IMPORTANTE: prima di importare, sostituire `portal_template` con
-- il vero nome del DB (es. portal_main, portal_studio_X).

CREATE DATABASE IF NOT EXISTS portal_template
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE portal_template;

-- ── RUOLI E PERMESSI ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ruoli (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    nome        VARCHAR(50) NOT NULL UNIQUE,
    colore      VARCHAR(7)  NOT NULL DEFAULT '#3b82f6',
    descrizione VARCHAR(255) NULL,
    INDEX idx_nome (nome)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permessi (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    codice      VARCHAR(80) NOT NULL UNIQUE,
    etichetta   VARCHAR(150) NOT NULL,
    area        VARCHAR(50) NOT NULL DEFAULT 'generale',
    ordine      INT DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ruoli_permessi (
    ruolo_id    INT NOT NULL,
    permesso_id INT NOT NULL,
    PRIMARY KEY (ruolo_id, permesso_id),
    FOREIGN KEY (ruolo_id)    REFERENCES ruoli(id)    ON DELETE CASCADE,
    FOREIGN KEY (permesso_id) REFERENCES permessi(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── REPARTI (gruppi interni) ──────────────────────────────
CREATE TABLE IF NOT EXISTS reparti (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    nome        VARCHAR(80) NOT NULL,
    descrizione VARCHAR(255) NULL,
    colore      VARCHAR(7)  NOT NULL DEFAULT '#64748b',
    icona       VARCHAR(10) NULL,
    attivo      TINYINT(1)  NOT NULL DEFAULT 1,
    ordine      INT DEFAULT 0,
    solo_team   TINYINT(1)  NOT NULL DEFAULT 0
) ENGINE=InnoDB;

-- ── AZIENDE (clienti dello studio) ────────────────────────
CREATE TABLE IF NOT EXISTS aziende (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    codice          VARCHAR(20) NOT NULL UNIQUE,
    nome            VARCHAR(200) NOT NULL,
    tipo_cliente    ENUM('azienda','persona_fisica') NOT NULL DEFAULT 'azienda',
    partita_iva     VARCHAR(20)  NULL,
    codice_fiscale  VARCHAR(20)  NULL,
    codice_ateco    VARCHAR(20)  NULL,
    email           VARCHAR(255) NULL,
    email_operativa VARCHAR(255) NULL,
    sito_web        VARCHAR(255) NULL,
    note_operative  TEXT         NULL,
    pec             VARCHAR(255) NULL,
    telefono        VARCHAR(40)  NULL,
    telefono_2      VARCHAR(40)  NULL,
    indirizzo       VARCHAR(255) NULL,
    attivo          TINYINT(1)   NOT NULL DEFAULT 1,
    operatore_riferimento_id INT NULL DEFAULT NULL,   -- RFM lato studio (scheda azienda admin)
    eliminato       TINYINT(1)   NOT NULL DEFAULT 0,
    eliminata_il    DATETIME     NULL,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_az_attivo (attivo, eliminato),
    INDEX idx_az_nome (nome),
    INDEX idx_az_op_rfm (operatore_riferimento_id)
    -- NB: FK su users(id) posticipata dopo CREATE TABLE users (vedi sotto).
) ENGINE=InnoDB;

-- ── UTENTI (operatori interni + clienti) ──────────────────
CREATE TABLE IF NOT EXISTS users (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    nome                VARCHAR(100) NOT NULL,
    cognome             VARCHAR(100) NULL,
    email               VARCHAR(255) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    -- 2FA TOTP (RFC 6238). totp_secret è il segreto base32 cifrato/raw,
    -- recovery_codes è un JSON array di hash bcrypt (one-time-use).
    totp_secret         VARBINARY(64) NULL,
    totp_enabled        TINYINT(1)    NOT NULL DEFAULT 0,
    totp_recovery_codes JSON          NULL,
    totp_enabled_at     DATETIME      NULL,
    -- Scadenza password (migration 43). password_changed_at = base per il
    -- calcolo; password_storico = JSON degli ultimi hash usati (anti-riciclo).
    password_changed_at DATETIME      NULL,
    password_storico    JSON          NULL,
    avatar_emoji        VARCHAR(10)  NULL,
    telefono            VARCHAR(40)  NULL,

    -- Ruolo principale (admin, direzione, responsabile, operatore, cliente)
    ruolo               ENUM('admin','direzione','responsabile','operatore','cliente') NOT NULL DEFAULT 'cliente',
    ruolo_id            INT NULL,

    -- Solo per ruolo='cliente': rapporto con la sua azienda
    azienda_id          INT NULL,
    cliente_ruolo       ENUM('admin','utente') NULL DEFAULT 'utente',

    -- Solo per ruoli interni
    bio                 TEXT         NULL,
    telefono_lavoro     VARCHAR(40)  NULL,
    note                TEXT         NULL,
    orari_json          JSON         NULL,
    disponibile         TINYINT(1)   NOT NULL DEFAULT 1,
    disponibilita_aggiornata TIMESTAMP NULL DEFAULT NULL,
    non_disponibile_dal DATETIME     NULL,
    escludi_routing     TINYINT(1)   NOT NULL DEFAULT 0,

    -- Telegram
    telegram_chat_id    BIGINT NULL DEFAULT NULL,
    -- WhatsApp Cloud API (E.164 senza "+", es. "393331234567")
    whatsapp_numero     VARCHAR(20)  NULL DEFAULT NULL,

    -- Stato
    attivo              TINYINT(1)   NOT NULL DEFAULT 1,
    eliminato           TINYINT(1)   NOT NULL DEFAULT 0,
    eliminato_il        DATETIME     NULL,
    eliminato_da        INT          NULL,
    eliminato_motivo    VARCHAR(255) NULL,

    created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (ruolo_id)   REFERENCES ruoli(id)   ON DELETE SET NULL,
    FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE SET NULL,
    INDEX idx_u_ruolo  (ruolo, attivo, eliminato),
    INDEX idx_u_azienda (azienda_id),
    INDEX idx_u_email  (email)
) ENGINE=InnoDB;

-- FK posticipata di aziende.operatore_riferimento_id (users viene creato qui sopra).
ALTER TABLE aziende
    ADD CONSTRAINT fk_az_op_rfm FOREIGN KEY (operatore_riferimento_id)
        REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS utenti_permessi (
    user_id     INT NOT NULL,
    permesso_id INT NOT NULL,
    concesso    TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, permesso_id),
    FOREIGN KEY (user_id)     REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (permesso_id) REFERENCES permessi(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reparti_utenti (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    reparto_id    INT NOT NULL,
    user_id       INT NOT NULL,
    ruolo_reparto ENUM('responsabile','membro') NOT NULL DEFAULT 'membro',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_rep_user (reparto_id, user_id),
    FOREIGN KEY (reparto_id) REFERENCES reparti(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)    REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── COMUNICAZIONI (sistema unico, sostituisce tickets) ────
CREATE TABLE IF NOT EXISTS comunicazioni (
    id                     INT AUTO_INCREMENT PRIMARY KEY,
    codice                 VARCHAR(20) NOT NULL UNIQUE,
    azienda_id             INT NOT NULL,
    user_id                INT NOT NULL,        -- chi l'ha aperta
    operatore_assegnato_id INT NULL,            -- operatore studio in carico (NULL = da prendere)
    aperta_da              ENUM('studio','cliente') NOT NULL,
    oggetto                VARCHAR(255) NOT NULL,
    urgente                TINYINT(1)   NOT NULL DEFAULT 0,
    chiusa                 TINYINT(1)   NOT NULL DEFAULT 0,
    chiusa_il              DATETIME     NULL,
    auto_chiusa_motivo     VARCHAR(40)  NULL DEFAULT NULL,
    snoozed_until          DATETIME     NULL DEFAULT NULL,
    snoozed_by             INT          NULL DEFAULT NULL,
    created_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (azienda_id)             REFERENCES aziende(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)                REFERENCES users(id)   ON DELETE RESTRICT,
    FOREIGN KEY (operatore_assegnato_id) REFERENCES users(id)   ON DELETE SET NULL,
    INDEX idx_co_az_chiusa  (azienda_id, chiusa),
    INDEX idx_co_urgente    (urgente, chiusa),
    INDEX idx_co_updated    (updated_at),
    INDEX idx_co_operatore  (operatore_assegnato_id, chiusa),
    INDEX idx_com_inbox     (chiusa, operatore_assegnato_id, urgente, updated_at),
    INDEX idx_com_azienda_aperte (azienda_id, chiusa, updated_at),
    INDEX idx_snoozed       (snoozed_until)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS com_messaggi (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    comunicazione_id  INT NOT NULL,
    user_id           INT NOT NULL,
    testo             TEXT NOT NULL,
    lato              ENUM('studio','cliente','interno') NOT NULL,
                              -- 'interno' = nota tra operatori, NON visibile al cliente
    origine           ENUM('portale','telegram','email','sa','whatsapp') NOT NULL DEFAULT 'portale',
    letto_studio      TINYINT(1) NOT NULL DEFAULT 0,
    letto_cliente     TINYINT(1) NOT NULL DEFAULT 0,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comunicazione_id) REFERENCES comunicazioni(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)          REFERENCES users(id)         ON DELETE RESTRICT,
    INDEX idx_cm_com (comunicazione_id),
    INDEX idx_cm_letti (lato, letto_studio, letto_cliente)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS com_allegati (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    messaggio_id INT NOT NULL,
    nome_orig    VARCHAR(255) NOT NULL,
    percorso     VARCHAR(500) NOT NULL,
    mime_type    VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
    dimensione   INT NOT NULL DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (messaggio_id) REFERENCES com_messaggi(id) ON DELETE CASCADE,
    INDEX idx_ca_msg (messaggio_id)
) ENGINE=InnoDB;

-- Log/dedup messaggi inbound WhatsApp (mirror canalizzato di telegram_tokens
-- ma su messaggi, non su token). UNIQUE su wa_message_id per dedup degli
-- update ritrasmessi da Meta.
CREATE TABLE IF NOT EXISTS whatsapp_inbound_log (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    wa_message_id    VARCHAR(120) NOT NULL,
    wa_from          VARCHAR(20)  NOT NULL,
    wa_phone_id      VARCHAR(50)  NULL,
    user_id          INT          NULL,
    comunicazione_id INT          NULL,
    messaggio_id     INT          NULL,
    tipo             VARCHAR(20)  NOT NULL DEFAULT 'text',
    payload_summary  VARCHAR(500) NULL,
    esito            ENUM('ok','no_user','no_text','dup','error') NOT NULL DEFAULT 'ok',
    note             VARCHAR(255) NULL,
    received_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_wa_msgid (wa_message_id),
    INDEX idx_wa_from     (wa_from),
    INDEX idx_wa_user     (user_id),
    INDEX idx_wa_com      (comunicazione_id),
    INDEX idx_wa_received (received_at),
    CONSTRAINT fk_wa_user FOREIGN KEY (user_id)          REFERENCES users(id)          ON DELETE SET NULL,
    CONSTRAINT fk_wa_com  FOREIGN KEY (comunicazione_id) REFERENCES comunicazioni(id)  ON DELETE SET NULL,
    CONSTRAINT fk_wa_msg  FOREIGN KEY (messaggio_id)     REFERENCES com_messaggi(id)   ON DELETE SET NULL
) ENGINE=InnoDB;

-- ── KNOWLEDGE BASE + REVISIONI AI ──────────────────────────
CREATE TABLE IF NOT EXISTS categorie (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    nome        VARCHAR(100) NOT NULL,
    descrizione TEXT NULL,
    colore      VARCHAR(7)  NOT NULL DEFAULT '#3b82f6',
    reparto_id  INT NULL,
    FOREIGN KEY (reparto_id) REFERENCES reparti(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS knowledge_base (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    domanda       TEXT NOT NULL,
    risposta      TEXT NOT NULL,
    categoria_id  INT NULL,
    attivo        TINYINT(1) NOT NULL DEFAULT 1,
    origine       VARCHAR(30) NULL DEFAULT NULL
                  COMMENT 'manuale (NULL) | ai_da_domanda | ai_genera | ai_assist | ai_modificata',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (categoria_id) REFERENCES categorie(id) ON DELETE SET NULL,
    FULLTEXT KEY ft_dom_ris (domanda, risposta),
    INDEX idx_kb_attivo (attivo),
    INDEX idx_kb_origine (origine)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS kb_revisioni (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    kb_id         INT NOT NULL,
    testo_prima   TEXT NOT NULL,
    testo_dopo    TEXT NOT NULL,
    motivo        TEXT NULL,
    letta         TINYINT(1) NOT NULL DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_base(id) ON DELETE CASCADE,
    INDEX idx_kbr_letta (letta, created_at)
) ENGINE=InnoDB;

-- ── SCADENZE FISCALI ──────────────────────────────────────
-- Visibilità per cliente (privacy/GDPR): ogni scadenza dichiara
-- chi può vederla. Tipica usata da memo manuali ("Scadenza CIE
-- — Mario Rossi") che prima erano globali e ora sono per-utente.
-- FK su reparti_azienda aggiunta più sotto (dopo CREATE di quella tabella).
CREATE TABLE IF NOT EXISTS scadenze (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    titolo          VARCHAR(255) NOT NULL,
    descrizione     TEXT NULL,
    data_scadenza   DATE NOT NULL,
    categoria_id    INT NULL,
    attivo          TINYINT(1) NOT NULL DEFAULT 1,
    origine         ENUM('manuale','import_ufficiale','ai') NOT NULL DEFAULT 'manuale',
    visibilita      ENUM('tutti','azienda','reparto','utente') NOT NULL DEFAULT 'tutti',
    azienda_id      INT NULL,
    reparto_id      INT NULL,
    user_id         INT NULL,
    da_revisionare  TINYINT(1) NOT NULL DEFAULT 0,
    codice_import   VARCHAR(80) NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (categoria_id) REFERENCES categorie(id) ON DELETE SET NULL,
    CONSTRAINT fk_sc_azienda FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE SET NULL,
    CONSTRAINT fk_sc_user    FOREIGN KEY (user_id)    REFERENCES users(id)   ON DELETE SET NULL,
    UNIQUE KEY uniq_codice_import (codice_import),
    INDEX idx_sc_data (data_scadenza, attivo),
    INDEX idx_sc_azienda (azienda_id, attivo),
    INDEX idx_sc_user (user_id, attivo),
    INDEX idx_sc_revisione (da_revisionare)
) ENGINE=InnoDB;

-- ── NOTIFICHE ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifiche (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    tipo        VARCHAR(50) NOT NULL,
    titolo      VARCHAR(255) NOT NULL,
    testo       TEXT NULL,
    link        VARCHAR(500) NULL,
    letta       TINYINT(1) NOT NULL DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_nt_user_letta (user_id, letta, created_at)
) ENGINE=InnoDB;

-- ── CONFIG NOTIFICHE EMAIL (per evento) ───────────────────
CREATE TABLE IF NOT EXISTS notifiche_config (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    evento                VARCHAR(60) NOT NULL UNIQUE,
    attiva                TINYINT(1)  NOT NULL DEFAULT 1,
    destinatario          ENUM('cliente_azienda','operatore_assegnato','utente_target','admin_studio') NOT NULL,
    subject_override      VARCHAR(255) NULL,
    body_override         TEXT         NULL,
    cta_label_override    VARCHAR(80)  NULL,
    note_admin            VARCHAR(255) NULL,
    updated_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_nc_evento (evento, attiva)
) ENGINE=InnoDB;

INSERT INTO notifiche_config (evento, attiva, destinatario) VALUES
    ('ticket_aperta_cliente',       1, 'operatore_assegnato'),
    ('ticket_aperta_studio',        1, 'cliente_azienda'),
    ('ticket_risposta_studio',      1, 'cliente_azienda'),
    ('ticket_risposta_cliente',     1, 'operatore_assegnato'),
    ('ticket_chiusa',               1, 'cliente_azienda'),
    ('ticket_assegnato_operatore',  1, 'utente_target'),
    ('scadenza_memo_7gg',           0, 'cliente_azienda'),
    ('scadenza_memo_1gg',           0, 'cliente_azienda'),
    ('documento_caricato',          0, 'cliente_azienda'),
    ('documento_caricato_studio',   1, 'operatore_assegnato'),
    ('questionario_assegnato',      1, 'utente_target'),
    ('questionario_completato',     1, 'admin_studio'),
    ('questionario_sollecito',      1, 'utente_target'),
    -- Preventivi (Fase 2 modulo Preventivi)
    ('preventivo_inviato',          1, 'utente_target'),
    ('preventivo_accettato',        1, 'admin_studio'),
    ('preventivo_rifiutato',        1, 'admin_studio'),
    ('preventivo_revisione',        1, 'admin_studio'),
    ('preventivo_in_scadenza',      0, 'admin_studio')
ON DUPLICATE KEY UPDATE evento = VALUES(evento);

-- ── INVITI (onboarding clienti) ────────────────────────────
CREATE TABLE IF NOT EXISTS inviti (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id  INT NOT NULL,
    -- Ruolo proposto: l'admin studio sceglie se invitarlo come admin azienda
    -- o come dipendente normale; il valore viene applicato a registrati.php.
    cliente_ruolo ENUM('admin','utente') NOT NULL DEFAULT 'utente',
    email       VARCHAR(255) NOT NULL,
    token       VARCHAR(64)  NOT NULL UNIQUE,
    invitato_da INT NULL,
    accettato   TINYINT(1) NOT NULL DEFAULT 0,
    accettato_il DATETIME NULL,
    scadenza    DATETIME NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (azienda_id)  REFERENCES aziende(id) ON DELETE CASCADE,
    FOREIGN KEY (invitato_da) REFERENCES users(id)   ON DELETE SET NULL,
    INDEX idx_in_token (token, accettato)
) ENGINE=InnoDB;

-- ── PASSWORD RESET ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    token      VARCHAR(64) NOT NULL UNIQUE,
    scade_il   DATETIME NOT NULL,
    usato      TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── IMPOSTAZIONI (configurazione studio / branding) ────────
CREATE TABLE IF NOT EXISTS impostazioni (
    chiave      VARCHAR(80) PRIMARY KEY,
    valore      TEXT NULL,
    tipo        ENUM('testo','booleano','numero','json','colore','file') NOT NULL DEFAULT 'testo',
    gruppo      VARCHAR(40) NULL,
    etichetta   VARCHAR(150) NULL,
    descrizione VARCHAR(255) NULL
) ENGINE=InnoDB;

-- ── AUDIT LOG ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NULL,
    ip          VARCHAR(45) NULL,
    azione      VARCHAR(80) NOT NULL,
    entita      VARCHAR(80) NULL,
    entita_id   INT NULL,
    dettagli    JSON NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_al_user (user_id, created_at),
    INDEX idx_al_az   (azione, created_at)
) ENGINE=InnoDB;

-- ── RICHIESTE MODIFICA (approvazioni admin/direzione) ──────
CREATE TABLE IF NOT EXISTS richieste_modifica (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT NOT NULL,
    tipo         VARCHAR(50) NOT NULL,
    payload      JSON NOT NULL,
    stato        ENUM('attesa','approvata','rifiutata') NOT NULL DEFAULT 'attesa',
    note         TEXT NULL,
    risolto_da   INT NULL,
    risolto_il   DATETIME NULL,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (risolto_da) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_rm_stato (stato, created_at)
) ENGINE=InnoDB;

-- ── PREFERENZE UTENTE ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferenze (
    user_id     INT NOT NULL,
    chiave      VARCHAR(80) NOT NULL,
    valore      TEXT NULL,
    PRIMARY KEY (user_id, chiave),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── SITO PUBBLICO STUDIO (landing index.php) ──────────────
CREATE TABLE IF NOT EXISTS studio_sezioni (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    tipo       ENUM('hero','about','servizi','contatti','custom') NOT NULL DEFAULT 'custom',
    titolo     VARCHAR(255) NULL,
    contenuto  TEXT NULL,
    icona      VARCHAR(10) NULL DEFAULT '⭐',
    colore     VARCHAR(7)  NOT NULL DEFAULT '#2563eb',
    ordine     INT NOT NULL DEFAULT 0,
    attivo     TINYINT(1)  NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ss_attivo (attivo, ordine)
) ENGINE=InnoDB;

-- ── LOGIN ATTEMPTS (rate limiting brute-force) ────────────
CREATE TABLE IF NOT EXISTS login_attempts (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(255) NULL,
    ip          VARCHAR(45) NOT NULL,
    successo    TINYINT(1) NOT NULL DEFAULT 0,
    user_agent  VARCHAR(255) NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_la_ip_time    (ip, created_at),
    INDEX idx_la_email_time (email, created_at)
) ENGINE=InnoDB;

-- ── TELEGRAM (link account cliente ↔ chat_id) ──────────────
CREATE TABLE IF NOT EXISTS telegram_tokens (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    token      VARCHAR(64) NOT NULL UNIQUE,
    usato      TINYINT(1) NOT NULL DEFAULT 0,
    scade_il   DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── SEED DATI BASE ─────────────────────────────────────────
INSERT INTO ruoli (nome, colore, descrizione) VALUES
    ('admin',        '#dc2626', 'Accesso completo allo studio'),
    ('direzione',    '#7c3aed', 'Direzione strategica'),
    ('responsabile', '#2563eb', 'Coordina operatori'),
    ('operatore',    '#10b981', 'Gestione clienti e comunicazioni'),
    ('cliente',      '#64748b', 'Cliente dello studio')
ON DUPLICATE KEY UPDATE nome = VALUES(nome);

INSERT INTO permessi (codice, etichetta, area, ordine) VALUES
    ('comunicazioni.gestire',  'Gestione comunicazioni', 'Lavoro',     10),
    ('aziende.gestire',        'Gestione aziende',       'Clienti',    20),
    ('utenti.gestire',         'Gestione utenti',        'Team',       30),
    ('reparti.gestire',        'Gestione reparti',       'Team',       31),
    ('kb.gestire',             'Knowledge Base',         'Lavoro',     40),
    ('ai.usare',               'Uso AI assistant',       'Lavoro',     41),
    ('questionari.gestire',    'Gestione questionari',   'Lavoro',     42),
    ('impostazioni.gestire',   'Impostazioni studio',    'Sistema',    50),
    ('audit.vedere',           'Visualizza audit log',   'Sistema',    51),
    ('approvazioni.gestire',   'Approva richieste',      'Sistema',    52)
ON DUPLICATE KEY UPDATE etichetta = VALUES(etichetta);

-- ─ Default ruoli_permessi (matrice canonica) ─
-- admin: nessuna riga (la check in ACLController::puo() ritorna sempre true)
-- direzione: TUTTI i permessi (rank 2, accesso completo)
-- responsabile: operatività + gestione team/clienti, NO sistema/archivio
-- operatore: solo operatività (comunicazioni, KB, AI, bozze circolari)
-- I codici circolari.* sono seedati anche da migrations/13_circolari_v2.sql
INSERT IGNORE INTO ruoli_permessi (ruolo_id, permesso_id)
SELECT r.id, p.id FROM ruoli r JOIN permessi p
WHERE
    -- direzione (rank 2): tutto tranne admin-only logic
    (r.nome = 'direzione' AND p.codice IN (
        'comunicazioni.gestire','aziende.gestire','utenti.gestire','reparti.gestire',
        'kb.gestire','ai.usare','questionari.gestire','impostazioni.gestire','audit.vedere','approvazioni.gestire'
    ))
    OR
    -- responsabile (rank 1): coordinatore team
    (r.nome = 'responsabile' AND p.codice IN (
        'comunicazioni.gestire','aziende.gestire','utenti.gestire','reparti.gestire',
        'kb.gestire','ai.usare','questionari.gestire','approvazioni.gestire'
    ))
    OR
    -- operatore (rank 0): operatività pura
    (r.nome = 'operatore' AND p.codice IN (
        'comunicazioni.gestire','kb.gestire','ai.usare','questionari.gestire'
    ));

INSERT INTO categorie (nome, colore) VALUES
    ('Generale', '#64748b')
ON DUPLICATE KEY UPDATE nome = VALUES(nome);

-- Reparto sistema "Direzione" (solo team interno, mai per i clienti)
INSERT INTO reparti (nome, descrizione, colore, icona, attivo, ordine, solo_team) VALUES
    ('Direzione', 'Soci e direzione studio', '#7c3aed', '👔', 1, 999, 1)
ON DUPLICATE KEY UPDATE nome = VALUES(nome);

-- Impostazioni base
INSERT INTO impostazioni (chiave, valore, tipo, gruppo, etichetta) VALUES
    ('studio_nome',           'Portal Demo',  'testo',    'branding',     'Nome studio'),
    ('studio_settore',        'Studio',       'testo',    'branding',     'Settore/tagline'),
    ('studio_colore_primario','#2563eb',      'colore',   'branding',     'Colore primario'),
    ('telegram_bot_attivo',   '0',            'booleano', 'integrazioni', 'Bot Telegram attivo'),
    ('telegram_bot_token',    '',             'testo',    'integrazioni', 'Token bot Telegram'),
    ('telegram_bot_username', '',             'testo',    'integrazioni', 'Username bot Telegram'),
    ('sollecito_minuti',      '15',           'numero',   'workflow',     'Minuti minimi prima di poter sollecitare'),
    ('studio_citta',          'Italia',       'testo',    'pubblico',     'Città'),
    ('studio_email',          '',             'testo',    'pubblico',     'Email pubblica'),
    ('studio_telefono',       '',             'testo',    'pubblico',     'Telefono pubblico'),
    ('studio_indirizzo',      '',             'testo',    'pubblico',     'Indirizzo'),
    ('studio_orari',          'Lun-Ven 9-18', 'testo',    'pubblico',     'Orari di apertura'),
    ('studio_iniziale',       '',             'testo',    'branding',     'Iniziale logo'),
    ('sito_pubblico_attivo',  '1',            'booleano', 'pubblico',     'Sito pubblico attivo'),
    ('smtp_host',             '',             'testo',    'smtp',         'Host SMTP'),
    ('smtp_port',             '587',          'numero',   'smtp',         'Porta SMTP'),
    ('smtp_user',             '',             'testo',    'smtp',         'Username SMTP'),
    ('smtp_pass',             '',             'testo',    'smtp',         'Password SMTP'),
    ('smtp_from',             '',             'testo',    'smtp',         'Email mittente (From)')
ON DUPLICATE KEY UPDATE chiave = VALUES(chiave);

-- Seed WhatsApp Cloud API (add-on a pagamento, gating in src/piani.php)
INSERT INTO impostazioni (chiave, valore, tipo, gruppo, etichetta) VALUES
    ('whatsapp_attivo',          '0',  'booleano', 'integrazioni', 'WhatsApp Cloud API attivo'),
    ('whatsapp_phone_id',        '',   'testo',    'integrazioni', 'Meta Phone Number ID'),
    ('whatsapp_token',           '',   'testo',    'integrazioni', 'Permanent Access Token Meta'),
    ('whatsapp_app_secret',      '',   'testo',    'integrazioni', 'App Secret per firma webhook'),
    ('whatsapp_verify_token',    '',   'testo',    'integrazioni', 'Verify Token (handshake GET webhook)'),
    ('whatsapp_numero_display',  '',   'testo',    'integrazioni', 'Numero WhatsApp pubblico (display)'),
    ('whatsapp_auto_close_ore',  '24', 'numero',   'integrazioni', 'Ore prima della chiusura automatica WA (0=off)'),
    ('whatsapp_business_account_id','','testo',    'integrazioni', 'Meta WABA ID (opz.)')
ON DUPLICATE KEY UPDATE chiave = VALUES(chiave);

-- Sezioni di default per il sito pubblico
INSERT INTO studio_sezioni (tipo, titolo, contenuto, icona, colore, ordine) VALUES
('hero',     'Portal Demo',
 'Studio professionale al tuo fianco — comunicazioni, scadenze e documenti in un unico portale.',
 '🏛️', '#2563eb', 1),
('about',    'Chi siamo',
 'Lo studio supporta privati e aziende nella gestione fiscale, contabile e del lavoro.',
 'ℹ️', '#7c3aed', 2),
('servizi',  'I nostri servizi',
 'Dichiarazioni fiscali|730, Unico, IVA, F24 e scadenze\nContabilità|Bilanci, registrazioni, fatturazione\nBuste paga|Cedolini, CU, TFR\nConsulenza|Pianificazione fiscale personalizzata',
 '💼', '#10b981', 3),
('contatti', 'Contattaci',
 NULL, '📞', '#f59e0b', 4)
ON DUPLICATE KEY UPDATE titolo = VALUES(titolo);

-- ============================================================
-- Migration 05 — Documenti (per-tenant)
--
-- Sistema di scambio documenti tra studio e cliente. Distinto dagli
-- allegati di comunicazione (`com_allegati`), che restano legati al
-- thread di chat. I documenti hanno:
--   • un tipo (F24, CU, fattura, ecc.) catalogato in `documenti_tipi`
--   • una visibilità (tutti / azienda / utente) per il routing dell'accesso
--   • opzionale password per l'apertura
--   • opzionale conferma di lettura (implicita = ha aperto, esplicita = ha cliccato "ho letto")
--
-- I file fisici vivono fuori dal DocumentRoot (vedi STORAGE_LOCAL_PATH in
-- master.php) — Apache non li serve direttamente, il download passa
-- sempre da `/api/documento.php` → Storage::serve() che applica le ACL.
-- ============================================================


-- ── 0. Reparti AZIENDA cliente ────────────────────────────────
-- Sotto-gruppi di dipendenti dentro la stessa azienda cliente
-- (es. HR / Amministrazione / Operations dentro "ACME Spa").
-- Distinti dalla tabella `reparti` che si riferisce ai team
-- interni dello STUDIO.
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

-- FK posticipata di scadenze.reparto_id (reparti_azienda viene creato qui sopra).
ALTER TABLE scadenze
    ADD CONSTRAINT fk_sc_reparto FOREIGN KEY (reparto_id)
        REFERENCES reparti_azienda(id) ON DELETE SET NULL,
    ADD INDEX idx_sc_reparto (reparto_id);


-- ── 1. Catalogo tipi documento ────────────────────────────────
-- studio_id = NULL  → tipo predefinito di piattaforma (immutabile)
-- studio_id = ID    → tipo custom aggiunto dal tenant
CREATE TABLE IF NOT EXISTS documenti_tipi (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    studio_id           INT          DEFAULT NULL,
    codice              VARCHAR(50)  NOT NULL,
    etichetta           VARCHAR(100) NOT NULL,
    direzione           ENUM('studio_cliente','cliente_studio','bidirezionale') NOT NULL,
    icona               VARCHAR(50)  DEFAULT NULL,
    conferma_default    ENUM('nessuna','implicita','esplicita') NOT NULL DEFAULT 'nessuna',
    password_default    TINYINT(1)   NOT NULL DEFAULT 0,
    visibilita_default  ENUM('tutti','azienda','reparto','utente') NOT NULL DEFAULT 'tutti',
    richiede_firma_default TINYINT(1) NOT NULL DEFAULT 0,
    ordine              INT          NOT NULL DEFAULT 0,
    attivo              TINYINT(1)   NOT NULL DEFAULT 1,
    -- Fase 6C: modello documento (ha uno schema di campi + scadenza).
    is_modello          TINYINT(1)   NOT NULL DEFAULT 0,
    validita_mesi       INT          NULL DEFAULT NULL,
    -- Vincolo: codice unico per (studio_id, codice). NULL counts as distinct
    -- per le righe di piattaforma (gli admin non possono ridefinirle).
    UNIQUE KEY uq_tipo_codice (studio_id, codice),
    INDEX idx_tipo_attivo (attivo, ordine)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Schema dei campi standard di un modello documento (Fase 6C).
CREATE TABLE IF NOT EXISTS documenti_tipi_campi (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    tipo_id      INT NOT NULL,
    etichetta    VARCHAR(120) NOT NULL,
    tipo_campo   ENUM('testo','numero','data') NOT NULL DEFAULT 'testo',
    ruolo        ENUM('generico','numero_documento','ente_rilascio',
                      'data_rilascio','data_scadenza') NOT NULL DEFAULT 'generico',
    obbligatorio TINYINT(1) NOT NULL DEFAULT 1,
    ordine       INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_dtc (tipo_id, etichetta),
    INDEX idx_dtc_tipo (tipo_id, ordine),
    CONSTRAINT fk_dtc_tipo FOREIGN KEY (tipo_id) REFERENCES documenti_tipi(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed dei tipi predefiniti di piattaforma (studio_id = NULL).
-- ON DUPLICATE evita errori se la riga c'è già (re-import).
INSERT INTO documenti_tipi
    (studio_id, codice, etichetta, direzione, icona, conferma_default, password_default, visibilita_default, ordine)
VALUES
    -- Studio → Cliente
    (NULL,'dichiarazione_redditi','Dichiarazione dei redditi',     'studio_cliente','fa-file-alt',           'esplicita',0,'utente', 10),
    (NULL,'f24',                  'F24 da pagare',                 'studio_cliente','fa-file-invoice-dollar','implicita',0,'utente', 20),
    (NULL,'bilancio',             'Bilancio / Situazione contabile','studio_cliente','fa-chart-bar',         'esplicita',0,'azienda',30),
    (NULL,'cedolino',             'Cedolino paga',                 'studio_cliente','fa-money-check-alt',    'implicita',1,'utente', 40),
    (NULL,'cu',                   'CU - Certificazione Unica',     'studio_cliente','fa-certificate',        'esplicita',0,'utente', 50),
    (NULL,'modello_770',          'Modello 770',                   'studio_cliente','fa-file-contract',      'esplicita',0,'azienda',60),
    (NULL,'circolare',            'Circolare / Comunicazione',     'studio_cliente','fa-bullhorn',           'implicita',0,'tutti',  70),
    (NULL,'visura',               'Visura camerale',               'studio_cliente','fa-building',           'nessuna',  0,'azienda',80),
    (NULL,'contratto',            'Contratto / Atto',              'studio_cliente','fa-file-signature',     'esplicita',0,'utente', 90),
    -- Cliente → Studio
    (NULL,'fattura',              'Fattura attiva/passiva',        'cliente_studio','fa-file-invoice',       'nessuna',  0,'tutti', 100),
    (NULL,'estratto_conto',       'Estratto conto bancario',       'cliente_studio','fa-university',         'nessuna',  0,'tutti', 110),
    (NULL,'nota_spese',           'Note spese / Ricevute',         'cliente_studio','fa-receipt',            'nessuna',  0,'tutti', 120),
    (NULL,'documento_identita',   'Documento di identità',         'cliente_studio','fa-id-card',            'nessuna',  0,'utente',130),
    (NULL,'presenze',             'Presenze / Ore lavorate',       'cliente_studio','fa-clock',              'nessuna',  0,'azienda',140),
    (NULL,'documento_dipendente', 'Documenti nuova assunzione',    'cliente_studio','fa-user-plus',          'nessuna',  0,'azienda',150),
    -- Bidirezionale
    (NULL,'altro',                'Altro',                         'bidirezionale', 'fa-file',               'nessuna',  0,'tutti', 999)
ON DUPLICATE KEY UPDATE etichetta = VALUES(etichetta);

-- Modelli documento pre-caricati con i loro campi standard (Fase 6C).
INSERT IGNORE INTO documenti_tipi
    (studio_id, codice, etichetta, direzione, icona, conferma_default,
     password_default, visibilita_default, ordine, attivo, is_modello, validita_mesi)
VALUES
    (NULL,'modello_cie',              'Carta d''identità (CIE)','cliente_studio','fa-id-card',     'nessuna',0,'utente', 210,1,1,120),
    (NULL,'modello_passaporto',       'Passaporto',             'cliente_studio','fa-passport',    'nessuna',0,'utente', 220,1,1,120),
    (NULL,'modello_tessera_sanitaria','Tessera sanitaria',      'cliente_studio','fa-id-card-alt', 'nessuna',0,'utente', 230,1,1,72),
    (NULL,'modello_visura',           'Visura camerale',        'cliente_studio','fa-building',    'nessuna',0,'azienda',240,1,1,6);

SET @cie  := (SELECT id FROM documenti_tipi WHERE codice='modello_cie'               AND studio_id IS NULL);
SET @pass := (SELECT id FROM documenti_tipi WHERE codice='modello_passaporto'        AND studio_id IS NULL);
SET @ts   := (SELECT id FROM documenti_tipi WHERE codice='modello_tessera_sanitaria' AND studio_id IS NULL);
SET @vis  := (SELECT id FROM documenti_tipi WHERE codice='modello_visura'            AND studio_id IS NULL);

INSERT IGNORE INTO documenti_tipi_campi (tipo_id, etichetta, tipo_campo, ruolo, obbligatorio, ordine) VALUES
    (@cie,'Numero documento',  'testo','numero_documento',1,1),
    (@cie,'Comune di rilascio','testo','ente_rilascio',   1,2),
    (@cie,'Data di rilascio',  'data', 'data_rilascio',   1,3),
    (@cie,'Data di scadenza',  'data', 'data_scadenza',   1,4),
    (@pass,'Numero passaporto',   'testo','numero_documento',1,1),
    (@pass,'Autorità di rilascio','testo','ente_rilascio',   1,2),
    (@pass,'Data di rilascio',    'data', 'data_rilascio',   1,3),
    (@pass,'Data di scadenza',    'data', 'data_scadenza',   1,4),
    (@ts,'Codice fiscale',        'testo','generico',        1,1),
    (@ts,'Numero identificativo', 'testo','numero_documento',0,2),
    (@ts,'Data di scadenza',      'data', 'data_scadenza',   1,3),
    (@vis,'Numero REA',         'testo','numero_documento',1,1),
    (@vis,'Camera di Commercio','testo','ente_rilascio',   1,2),
    (@vis,'Data della visura',  'data', 'data_rilascio',   1,3);


-- ── 2. Documenti veri e propri ────────────────────────────────
CREATE TABLE IF NOT EXISTS documenti (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    studio_id         INT          NOT NULL,
    tipo_id           INT          NOT NULL,
    nome_originale    VARCHAR(255) NOT NULL,
    -- Nome interno: uuid + estensione. Mai esposto ai client.
    nome_file         VARCHAR(255) NOT NULL,
    -- Path RELATIVO a STORAGE_LOCAL_PATH (es. "main/aziende/12/generale/abc.pdf")
    path              VARCHAR(500) NOT NULL,
    mime              VARCHAR(100) NOT NULL,
    size              INT          NOT NULL,
    visibilita        ENUM('tutti','azienda','reparto','utente') NOT NULL,
    azienda_id        INT          DEFAULT NULL,
    reparto_id        INT          DEFAULT NULL,
    user_id           INT          DEFAULT NULL,
    password_hash     VARCHAR(255) DEFAULT NULL,
    conferma_lettura  ENUM('nessuna','implicita','esplicita') NOT NULL DEFAULT 'nessuna',
    -- Versioning: 1 = prima versione (versione_padre_id=NULL).
    -- Le versioni successive linkano alla v.1 (catena flat).
    versione          INT          NOT NULL DEFAULT 1,
    versione_padre_id INT          NULL DEFAULT NULL,
    richiede_firma    TINYINT(1)   NOT NULL DEFAULT 0,
    note              TEXT         DEFAULT NULL,
    -- Scadenza/anagrafica: scade_il alimenta gli alert; data_rilascio e
    -- dati (JSON dei campi del modello) sono valorizzati dalla Fase 6C.
    scade_il          DATE         NULL DEFAULT NULL,
    data_rilascio     DATE         NULL DEFAULT NULL,
    dati              JSON         NULL DEFAULT NULL,
    created_by        INT          NOT NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at        TIMESTAMP    NULL DEFAULT NULL,
    INDEX idx_doc_visibilita     (visibilita, deleted_at),
    INDEX idx_doc_azienda        (azienda_id, deleted_at),
    INDEX idx_doc_reparto        (reparto_id, deleted_at),
    INDEX idx_doc_utente         (user_id, deleted_at),
    INDEX idx_doc_tipo           (tipo_id),
    INDEX idx_doc_created        (created_at),
    INDEX idx_doc_versione_padre (versione_padre_id, deleted_at),
    CONSTRAINT fk_doc_tipo           FOREIGN KEY (tipo_id)           REFERENCES documenti_tipi(id) ON DELETE RESTRICT,
    CONSTRAINT fk_doc_azienda        FOREIGN KEY (azienda_id)        REFERENCES aziende(id)         ON DELETE SET NULL,
    CONSTRAINT fk_doc_reparto        FOREIGN KEY (reparto_id)        REFERENCES reparti_azienda(id) ON DELETE SET NULL,
    CONSTRAINT fk_doc_user           FOREIGN KEY (user_id)           REFERENCES users(id)           ON DELETE SET NULL,
    CONSTRAINT fk_doc_creator        FOREIGN KEY (created_by)        REFERENCES users(id)           ON DELETE RESTRICT,
    CONSTRAINT fk_doc_versione_padre FOREIGN KEY (versione_padre_id) REFERENCES documenti(id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── 3. Letture e conferme ─────────────────────────────────────
-- Una sola riga per (documento, utente). La PRIMA apertura crea la riga
-- con tipo_conferma='implicita'. Se l'utente clicca "Confermo lettura"
-- la riga viene aggiornata a 'esplicita'.
CREATE TABLE IF NOT EXISTS documenti_letture (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    documento_id    INT          NOT NULL,
    user_id         INT          NOT NULL,
    tipo_conferma   ENUM('implicita','esplicita') NOT NULL,
    letto_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip              VARCHAR(45)  DEFAULT NULL,
    user_agent      TEXT         DEFAULT NULL,
    nota_utente     TEXT         DEFAULT NULL,
    UNIQUE KEY uq_lettura (documento_id, user_id),
    INDEX idx_lettura_user (user_id, letto_at),
    CONSTRAINT fk_lettura_doc  FOREIGN KEY (documento_id) REFERENCES documenti(id) ON DELETE CASCADE,
    CONSTRAINT fk_lettura_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. Firme elettroniche via OTP email ──────────────────────
-- Una riga per (documento, utente). Il codice OTP è generato
-- al click "Firma" e inviato via email; la riga viene firmata
-- quando l'utente lo conferma. Tentativi limitati a 5 per riga.
CREATE TABLE IF NOT EXISTS documenti_firme (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    documento_id       INT          NOT NULL,
    user_id            INT          NOT NULL,
    codice_otp_hash    VARCHAR(255) NULL,
    codice_inviato_at  TIMESTAMP    NULL DEFAULT NULL,
    tentativi          INT          NOT NULL DEFAULT 0,
    firmato_at         TIMESTAMP    NULL DEFAULT NULL,
    ip                 VARCHAR(45)  NULL,
    user_agent         VARCHAR(255) NULL,
    nota_utente        TEXT         NULL,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_doc_user (documento_id, user_id),
    INDEX idx_doc (documento_id),
    INDEX idx_user_firmato (user_id, firmato_at),
    CONSTRAINT fk_firma_doc  FOREIGN KEY (documento_id) REFERENCES documenti(id) ON DELETE CASCADE,
    CONSTRAINT fk_firma_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. Stato per-utente del documento (archivio / cestino lato cliente) ──
-- Ogni cliente può "archiviare" o "eliminare definitivamente" un documento
-- dalla propria vista. Lo studio continua a vedere tutto (record `documenti`
-- intatto). Solo cosa vede il cliente cambia.
CREATE TABLE IF NOT EXISTS documenti_user_state (
    documento_id  INT NOT NULL,
    user_id       INT NOT NULL,
    stato         ENUM('archiviato','eliminato') NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (documento_id, user_id),
    INDEX idx_dus_user_stato (user_id, stato),
    CONSTRAINT fk_dus_doc  FOREIGN KEY (documento_id) REFERENCES documenti(id) ON DELETE CASCADE,
    CONSTRAINT fk_dus_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Migration 06 — Disponibilità operatori
--
-- 2 nuove tabelle per gestire:
--   1. Orari lavorativi standard (settimanali ricorrenti, multi-fascia)
--   2. Assenze (giornaliere, con date_inizio/date_fine + tipologia)
--
-- L'esistente colonna `users.disponibile` (TINYINT) resta come override
-- manuale "in pausa adesso" — utile per chiusure brevi non pianificate.
--
-- Logica di "isDisponibile($userId, $now)" applicata da UserDisponibilitaService:
--   - se users.disponibile = 0          → false (override manuale)
--   - se ho un'assenza che copre $now   → false
--   - se ho orari standard configurati e $now non rientra in nessuno → false
--   - altrimenti                         → true
-- ============================================================


-- ── 1. Orari lavorativi standard (settimanali) ────────────────
-- Una riga per ogni "fascia" (es. lun 9-13 e lun 14-18 = 2 righe)
CREATE TABLE IF NOT EXISTS user_orari_lavorativi (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT          NOT NULL,
    -- 0 = lunedì, 1 = martedì, ..., 6 = domenica (compat ISO)
    giorno          TINYINT      NOT NULL,
    -- Orari salvati come HH:MM (TIME), confronti con CURTIME()
    ora_inizio      TIME         NOT NULL,
    ora_fine        TIME         NOT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_orari_user (user_id, giorno),
    CONSTRAINT fk_orari_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_orari_giorno  CHECK (giorno BETWEEN 0 AND 6),
    CONSTRAINT chk_orari_orario  CHECK (ora_fine > ora_inizio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Assenze (ferie / malattia / permesso) ──────────────────
CREATE TABLE IF NOT EXISTS user_assenze (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT          NOT NULL,
    data_inizio     DATE         NOT NULL,
    data_fine       DATE         NOT NULL,
    tipo            ENUM('ferie','malattia','permesso','altro') NOT NULL DEFAULT 'ferie',
    motivo          VARCHAR(255) DEFAULT NULL,
    -- Chi ha inserito l'assenza (l'utente stesso o un responsabile/admin)
    inserita_da     INT          NOT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Flag per alert "assenza già notificata al responsabile":
    -- evita duplicati nei cron giornalieri
    alert_sent_at   TIMESTAMP    NULL DEFAULT NULL,
    INDEX idx_assenza_user   (user_id, data_inizio, data_fine),
    INDEX idx_assenza_range  (data_inizio, data_fine),
    CONSTRAINT fk_assenza_user      FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_assenza_inserita  FOREIGN KEY (inserita_da) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT chk_assenza_range    CHECK (data_fine >= data_inizio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
    -- TL;DR generato dall'AI lazy-on-demand (cliente clicca "fammi un riassunto")
    summary_html        TEXT         NULL,
    summary_generated_at DATETIME    NULL,
    -- Broadcast Telegram aggiuntivo (per circolari urgenti / alta priorità)
    telegram_broadcast  TINYINT(1)   NOT NULL DEFAULT 0,
    -- A/B test linea oggetto email (proposta #8 roadmap)
    subject_variant_a   VARCHAR(255) NULL,
    subject_variant_b   VARCHAR(255) NULL,
    -- Quiz comprensione (#2 roadmap): 3 domande con 1 risposta corretta
    -- Generato dall'AI alla pubblicazione, salvato in JSON.
    -- Schema: {"questions":[{"q":"...","a":["opt1","opt2","opt3"],"correct":0}, ...]}
    conferma_quiz       TINYINT(1)   NOT NULL DEFAULT 0,
    quiz_json           JSON         NULL,
    -- Allegato singolo opzionale: FK debole su `documenti.id` (Storage gestisce il file)
    allegato_doc_id     INT          DEFAULT NULL,
    -- PDF ufficiale: per modalità 'upload' è il file caricato; per
    -- 'editor' / 'ai_*' è generato server-side da dompdf. Hash sha256
    -- archiviato per integrità nel tempo.
    pdf_doc_id          INT          DEFAULT NULL,
    pdf_hash            CHAR(64)     DEFAULT NULL,
    -- Importanza (per UI, non per ACL)
    priorita            ENUM('normale','alta','urgente') NOT NULL DEFAULT 'normale',
    -- Conferma di lettura richiesta?
    richiede_conferma   TINYINT(1)   NOT NULL DEFAULT 0,
    -- Stato operativo: bozza/scheduled/pubblicata/archiviata
    stato               ENUM('bozza','scheduled','pubblicata','archiviata') NOT NULL DEFAULT 'pubblicata',
    -- Modalità di creazione (per audit + UI)
    modalita            ENUM('upload','editor','ai_polish','ai_genera') NOT NULL DEFAULT 'editor',
    -- Pubblicazione e scadenza
    pubblicata_il       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    publish_at          DATETIME     NULL DEFAULT NULL,    -- programmazione futura
    scade_il            DATE         DEFAULT NULL,
    -- Versioning (catena flat come `documenti`)
    versione            INT          NOT NULL DEFAULT 1,
    versione_padre_id   INT          NULL DEFAULT NULL,
    -- Override regole solleciti per questa specifica circolare; NULL = usa globali
    solleciti_override     JSON         NULL DEFAULT NULL,
    sollecito_disabilitato TINYINT(1)   NOT NULL DEFAULT 0,
    created_by          INT          NOT NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          TIMESTAMP    NULL DEFAULT NULL,
    INDEX idx_circ_studio          (studio_id, deleted_at),
    INDEX idx_circ_pubblic         (pubblicata_il, deleted_at),
    INDEX idx_circ_categoria       (categoria),
    INDEX idx_circ_stato_publish   (stato, publish_at),
    INDEX idx_circ_pdf_hash        (pdf_hash),
    INDEX idx_circ_versione_padre  (versione_padre_id),
    CONSTRAINT fk_circ_creator FOREIGN KEY (created_by)        REFERENCES users(id)     ON DELETE RESTRICT,
    CONSTRAINT fk_circ_alleg   FOREIGN KEY (allegato_doc_id)   REFERENCES documenti(id) ON DELETE SET NULL,
    CONSTRAINT fk_circ_pdf     FOREIGN KEY (pdf_doc_id)        REFERENCES documenti(id) ON DELETE SET NULL,
    CONSTRAINT fk_circ_padre   FOREIGN KEY (versione_padre_id) REFERENCES circolari(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Routing destinatari ────────────────────────────────────
-- Una riga per ogni "target": azienda intera, singolo utente, o "tutti"
-- (broadcast a tutto il tenant). La normalizzazione consente in futuro
-- selettori più ricchi (es. aziende per categoria).
CREATE TABLE IF NOT EXISTS circolari_destinatari (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    circolare_id    INT NOT NULL,
    -- target_tipo:
    --   'tutti'    → broadcast a tutti i clienti del tenant
    --   'azienda'  → tutti gli utenti di un'azienda
    --   'reparto'  → solo i dipendenti di un sotto-gruppo (reparti_azienda)
    --   'utente'   → singolo utente (può essere senza azienda)
    target_tipo     ENUM('tutti','azienda','reparto','utente') NOT NULL,
    azienda_id      INT          DEFAULT NULL,
    reparto_id      INT          DEFAULT NULL,
    user_id         INT          DEFAULT NULL,
    INDEX idx_dest_circ    (circolare_id),
    INDEX idx_dest_azienda (azienda_id),
    INDEX idx_dest_reparto (reparto_id),
    INDEX idx_dest_user    (user_id),
    CONSTRAINT fk_dest_circ    FOREIGN KEY (circolare_id) REFERENCES circolari(id)        ON DELETE CASCADE,
    CONSTRAINT fk_dest_azienda FOREIGN KEY (azienda_id)   REFERENCES aziende(id)          ON DELETE CASCADE,
    CONSTRAINT fk_dest_reparto FOREIGN KEY (reparto_id)   REFERENCES reparti_azienda(id)  ON DELETE CASCADE,
    CONSTRAINT fk_dest_user    FOREIGN KEY (user_id)      REFERENCES users(id)            ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. Letture / conferme per utente ──────────────────────────
-- user_id NULLABLE per supportare anonimizzazione GDPR (right-to-be-forgotten):
-- la riga viene preservata per audit, user_id viene NULLATO + tombstone_at impostato.
CREATE TABLE IF NOT EXISTS circolari_letture (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    circolare_id    INT NOT NULL,
    user_id         INT NULL,
    letta_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confermata_at   TIMESTAMP    NULL DEFAULT NULL,
    tipo_lettura    ENUM('implicita','esplicita') NOT NULL DEFAULT 'implicita',
    email_variant   CHAR(1) NULL,                  -- A/B test (#8): variante oggetto email assegnata
    quiz_score      INT     NULL,                  -- Quiz (#2): risposte corrette (es. 2/3)
    ip              VARCHAR(45)  DEFAULT NULL,
    user_agent      VARCHAR(255) DEFAULT NULL,
    tombstone_at    DATETIME     NULL DEFAULT NULL,
    UNIQUE KEY uq_letturacirc (circolare_id, user_id),
    INDEX idx_lettcirc_user (user_id, letta_at),
    INDEX idx_letture_tombstone (tombstone_at),
    CONSTRAINT fk_lettcirc_circ FOREIGN KEY (circolare_id) REFERENCES circolari(id) ON DELETE CASCADE,
    CONSTRAINT fk_lettcirc_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. Fonti URL (per modalità AI "scrivi per me") ────────────
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
    CONSTRAINT fk_fonti_circ FOREIGN KEY (circolare_id) REFERENCES circolari(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. Solleciti inviati ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS circolari_solleciti_inviati (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    circolare_id INT NOT NULL,
    user_id      INT NOT NULL,
    inviato_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tipo         ENUM('automatico','manuale') NOT NULL DEFAULT 'automatico',
    inviato_da   INT NULL,
    INDEX idx_sol_circ_user (circolare_id, user_id),
    INDEX idx_sol_inviato (inviato_at),
    CONSTRAINT fk_sol_circ FOREIGN KEY (circolare_id) REFERENCES circolari(id) ON DELETE CASCADE,
    CONSTRAINT fk_sol_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE,
    CONSTRAINT fk_sol_op   FOREIGN KEY (inviato_da)   REFERENCES users(id)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 6. Audit immutabile (append-only via trigger) ────────────
CREATE TABLE IF NOT EXISTS circolari_audit (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    circolare_id INT NULL,
    user_id      INT NULL,
    ip           VARCHAR(45) NULL,
    user_agent   VARCHAR(255) NULL,
    azione       VARCHAR(60) NOT NULL,
    dettagli     JSON NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_caud_circ (circolare_id, created_at),
    INDEX idx_caud_az   (azione, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Trigger immutabilità — vedi migrations/13_circolari_v2.sql per il DELIMITER block.
-- Da applicare sempre con: source migrations/13_circolari_v2.sql

-- ============================================================
-- Migration 08 — Reazioni emoji sui messaggi delle comunicazioni
--
-- Pattern stile WhatsApp/Slack: ogni utente può aggiungere una o più
-- reazioni a un messaggio (max 1 per coppia messaggio/user/emoji →
-- la stessa emoji non si può "spammare").
--
-- Toggle: re-postare la stessa emoji la rimuove (gestito lato endpoint).
-- ============================================================


CREATE TABLE IF NOT EXISTS com_reazioni (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    messaggio_id  INT NOT NULL,
    user_id       INT NOT NULL,
    emoji         VARCHAR(16) NOT NULL,        -- l'emoji come stringa UTF-8 (es. "👍")
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_reaz (messaggio_id, user_id, emoji),
    INDEX idx_reaz_msg (messaggio_id),
    CONSTRAINT fk_reaz_msg  FOREIGN KEY (messaggio_id) REFERENCES com_messaggi(id) ON DELETE CASCADE,
    CONSTRAINT fk_reaz_user FOREIGN KEY (user_id)      REFERENCES users(id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- A/B test invii email per circolari (proposta #8 roadmap)
-- ============================================================
CREATE TABLE IF NOT EXISTS circolari_email_invii (
    id           INT NOT NULL AUTO_INCREMENT,
    circolare_id INT NOT NULL,
    user_id      INT NOT NULL,
    variant      CHAR(1) NOT NULL,
    sent_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_circ_user (circolare_id, user_id),
    CONSTRAINT fk_cei_circ FOREIGN KEY (circolare_id) REFERENCES circolari(id) ON DELETE CASCADE,
    CONSTRAINT fk_cei_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Web Push subscriptions (proposta #4 roadmap)
-- ============================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INT NOT NULL AUTO_INCREMENT,
    user_id     INT NOT NULL,
    endpoint    VARCHAR(500) NOT NULL,
    p256dh      VARCHAR(255) NOT NULL,
    auth        VARCHAR(80)  NOT NULL,
    user_agent  VARCHAR(255) NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_endpoint (endpoint(255)),
    KEY idx_user_id (user_id),
    CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- AI audit log: metadati delle chiamate a provider AI esterni (no payload)
-- Per privacy GDPR, traccia solo dimensioni + esito + utente.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_audit (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NULL,
    endpoint      VARCHAR(80) NOT NULL,
    feature       VARCHAR(80) NULL,
    char_inviati  INT NOT NULL DEFAULT 0,
    char_ricevuti INT NOT NULL DEFAULT 0,
    latenza_ms    INT NULL,
    ok            TINYINT(1) NOT NULL DEFAULT 1,
    error_msg     VARCHAR(255) NULL,
    ip            VARCHAR(45) NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_endpoint (endpoint),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- WebAuthn / Passkey credentials
-- 2° fattore alternativo al TOTP. Ogni utente può avere N passkey.
-- ============================================================
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id              INT NOT NULL AUTO_INCREMENT,
    user_id         INT NOT NULL,
    credential_id   VARCHAR(512) NOT NULL,
    public_key      MEDIUMTEXT  NOT NULL,
    transports      VARCHAR(255) NULL,
    aaguid          CHAR(36)     NULL,
    sign_count      INT UNSIGNED NOT NULL DEFAULT 0,
    label           VARCHAR(80)  NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at    DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_credential_id (credential_id),
    KEY idx_user_id (user_id),
    CONSTRAINT fk_webauthn_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Modulo Questionari (vedi migrations/44_questionari.sql)
-- ============================================================
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

-- Sezioni del questionario (vedi migrations/46_questionari_sezioni.sql)
CREATE TABLE IF NOT EXISTS questionari_sezioni (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    questionario_id   INT NOT NULL,
    titolo            VARCHAR(255) NOT NULL,
    descrizione       VARCHAR(500) NULL,
    ripetibile        TINYINT(1)   NOT NULL DEFAULT 0,
    consenti_zero     TINYINT(1)   NOT NULL DEFAULT 0,
    etichetta_istanza VARCHAR(60)  NOT NULL DEFAULT 'Voce',
    min_istanze       INT          NOT NULL DEFAULT 0,
    max_istanze       INT          NULL,
    ordine            INT          NOT NULL DEFAULT 0,
    INDEX idx_qs_quest (questionario_id, ordine),
    CONSTRAINT fk_qs_quest FOREIGN KEY (questionario_id) REFERENCES questionari(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS questionari_domande (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    questionario_id INT NOT NULL,
    sezione_id        INT NULL DEFAULT NULL,
    ordine            INT NOT NULL DEFAULT 0,
    tipo              ENUM('testo_breve','testo_lungo','scelta_singola','scelta_multipla','numero','data','documento') NOT NULL,
    testo             VARCHAR(500) NOT NULL,
    descrizione       VARCHAR(500) NULL,
    opzioni           JSON NULL,
    documento_tipo_id INT NULL DEFAULT NULL,
    obbligatoria      TINYINT(1) NOT NULL DEFAULT 1,
    INDEX idx_qd_quest (questionario_id, ordine),
    CONSTRAINT fk_qd_quest   FOREIGN KEY (questionario_id)   REFERENCES questionari(id)         ON DELETE CASCADE,
    CONSTRAINT fk_qd_sezione FOREIGN KEY (sezione_id)        REFERENCES questionari_sezioni(id) ON DELETE CASCADE,
    CONSTRAINT fk_qd_doctipo FOREIGN KEY (documento_tipo_id) REFERENCES documenti_tipi(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

CREATE TABLE IF NOT EXISTS questionari_risposte (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    questionario_id INT NOT NULL,
    user_id         INT NOT NULL,
    stato           ENUM('da_compilare','in_corso','completato') NOT NULL DEFAULT 'da_compilare',
    iniziato_at     DATETIME NULL,
    completato_at   DATETIME NULL,
    sollecitato_at  DATETIME NULL DEFAULT NULL,
    ip              VARCHAR(45) NULL,
    UNIQUE KEY uq_q_risp (questionario_id, user_id),
    INDEX idx_qr_user (user_id),
    CONSTRAINT fk_qr_quest FOREIGN KEY (questionario_id) REFERENCES questionari(id) ON DELETE CASCADE,
    CONSTRAINT fk_qr_user  FOREIGN KEY (user_id)         REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS questionari_risposte_dettaglio (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    risposta_id  INT NOT NULL,
    domanda_id   INT NOT NULL,
    istanza      INT NOT NULL DEFAULT 1,
    valore       TEXT NULL,
    valore_multi JSON NULL,
    documento_id INT NULL DEFAULT NULL,
    UNIQUE KEY uq_qrd (risposta_id, domanda_id, istanza),
    CONSTRAINT fk_qrd_risp FOREIGN KEY (risposta_id)  REFERENCES questionari_risposte(id) ON DELETE CASCADE,
    CONSTRAINT fk_qrd_dom  FOREIGN KEY (domanda_id)   REFERENCES questionari_domande(id)  ON DELETE CASCADE,
    CONSTRAINT fk_qrd_documento FOREIGN KEY (documento_id) REFERENCES documenti(id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Stato di compilazione per (risposta, sezione) — vedi migration 46.
CREATE TABLE IF NOT EXISTS questionari_risposte_sezioni (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    risposta_id        INT NOT NULL,
    sezione_id         INT NOT NULL,
    n_istanze          INT        NOT NULL DEFAULT 0,
    nessuna_variazione TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_qrs (risposta_id, sezione_id),
    CONSTRAINT fk_qrs_risp FOREIGN KEY (risposta_id) REFERENCES questionari_risposte(id) ON DELETE CASCADE,
    CONSTRAINT fk_qrs_sez  FOREIGN KEY (sezione_id)  REFERENCES questionari_sezioni(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ── PANNELLO AZIENDA (migration 52) ──────────────────────────
-- Tabelle a supporto del pannello "La mia azienda" lato cliente.
-- ============================================================

-- Audit delle modifiche fatte dall'admin azienda all'anagrafica.
CREATE TABLE IF NOT EXISTS aziende_modifiche_log (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id  INT NOT NULL,
    user_id     INT NOT NULL,
    campo       VARCHAR(60)  NOT NULL,
    valore_pre  TEXT NULL,
    valore_post TEXT NULL,
    ip          VARCHAR(45) NULL,
    user_agent  VARCHAR(255) NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_aml_azienda (azienda_id, created_at),
    INDEX idx_aml_user (user_id, created_at),
    CONSTRAINT fk_aml_azienda FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE,
    CONSTRAINT fk_aml_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Referenti aziendali (legale rappresentante, amministrativo, tecnico).
CREATE TABLE IF NOT EXISTS aziende_referenti (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    azienda_id  INT NOT NULL,
    user_id     INT NULL,
    nome        VARCHAR(150) NOT NULL,
    ruolo       ENUM('legale_rappresentante','amministrativo','tecnico','altro') NOT NULL DEFAULT 'altro',
    email       VARCHAR(255) NULL,
    telefono    VARCHAR(40)  NULL,
    note        VARCHAR(255) NULL,
    attivo      TINYINT(1) NOT NULL DEFAULT 1,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ar_azienda (azienda_id, attivo),
    INDEX idx_ar_ruolo (ruolo),
    CONSTRAINT fk_ar_azienda FOREIGN KEY (azienda_id) REFERENCES aziende(id) ON DELETE CASCADE,
    CONSTRAINT fk_ar_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ── SCADENZE: memo email anti-duplicato (migration 56) ──────
-- Triggata dal cron bin/cron-scadenze-memo.php (eventi
-- `scadenza_memo_7gg` e `scadenza_memo_1gg` in notifiche_default.php).
-- ============================================================

CREATE TABLE IF NOT EXISTS scadenze_memo_inviati (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    scadenza_id  INT NOT NULL,
    soglia_gg    TINYINT UNSIGNED NOT NULL,
    user_id      INT NULL,
    inviato_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_smi_dest (scadenza_id, soglia_gg, user_id),
    INDEX idx_smi_scadenza (scadenza_id, inviato_at),
    CONSTRAINT fk_smi_scadenza FOREIGN KEY (scadenza_id) REFERENCES scadenze(id) ON DELETE CASCADE,
    CONSTRAINT fk_smi_user     FOREIGN KEY (user_id)     REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ── WIZARD onboarding (migration 53_wizard.sql) ──────────────
-- Una sola tabella per W1 cliente, W2 azienda admin, W3 studio.
-- UNIQUE (wizard_id, user_id) → ogni utente ha la sua state per ogni
-- wizard. state_json contiene i marker __steps_done/__steps_skipped.
-- ============================================================

CREATE TABLE IF NOT EXISTS wizard_state (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    wizard_id     VARCHAR(20)  NOT NULL,
    user_id       INT          NULL,
    azienda_id    INT          NULL,
    studio_scope  TINYINT(1)   NOT NULL DEFAULT 0,
    step_corrente VARCHAR(40)  NOT NULL DEFAULT '',
    state_json    JSON         NOT NULL,
    done          TINYINT(1)   NOT NULL DEFAULT 0,
    skipped       TINYINT(1)   NOT NULL DEFAULT 0,
    snoozed_until DATETIME     NULL DEFAULT NULL,
    completed_at  DATETIME     NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wizard_user (wizard_id, user_id),
    INDEX idx_wizard_az    (wizard_id, azienda_id),
    INDEX idx_wizard_done  (user_id, wizard_id, done, skipped),
    INDEX idx_wiz_snooze   (user_id, snoozed_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PORTAFOGLI CLIENTI (visibilità ristretta operatori)
-- Spec: docs/prompt-portafogli-scoping.md.
-- Toggle OFF di default → zero impatto runtime fino a Fase 2.
-- ============================================================
CREATE TABLE IF NOT EXISTS portafogli (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    nome         VARCHAR(120) NOT NULL,
    tipo         ENUM('partner','area','eccezione','custom') NOT NULL DEFAULT 'partner',
    descrizione  VARCHAR(500) NULL,
    colore       VARCHAR(7)   NOT NULL DEFAULT '#6366f1',
    icona        VARCHAR(40)  NULL,
    attivo       TINYINT(1)   NOT NULL DEFAULT 1,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by   INT          NULL,
    UNIQUE KEY uk_port_nome (nome),
    INDEX idx_port_tipo (tipo),
    INDEX idx_port_attivo (attivo),
    CONSTRAINT fk_port_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portafoglio_aziende (
    portafoglio_id INT NOT NULL,
    azienda_id     INT NOT NULL,
    added_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    added_by       INT      NULL,
    PRIMARY KEY (portafoglio_id, azienda_id),
    INDEX idx_pa_az (azienda_id),
    CONSTRAINT fk_pa_port FOREIGN KEY (portafoglio_id)
        REFERENCES portafogli(id) ON DELETE CASCADE,
    CONSTRAINT fk_pa_az FOREIGN KEY (azienda_id)
        REFERENCES aziende(id) ON DELETE CASCADE,
    CONSTRAINT fk_pa_added_by FOREIGN KEY (added_by)
        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portafoglio_operatori (
    portafoglio_id INT NOT NULL,
    user_id        INT NOT NULL,
    added_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    added_by       INT      NULL,
    PRIMARY KEY (portafoglio_id, user_id),
    INDEX idx_po_user (user_id),
    CONSTRAINT fk_po_port FOREIGN KEY (portafoglio_id)
        REFERENCES portafogli(id) ON DELETE CASCADE,
    CONSTRAINT fk_po_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_po_added_by FOREIGN KEY (added_by)
        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO impostazioni (chiave, valore, tipo, gruppo) VALUES
    ('portafogli_scoping_attivo', '0', 'booleano', 'workflow');

INSERT IGNORE INTO permessi (codice, etichetta, area, ordine) VALUES
    ('portafogli.gestire', 'Gestione portafogli', 'Team', 32);

INSERT IGNORE INTO ruoli_permessi (ruolo_id, permesso_id)
SELECT r.id, p.id FROM ruoli r JOIN permessi p
WHERE r.nome = 'direzione' AND p.codice = 'portafogli.gestire';


-- ============================================================
-- Preventivi commerciali + Catalogo servizi (Fase 1 modulo Preventivi).
-- Replica le 4 tabelle + permessi + impostazioni di migrations/62_preventivi.sql
-- per i NUOVI tenant. Spec: docs/prompt-preventivi-rapporti.md
-- ============================================================

CREATE TABLE IF NOT EXISTS servizi_categorie (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    nome        VARCHAR(80)  NOT NULL,
    descrizione VARCHAR(255) NULL,
    colore      VARCHAR(7)   NOT NULL DEFAULT '#6366f1',
    icona       VARCHAR(40)  NULL,
    ordine      INT          NOT NULL DEFAULT 0,
    attivo      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_servcat_nome (nome),
    INDEX idx_servcat_attivo (attivo, ordine)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS servizi_catalogo (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    codice          VARCHAR(32)  NOT NULL,
    nome            VARCHAR(180) NOT NULL,
    descrizione     TEXT         NULL,
    categoria_id    INT          NULL,
    unita_misura    ENUM('forfait','ora','mese','anno','documento','dipendente','pezzo')
                    NOT NULL DEFAULT 'forfait',
    prezzo_base     DECIMAL(10,2) NOT NULL DEFAULT 0,
    iva_aliquota    DECIMAL(5,2)  NOT NULL DEFAULT 22.00,
    tipo_ricorrenza ENUM('una_tantum','mensile','annuale') NOT NULL DEFAULT 'una_tantum',
    ai_keywords     VARCHAR(500) NULL,
    ai_target       JSON         NULL,
    attivo          TINYINT(1)   NOT NULL DEFAULT 1,
    ordine          INT          NOT NULL DEFAULT 0,
    platform_servizio TINYINT(1) NOT NULL DEFAULT 0,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      INT          NULL,
    UNIQUE KEY uk_serv_codice (codice),
    INDEX idx_serv_attivo (attivo, ordine),
    INDEX idx_serv_cat (categoria_id),
    CONSTRAINT fk_serv_cat FOREIGN KEY (categoria_id)
        REFERENCES servizi_categorie(id) ON DELETE SET NULL,
    CONSTRAINT fk_serv_cb FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS preventivi (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    codice            VARCHAR(32)  NOT NULL,
    azienda_id        INT          NOT NULL,
    oggetto           VARCHAR(200) NOT NULL,
    cover_letter      TEXT         NULL,
    note_interne      TEXT         NULL,
    stato             ENUM('bozza','inviato','accettato','rifiutato','scaduto','revisione_richiesta')
                      NOT NULL DEFAULT 'bozza',
    valido_fino       DATE         NULL,
    versione          INT          NOT NULL DEFAULT 1,
    versione_padre_id INT          NULL,
    totale_imponibile DECIMAL(12,2) NOT NULL DEFAULT 0,
    totale_iva        DECIMAL(12,2) NOT NULL DEFAULT 0,
    totale            DECIMAL(12,2) NOT NULL DEFAULT 0,
    inviato_at        DATETIME     NULL,
    inviato_by        INT          NULL,
    accettato_at      DATETIME     NULL,
    accettato_by      INT          NULL,
    accettato_ip      VARCHAR(45)  NULL,
    accettato_ua      VARCHAR(255) NULL,
    rifiutato_at      DATETIME     NULL,
    rifiutato_by      INT          NULL,
    motivo_rifiuto    TEXT         NULL,
    fatturato_at      DATETIME     NULL,
    fattura_id        VARCHAR(64)  NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by        INT          NULL,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_prev_codice (codice),
    INDEX idx_prev_az_stato (azienda_id, stato),
    INDEX idx_prev_stato (stato),
    INDEX idx_prev_valido (valido_fino),
    INDEX idx_prev_padre (versione_padre_id),
    CONSTRAINT fk_prev_az FOREIGN KEY (azienda_id)
        REFERENCES aziende(id) ON DELETE CASCADE,
    CONSTRAINT fk_prev_padre FOREIGN KEY (versione_padre_id)
        REFERENCES preventivi(id) ON DELETE SET NULL,
    CONSTRAINT fk_prev_cb FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_prev_inv_by FOREIGN KEY (inviato_by)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_prev_acc_by FOREIGN KEY (accettato_by)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_prev_rif_by FOREIGN KEY (rifiutato_by)
        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS preventivi_voci (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    preventivo_id   INT NOT NULL,
    servizio_id     INT NULL,
    -- Snapshot voce dinamica (NULL su voci ordinarie); vedi migration 66
    metrica_id      INT NULL,
    metric_key      VARCHAR(64) NULL,
    periodo_tipo    ENUM('mensile','trimestrale','semestrale','annuale','custom') NULL,
    periodo_da      DATE NULL,
    periodo_a       DATE NULL,
    snapshot_at     DATETIME NULL,
    nome            VARCHAR(180) NOT NULL,
    descrizione     TEXT NULL,
    unita_misura    ENUM('forfait','ora','mese','anno','documento','dipendente','pezzo')
                    NOT NULL DEFAULT 'forfait',
    quantita        DECIMAL(10,2) NOT NULL DEFAULT 1,
    prezzo_unitario DECIMAL(10,2) NOT NULL DEFAULT 0,
    sconto_pct      DECIMAL(5,2)  NOT NULL DEFAULT 0,
    iva_aliquota    DECIMAL(5,2)  NOT NULL DEFAULT 22.00,
    tipo_ricorrenza ENUM('una_tantum','mensile','annuale') NOT NULL DEFAULT 'una_tantum',
    totale_riga     DECIMAL(12,2) NOT NULL DEFAULT 0,
    ordine          INT NOT NULL DEFAULT 0,
    note            VARCHAR(255) NULL,
    INDEX idx_voce_prev (preventivo_id, ordine),
    INDEX idx_voce_serv (servizio_id),
    INDEX idx_voce_metrica (metrica_id),
    CONSTRAINT fk_voce_prev FOREIGN KEY (preventivo_id)
        REFERENCES preventivi(id) ON DELETE CASCADE,
    CONSTRAINT fk_voce_serv FOREIGN KEY (servizio_id)
        REFERENCES servizi_catalogo(id) ON DELETE SET NULL
    -- FK su metrica_id viene aggiunta dopo CREATE TABLE servizi_metriche più sotto
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO impostazioni (chiave, valore, tipo, gruppo, etichetta) VALUES
    ('preventivi_iva_default',    '22.00', 'numero',   'preventivi', 'Aliquota IVA di default'),
    ('preventivi_regime_fiscale', 'RF01',  'testo',    'preventivi', 'Regime fiscale (codice)'),
    ('preventivi_validita_gg',    '30',    'numero',   'preventivi', 'Validità default (giorni)'),
    ('preventivi_pdf_footer',     '',      'testo',    'preventivi', 'Footer PDF (condizioni legali)'),
    ('preventivi_ai_enabled',     '1',     'booleano', 'preventivi', 'AI assist su preventivi');

INSERT IGNORE INTO permessi (codice, etichetta, area, ordine) VALUES
    ('servizi.gestire',      'Catalogo servizi (CRUD)',      'Preventivi', 70),
    ('preventivi.gestire',   'Crea/modifica preventivi',     'Preventivi', 71),
    ('preventivi.read',      'Lettura preventivi (storico)', 'Preventivi', 72),
    ('rapporti.gestire',     'Gestione rapporti di lavoro',  'Preventivi', 73),
    ('prestazioni.tracciare','Registra prestazioni (time)',  'Preventivi', 74);

INSERT IGNORE INTO ruoli_permessi (ruolo_id, permesso_id)
SELECT r.id, p.id FROM ruoli r JOIN permessi p
WHERE
    (r.nome = 'direzione' AND p.codice IN (
        'servizi.gestire','preventivi.gestire','preventivi.read',
        'rapporti.gestire','prestazioni.tracciare'
    ))
    OR
    (r.nome = 'responsabile' AND p.codice IN (
        'preventivi.gestire','preventivi.read',
        'rapporti.gestire','prestazioni.tracciare'
    ))
    OR
    (r.nome = 'operatore' AND p.codice IN (
        'preventivi.read','prestazioni.tracciare'
    ));


-- ============================================================
-- Seed catalogo Preventivi (Fase 3): 6 categorie + 20 voci tipiche
-- di uno studio commercialista italiano. Sincrono con
-- migrations/64_seed_catalogo.sql (modifiche vanno in ENTRAMBI).
-- ============================================================
INSERT IGNORE INTO servizi_categorie (nome, descrizione, colore, icona, ordine) VALUES
    ('Contabilità',        'Tenuta contabile (ordinaria, semplificata, forfettario)', '#2563eb', 'bi-journal-bookmark-fill', 10),
    ('Dichiarativi',       'Modelli Redditi, 730, IVA, IRAP, IMU',                   '#7c3aed', 'bi-file-earmark-text-fill', 20),
    ('Adempimenti',        'CU, 770, Intrastat, Esterometro, Spesometro',            '#0e7490', 'bi-clipboard-data-fill', 30),
    ('Bilancio e Società', 'Bilancio, deposito CCIAA, costituzioni e modifiche',     '#b45309', 'bi-bank2', 40),
    ('Consulenza',         'Consulenze straordinarie, pareri, perizie',              '#15803d', 'bi-lightbulb-fill', 50),
    ('Lavoro e Paghe',     'Buste paga, CU dipendenti, F24, gestione personale',     '#dc2626', 'bi-people-fill', 60);

INSERT IGNORE INTO servizi_catalogo
    (codice, nome, descrizione, categoria_id, unita_misura, prezzo_base, iva_aliquota, tipo_ricorrenza, ai_keywords, ordine, attivo)
SELECT * FROM (
    SELECT 'CONT-ORD'    AS codice, 'Tenuta contabilità ordinaria'  AS nome, 'Registrazione documenti, libri obbligatori, riconciliazioni mensili.' AS descrizione, (SELECT id FROM servizi_categorie WHERE nome='Contabilità') AS categoria_id, 'mese' AS unita_misura, 350.00 AS prezzo_base, 22.00 AS iva, 'mensile' AS ric, 'contabilità,ordinaria,libri,registrazioni,iva' AS kw, 1 AS ordine, 1 AS attivo UNION ALL
    SELECT 'CONT-SEM',    'Tenuta contabilità semplificata', 'Adatta a ditte individuali e società di persone sotto soglia.', (SELECT id FROM servizi_categorie WHERE nome='Contabilità'), 'mese', 220.00, 22.00, 'mensile', 'contabilità,semplificata,ditta individuale', 2, 1 UNION ALL
    SELECT 'CONT-FOR',    'Gestione regime forfettario',     'Calcolo coefficienti, ritenute, contributi.',                  (SELECT id FROM servizi_categorie WHERE nome='Contabilità'), 'anno', 600.00, 22.00, 'annuale', 'forfettario,partita iva,flat tax', 3, 1 UNION ALL
    SELECT 'CONT-RIC',    'Liquidazione IVA periodica',      'Calcolo, ravvedimento, F24, comunicazione LIPE.',              (SELECT id FROM servizi_categorie WHERE nome='Contabilità'), 'mese', 60.00,  22.00, 'mensile', 'iva,lipe,liquidazione,trimestrale', 4, 1 UNION ALL
    SELECT 'DICH-730',    'Dichiarazione 730',               'Compilazione e invio Modello 730 con allegati.',               (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 80.00, 22.00, 'una_tantum', 'dichiarazione,730,redditi,dipendenti', 1, 1 UNION ALL
    SELECT 'DICH-RED',    'Dichiarazione Redditi PF',        'Compilazione e invio Modello Redditi Persone Fisiche.',        (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 250.00, 22.00, 'annuale', 'redditi,unico,persone fisiche', 2, 1 UNION ALL
    SELECT 'DICH-RED-SC', 'Dichiarazione Redditi SC',        'Modello Redditi Società di Capitali (SRL/SPA).',               (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 800.00, 22.00, 'annuale', 'redditi,sc,srl,società capitali', 3, 1 UNION ALL
    SELECT 'DICH-IVA',    'Dichiarazione IVA annuale',       'Quadri VE/VF, prospetti, invio telematico.',                   (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 180.00, 22.00, 'annuale', 'iva,annuale,quadri,ve,vf', 4, 1 UNION ALL
    SELECT 'DICH-IRAP',   'Dichiarazione IRAP',              'Modello IRAP con quadri specifici.',                            (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 220.00, 22.00, 'annuale', 'irap,regionale', 5, 1 UNION ALL
    SELECT 'DICH-IMU',    'Calcolo e versamento IMU',        'Determinazione imposta, F24, dichiarazione se dovuta.',        (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 60.00,  22.00, 'annuale', 'imu,immobile,acconto,saldo', 6, 1 UNION ALL
    SELECT 'ADEM-CU',     'Certificazione Unica (CU)',       'Trasmissione CU per lavoratori autonomi/dipendenti.',          (SELECT id FROM servizi_categorie WHERE nome='Adempimenti'), 'documento', 25.00,  22.00, 'annuale', 'certificazione unica,cu,sostituto', 1, 1 UNION ALL
    SELECT 'ADEM-770',    'Modello 770',                     'Sostituti d''imposta: riepilogo ritenute.',                    (SELECT id FROM servizi_categorie WHERE nome='Adempimenti'), 'documento', 250.00, 22.00, 'annuale', '770,sostituto,ritenute', 2, 1 UNION ALL
    SELECT 'ADEM-INT',    'Modello Intrastat',               'Cessioni/acquisti intracomunitari.',                            (SELECT id FROM servizi_categorie WHERE nome='Adempimenti'), 'mese', 90.00,  22.00, 'mensile', 'intrastat,intracomunitario', 3, 1 UNION ALL
    SELECT 'ADEM-ESTERO', 'Esterometro / Comunicazione esteri', 'Operazioni con soggetti esteri non residenti.',              (SELECT id FROM servizi_categorie WHERE nome='Adempimenti'), 'mese', 50.00,  22.00, 'mensile', 'esterometro,esteri,san marino', 4, 1 UNION ALL
    SELECT 'BIL-ANNUALE', 'Bilancio annuale',                'Predisposizione bilancio CEE, nota integrativa, verbali.',     (SELECT id FROM servizi_categorie WHERE nome='Bilancio e Società'), 'documento', 900.00, 22.00, 'annuale', 'bilancio,nota integrativa,cee', 1, 1 UNION ALL
    SELECT 'BIL-DEP',     'Deposito bilancio CCIAA',         'Deposito XBRL, diritti camerali, registro imprese.',           (SELECT id FROM servizi_categorie WHERE nome='Bilancio e Società'), 'documento', 250.00, 22.00, 'annuale', 'deposito,cciaa,xbrl,registro imprese', 2, 1 UNION ALL
    SELECT 'SOC-COST-SRL','Costituzione SRL',                'Atto, statuto, registrazione, iscrizioni preliminari.',        (SELECT id FROM servizi_categorie WHERE nome='Bilancio e Società'), 'forfait', 1500.00, 22.00, 'una_tantum', 'costituzione,srl,società,notaio', 3, 1 UNION ALL
    SELECT 'CONS-STRAORD','Consulenza straordinaria',        'Pareri specifici, analisi, supporto operazioni straordinarie.',(SELECT id FROM servizi_categorie WHERE nome='Consulenza'), 'ora', 90.00,  22.00, 'una_tantum', 'consulenza,parere,straordinaria', 1, 1 UNION ALL
    SELECT 'CONS-FISC',   'Pianificazione fiscale',          'Analisi e ottimizzazione carico fiscale annuale.',             (SELECT id FROM servizi_categorie WHERE nome='Consulenza'), 'forfait', 800.00, 22.00, 'annuale', 'pianificazione,fiscale,ottimizzazione', 2, 1 UNION ALL
    SELECT 'LAV-BUSTA',   'Elaborazione busta paga',         'Per dipendente / mese, comprensivo F24 e CU finale.',          (SELECT id FROM servizi_categorie WHERE nome='Lavoro e Paghe'), 'dipendente', 30.00, 22.00, 'mensile', 'busta paga,dipendente,cedolino', 1, 1
) AS d;


-- ============================================================
-- Rapporti di lavoro + prestazioni (Fase 5 modulo Preventivi).
-- Replica di migrations/65_rapporti_lavoro.sql per i NUOVI tenant.
-- ============================================================

CREATE TABLE IF NOT EXISTS rapporti_lavoro (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    codice          VARCHAR(32)  NOT NULL,
    preventivo_id   INT          NOT NULL,
    azienda_id      INT          NOT NULL,
    stato           ENUM('in_corso','sospeso','concluso','annullato')
                    NOT NULL DEFAULT 'in_corso',
    inizio          DATE         NULL,
    fine_prevista   DATE         NULL,
    fine_effettiva  DATE         NULL,
    note            TEXT         NULL,
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

CREATE TABLE IF NOT EXISTS rapporti_prestazioni (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    rapporto_id     INT NOT NULL,
    voce_id         INT NULL,
    data            DATE NOT NULL,
    user_id         INT NULL,
    ore             DECIMAL(5,2) NULL,
    descrizione     VARCHAR(500) NOT NULL,
    fatturabile     TINYINT(1) NOT NULL DEFAULT 1,
    importo         DECIMAL(10,2) NULL,
    fatturato_at    DATETIME NULL,
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


-- ============================================================
-- Voci dinamiche preventivi (catalogo metriche + colonne snapshot).
-- Replica di migrations/66_preventivi_voci_dinamiche.sql per i NUOVI tenant.
-- Spec: docs/prompt-preventivi-voci-dinamiche.md
-- ============================================================

CREATE TABLE IF NOT EXISTS servizi_metriche (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    codice          VARCHAR(64)  NOT NULL,
    nome            VARCHAR(180) NOT NULL,
    descrizione     TEXT         NULL,
    metric_key      VARCHAR(64)  NOT NULL,
    unita_misura_label VARCHAR(40) NOT NULL DEFAULT 'unità',
    periodo_default ENUM('mensile','trimestrale','semestrale','annuale','custom') NOT NULL DEFAULT 'annuale',
    prezzo_unitario_default DECIMAL(10,2) NOT NULL DEFAULT 0,
    iva_aliquota_default    DECIMAL(5,2)  NOT NULL DEFAULT 22.00,
    soglia_minima   INT          NOT NULL DEFAULT 0,
    attivo          TINYINT(1)   NOT NULL DEFAULT 1,
    ordine          INT          NOT NULL DEFAULT 0,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_metr_codice (codice),
    INDEX idx_metr_attivo (attivo, ordine)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FK preventivi_voci.metrica_id → servizi_metriche.id (pattern condizionale,
-- safe se la migration 66 ha già creato la FK su tenant esistenti).
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='preventivi_voci' AND CONSTRAINT_NAME='fk_voce_metrica');
SET @sql := IF(@fk=0,
    'ALTER TABLE preventivi_voci ADD CONSTRAINT fk_voce_metrica FOREIGN KEY (metrica_id) REFERENCES servizi_metriche(id) ON DELETE SET NULL',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Seed catalogo metriche
INSERT IGNORE INTO servizi_metriche
    (codice, nome, descrizione, metric_key, unita_misura_label, periodo_default,
     prezzo_unitario_default, iva_aliquota_default, soglia_minima, ordine, attivo)
VALUES
    ('METR-COM',    'Comunicazioni gestite',
        'Numero di comunicazioni/ticket aperti dal cliente nel periodo (incluse chiuse, escluse note interne).',
        'comunicazioni_gestite', 'comunicazioni', 'annuale', 0.00, 22.00, 1, 1, 1),
    ('METR-DOC',    'Documenti caricati',
        'Numero di documenti caricati dallo studio per il cliente nel periodo (esclusi soft-deleted).',
        'documenti_caricati', 'documenti', 'annuale', 0.00, 22.00, 1, 2, 1),
    ('METR-CIRC',   'Circolari ricevute',
        'Numero di circolari pubblicate raggiungenti il cliente nel periodo (deduplicate per catena versioni).',
        'circolari_inviate', 'circolari', 'annuale', 0.00, 22.00, 1, 3, 1),
    ('METR-QUEST',  'Questionari sottoposti',
        'Numero di questionari assegnati al cliente nel periodo.',
        'questionari_inviati', 'questionari', 'annuale', 0.00, 22.00, 1, 4, 1),
    ('METR-SCAD',   'Scadenze monitorate',
        'Numero di scadenze attive che riguardano il cliente nel periodo (qualsiasi visibilità che lo includa).',
        'scadenze_create', 'scadenze', 'annuale', 0.00, 22.00, 0, 5, 1);


-- ============================================================
-- Memo flottanti per operatori interni (migration 67_user_memo.sql).
-- Stile Apple Stickies: piccoli post-it persistenti per-utente,
-- visibili solo nel pannello admin tenant (ACL: RUOLI_INTERNI).
-- Il toggle attiva/disattiva vive in user_preferenze (chiave 'memo_attivi').
-- ============================================================
CREATE TABLE IF NOT EXISTS user_memo (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    testo       TEXT NULL,
    colore      ENUM('giallo','rosa','verde','blu','viola','arancio')
                NOT NULL DEFAULT 'giallo',
    dimensione  ENUM('s','m','l') NOT NULL DEFAULT 'm',
    posizione_x INT NOT NULL DEFAULT 100,
    posizione_y INT NOT NULL DEFAULT 100,
    z_order     INT NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_memo_user (user_id, z_order DESC),
    CONSTRAINT fk_memo_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- Tracking delle migration applicate (vedi bin/migrate-tenants.php).
-- crea-studio.php popola subito questa tabella con tutte le migration
-- esistenti (baseline), così il runner applica solo quelle future.
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    filename   VARCHAR(160) NOT NULL,
    sha256     CHAR(64)     NULL,
    applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes      VARCHAR(255) NULL,
    UNIQUE KEY ux_sm_filename (filename),
    KEY idx_sm_applied (applied_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
