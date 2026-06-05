-- ============================================================
-- Migration 04 — Configurazione notifiche email per-tenant
-- Tabella che permette all'admin di studio di:
--   • Attivare/disattivare le notifiche per ogni evento di sistema
--   • Personalizzare subject e body (HTML inline) per ogni evento
--   • Personalizzare label CTA del bottone
-- I template di default vivono in src/notifiche_default.php.
-- Se subject_override / body_override / cta_label_override sono NULL,
-- viene usato il default di sistema.
--
-- Eventi supportati (chiave `evento`):
--   ticket_aperta_cliente, ticket_aperta_studio,
--   ticket_risposta_studio, ticket_risposta_cliente,
--   ticket_chiusa, ticket_assegnato_operatore,
--   scadenza_memo_7gg, scadenza_memo_1gg, documento_caricato
-- (Invito e reset password restano hardcoded — escluse da qui.)
-- ============================================================

USE portal_template;

CREATE TABLE IF NOT EXISTS notifiche_config (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    evento                VARCHAR(60) NOT NULL UNIQUE,
    attiva                TINYINT(1)  NOT NULL DEFAULT 1,
    -- Quale "rolo" riceve la mail: serve a calcolare i destinatari runtime.
    --   cliente_azienda     = utenti dell'azienda associata al ticket
    --   operatore_assegnato = l'operatore in carico del ticket (fallback admin se libero)
    --   utente_target       = utente specifico passato al runtime (es. invito)
    destinatario          ENUM('cliente_azienda','operatore_assegnato','utente_target') NOT NULL,
    subject_override      VARCHAR(255) NULL,
    body_override         TEXT         NULL,
    cta_label_override    VARCHAR(80)  NULL,
    note_admin            VARCHAR(255) NULL,
    updated_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_nc_evento (evento, attiva)
) ENGINE=InnoDB;

-- Seed di default: insert delle 9 righe con valori standard.
-- ON DUPLICATE evita errori se la riga c'è già (re-import).
INSERT INTO notifiche_config (evento, attiva, destinatario) VALUES
    ('ticket_aperta_cliente',       1, 'operatore_assegnato'),
    ('ticket_aperta_studio',        1, 'cliente_azienda'),
    ('ticket_risposta_studio',      1, 'cliente_azienda'),
    ('ticket_risposta_cliente',     1, 'operatore_assegnato'),
    ('ticket_chiusa',               1, 'cliente_azienda'),
    ('ticket_assegnato_operatore',  1, 'utente_target'),
    ('scadenza_memo_7gg',           0, 'cliente_azienda'),
    ('scadenza_memo_1gg',           0, 'cliente_azienda'),
    ('documento_caricato',          0, 'cliente_azienda')
ON DUPLICATE KEY UPDATE evento = VALUES(evento);
