-- @target: tenant
-- ============================================================
-- FILE: migrations/62_preventivi.sql
-- Fase 1 di "Preventivi commerciali + Rapporti di lavoro".
-- Spec: docs/prompt-preventivi-rapporti.md
--
-- Decisioni vincolanti recepite:
--   D-FAT = A  (solo preventivi + PDF in v1; schema "B-ready" via
--               fatturato_at + fattura_id già presenti)
--   D-PER = A  (ENUM una_tantum / mensile / annuale)
--   D-AI3 = B  (5 endpoint AI in v1, ma NON in questa Fase 1)
--
-- Questa migration installa:
--   · servizi_categorie    -- catalogo organizzato per categoria (Fase 3 UI)
--   · servizi_catalogo     -- listino servizi (Fase 3 UI)
--   · preventivi           -- testata offerta commerciale (Fase 1 UI)
--   · preventivi_voci      -- righe dell'offerta
--   · permessi servizi.*, preventivi.*, rapporti.*, prestazioni.*
--   · impostazioni preventivi_*
--
-- Le tabelle rapporti_lavoro / rapporti_prestazioni arrivano in Fase 5
-- insieme alla UI dei rapporti. Sono già FK-target da preventivi (nessuna
-- direzione opposta), quindi nessuna dipendenza inversa qui.
--
-- Idempotente: riapplicabile su tenant esistenti senza errori.
-- ============================================================

