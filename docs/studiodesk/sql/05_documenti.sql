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

USE portal_template;

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
    visibilita_default  ENUM('tutti','azienda','utente') NOT NULL DEFAULT 'tutti',
    ordine              INT          NOT NULL DEFAULT 0,
    attivo              TINYINT(1)   NOT NULL DEFAULT 1,
    -- Vincolo: codice unico per (studio_id, codice). NULL counts as distinct
    -- per le righe di piattaforma (gli admin non possono ridefinirle).
    UNIQUE KEY uq_tipo_codice (studio_id, codice),
    INDEX idx_tipo_attivo (attivo, ordine)
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
    visibilita        ENUM('tutti','azienda','utente') NOT NULL,
    azienda_id        INT          DEFAULT NULL,
    user_id           INT          DEFAULT NULL,
    password_hash     VARCHAR(255) DEFAULT NULL,
    conferma_lettura  ENUM('nessuna','implicita','esplicita') NOT NULL DEFAULT 'nessuna',
    note              TEXT         DEFAULT NULL,
    created_by        INT          NOT NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at        TIMESTAMP    NULL DEFAULT NULL,
    INDEX idx_doc_visibilita (visibilita, deleted_at),
    INDEX idx_doc_azienda    (azienda_id, deleted_at),
    INDEX idx_doc_utente     (user_id, deleted_at),
    INDEX idx_doc_tipo       (tipo_id),
    INDEX idx_doc_created    (created_at),
    CONSTRAINT fk_doc_tipo     FOREIGN KEY (tipo_id)    REFERENCES documenti_tipi(id) ON DELETE RESTRICT,
    CONSTRAINT fk_doc_azienda  FOREIGN KEY (azienda_id) REFERENCES aziende(id)        ON DELETE SET NULL,
    CONSTRAINT fk_doc_user     FOREIGN KEY (user_id)    REFERENCES users(id)          ON DELETE SET NULL,
    CONSTRAINT fk_doc_creator  FOREIGN KEY (created_by) REFERENCES users(id)          ON DELETE RESTRICT
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
