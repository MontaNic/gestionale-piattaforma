-- ============================================================
-- FILE: migrations/60_portafogli.sql
-- Fase 1 di "Portafogli clienti — visibilità ristretta operatori".
-- Spec: docs/prompt-portafogli-scoping.md
--
-- Schema della primitiva "Portafoglio" + M:N verso aziende/operatori +
-- impostazione tenant per il toggle scoping + permesso ACL per la
-- gestione UI.
--
-- Idempotente: riapplicabile su tenant esistenti senza errori.
-- Toggle OFF di default → zero impatto runtime fino a Fase 2.
-- ============================================================

-- ── PORTAFOGLI (gruppi di clienti+operatori per visibilità ristretta) ──
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

-- ── M:N portafoglio ↔ azienda (cliente) ───────────────────
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

-- ── M:N portafoglio ↔ operatore (utente interno) ──────────
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

-- ── Toggle tenant (OFF di default) ─────────────────────────
INSERT IGNORE INTO impostazioni (chiave, valore, tipo, gruppo) VALUES
    ('portafogli_scoping_attivo', '0', 'booleano', 'workflow');

-- ── Permesso RBAC per gestione UI (admin/direzione) ────────
INSERT IGNORE INTO permessi (codice, etichetta, area, ordine) VALUES
    ('portafogli.gestire', 'Gestione portafogli', 'Team', 32);

-- Assegnazione default ai ruoli sopra-scope (admin auto-true via ACLController;
-- esplicitato solo per direzione, per coerenza con la matrice canonica).
INSERT IGNORE INTO ruoli_permessi (ruolo_id, permesso_id)
SELECT r.id, p.id FROM ruoli r JOIN permessi p
WHERE r.nome = 'direzione' AND p.codice = 'portafogli.gestire';

-- ── Switch "Vista globale studio" per direzione (D3) ───────
-- Storage: tabella user_preferenze esistente (key-value).
-- Nessuna ALTER TABLE necessaria.
--   chiave  = 'vista_portafogli'
--   valore  = 'scoped' (default, vede solo i propri portafogli)
--          | 'global'  (above-scope come admin, vede tutto)
-- Riga assente = default implicito 'scoped' (il helper applica il fallback).