-- ── CATALOGO: CATEGORIE ────────────────────────────────────
CREATE TABLE IF NOT EXISTS servizi_categorie (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    nome        VARCHAR(80)  NOT NULL,
    descrizione VARCHAR(255) NULL,
    colore      VARCHAR(7)   NOT NULL DEFAULT '#6366f1',
    icona       VARCHAR(40)  NULL,           -- bootstrap-icons key (es. 'bi-briefcase')
    ordine      INT          NOT NULL DEFAULT 0,
    attivo      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_servcat_nome (nome),
    INDEX idx_servcat_attivo (attivo, ordine)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── CATALOGO: VOCI ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS servizi_catalogo (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    codice          VARCHAR(32)  NOT NULL,    -- es. "CONT-ORD-2026"
    nome            VARCHAR(180) NOT NULL,
    descrizione     TEXT         NULL,
    categoria_id    INT          NULL,
    unita_misura    ENUM('forfait','ora','mese','anno','documento','dipendente','pezzo')
                    NOT NULL DEFAULT 'forfait',
    prezzo_base     DECIMAL(10,2) NOT NULL DEFAULT 0,
    iva_aliquota    DECIMAL(5,2)  NOT NULL DEFAULT 22.00,
    tipo_ricorrenza ENUM('una_tantum','mensile','annuale') NOT NULL DEFAULT 'una_tantum',
    -- Hint per AI suggerimento voci (Fase 4)
    ai_keywords     VARCHAR(500) NULL,        -- "iva,contabilità,fatturazione"
    ai_target       JSON         NULL,        -- {"forme_giuridiche":["srl","spa"],"min_dipendenti":1,...}
    attivo          TINYINT(1)   NOT NULL DEFAULT 1,
    ordine          INT          NOT NULL DEFAULT 0,
    -- Marcatore voci che rappresentano servizi/piani della piattaforma
    -- rivenduti dallo studio al cliente (gestiti dalla direzione).
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

-- ── PREVENTIVI: TESTATA ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS preventivi (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    codice            VARCHAR(32)  NOT NULL,  -- "PRV-2026-0001" per-tenant
    azienda_id        INT          NOT NULL,
    oggetto           VARCHAR(200) NOT NULL,
    cover_letter      TEXT         NULL,      -- testo intro al cliente (HTML safe)
    note_interne      TEXT         NULL,      -- visibile solo allo studio
    stato             ENUM('bozza','inviato','accettato','rifiutato','scaduto','revisione_richiesta')
                      NOT NULL DEFAULT 'bozza',
    valido_fino       DATE         NULL,
    versione          INT          NOT NULL DEFAULT 1,
    versione_padre_id INT          NULL,      -- root della catena revisioni (NULL su v.1)
    -- Totali ricalcolati a ogni salvataggio voci
    totale_imponibile DECIMAL(12,2) NOT NULL DEFAULT 0,
    totale_iva        DECIMAL(12,2) NOT NULL DEFAULT 0,
    totale            DECIMAL(12,2) NOT NULL DEFAULT 0,
    -- Workflow di invio / accettazione / rifiuto
    inviato_at        DATETIME     NULL,
    inviato_by        INT          NULL,
    accettato_at      DATETIME     NULL,
    accettato_by      INT          NULL,      -- user_id cliente_admin che ha cliccato accetta
    accettato_ip      VARCHAR(45)  NULL,
    accettato_ua      VARCHAR(255) NULL,
    rifiutato_at      DATETIME     NULL,
    rifiutato_by      INT          NULL,
    motivo_rifiuto    TEXT         NULL,
    -- Predisposti per integrazione fatturazione (D-FAT opzione B, Fase 7)
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

-- ── PREVENTIVI: VOCI (snapshot dal catalogo al momento dell'aggiunta) ──
CREATE TABLE IF NOT EXISTS preventivi_voci (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    preventivo_id   INT NOT NULL,
    servizio_id     INT NULL,                 -- NULL = voce custom non da catalogo
    nome            VARCHAR(180) NOT NULL,    -- snapshot del nome (override del catalogo)
    descrizione     TEXT NULL,
    unita_misura    ENUM('forfait','ora','mese','anno','documento','dipendente','pezzo')
                    NOT NULL DEFAULT 'forfait',
    quantita        DECIMAL(10,2) NOT NULL DEFAULT 1,
    prezzo_unitario DECIMAL(10,2) NOT NULL DEFAULT 0,  -- snapshot prezzo
    sconto_pct      DECIMAL(5,2)  NOT NULL DEFAULT 0,
    iva_aliquota    DECIMAL(5,2)  NOT NULL DEFAULT 22.00,
    tipo_ricorrenza ENUM('una_tantum','mensile','annuale') NOT NULL DEFAULT 'una_tantum',
    totale_riga     DECIMAL(12,2) NOT NULL DEFAULT 0,   -- qta * prezzo * (1 - sconto/100)
    ordine          INT NOT NULL DEFAULT 0,
    note            VARCHAR(255) NULL,
    INDEX idx_voce_prev (preventivo_id, ordine),
    INDEX idx_voce_serv (servizio_id),
    CONSTRAINT fk_voce_prev FOREIGN KEY (preventivo_id)
        REFERENCES preventivi(id) ON DELETE CASCADE,
    CONSTRAINT fk_voce_serv FOREIGN KEY (servizio_id)
        REFERENCES servizi_catalogo(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── IMPOSTAZIONI TENANT ────────────────────────────────────
INSERT IGNORE INTO impostazioni (chiave, valore, tipo, gruppo, etichetta) VALUES
    ('preventivi_iva_default',    '22.00', 'numero',   'preventivi', 'Aliquota IVA di default'),
    ('preventivi_regime_fiscale', 'RF01',  'testo',    'preventivi', 'Regime fiscale (codice)'),
    ('preventivi_validita_gg',    '30',    'numero',   'preventivi', 'Validità default (giorni)'),
    ('preventivi_pdf_footer',     '',      'testo',    'preventivi', 'Footer PDF (condizioni legali)'),
    ('preventivi_ai_enabled',     '1',     'booleano', 'preventivi', 'AI assist su preventivi');

-- ── PERMESSI RBAC ─────────────────────────────────────────
INSERT IGNORE INTO permessi (codice, etichetta, area, ordine) VALUES
    ('servizi.gestire',      'Catalogo servizi (CRUD)',      'Preventivi', 70),
    ('preventivi.gestire',   'Crea/modifica preventivi',     'Preventivi', 71),
    ('preventivi.read',      'Lettura preventivi (storico)', 'Preventivi', 72),
    ('rapporti.gestire',     'Gestione rapporti di lavoro',  'Preventivi', 73),
    ('prestazioni.tracciare','Registra prestazioni (time)',  'Preventivi', 74);

-- ── DEFAULT MATRICE RUOLI ↔ PERMESSI ───────────────────────
-- direzione: tutto (catalogo + preventivi + rapporti + prestazioni)
-- responsabile: preventivi + rapporti + prestazioni + lettura (no catalogo)
-- operatore/capoufficio: solo lettura preventivi + prestazioni
-- admin: nessuna riga (ACLController::puo() ritorna sempre true)
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
