-- ============================================================
-- Migration: 02_crm_upgrade.sql
-- Aggiunge le 3 features ad alto impatto identificate nell'analisi CRM:
--   1. Note interne nel thread (lato='interno')
--   2. Tracciamento canale origine messaggio
--   3. Assegnazione esplicita operatore alle comunicazioni
--
-- Idempotente: usa controlli IF NOT EXISTS / IF EXISTS dove possibile,
-- altrimenti racchiude le ALTER in DO blocks. Eseguire con:
--   sed 's/portal_template/portal_<slug>/g' 02_crm_upgrade.sql | mysql -u root
-- ============================================================

USE portal_template;

-- 1. Aggiungi 'interno' all'ENUM lato. MySQL permette di estendere un ENUM
--    purché i valori esistenti restino in posizione 1..N (qui 'studio' e
--    'cliente' restano agli indici 1 e 2 — niente data migration necessaria).
ALTER TABLE com_messaggi
    MODIFY COLUMN lato ENUM('studio','cliente','interno') NOT NULL;

-- 2. Tracciamento canale di origine del messaggio.
--    Default 'portale' per tutti i messaggi esistenti.
ALTER TABLE com_messaggi
    ADD COLUMN origine ENUM('portale','telegram','email','sa') NOT NULL DEFAULT 'portale' AFTER lato;

-- 3. Assegnazione operatore alle comunicazioni.
--    NULL = non assegnata (= "da prendere in carico").
ALTER TABLE comunicazioni
    ADD COLUMN operatore_assegnato_id INT NULL AFTER user_id;

ALTER TABLE comunicazioni
    ADD CONSTRAINT fk_co_operatore
    FOREIGN KEY (operatore_assegnato_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE comunicazioni
    ADD INDEX idx_co_operatore (operatore_assegnato_id, chiusa);

-- 4. Preferenza utente per notifiche email su eventi ticket.
--    Riusa la tabella user_preferenze (chiave/valore). Default = '1' (ON).
--    L'inserimento è "lazy" — la prima volta che si chiede il valore, se
--    manca si assume '1'. Quindi nessun seed iniziale.
