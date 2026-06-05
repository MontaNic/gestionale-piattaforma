-- ============================================================
-- migrations/26_whatsapp.sql
--
-- Canale WhatsApp Cloud API (Meta) come add-on a pagamento per tenant.
-- Mirror del pattern Telegram ma SOLO INBOUND: il cliente scrive sul
-- numero WA dello studio, il messaggio diventa una comunicazione nel
-- portale. L'operatore risponde DAL PORTALE — nessun outbound WA.
--
-- Policy 24h: se nessun operatore risponde entro 24h da un messaggio
-- WA, la comunicazione viene chiusa automaticamente (cron). Compatibile
-- con "customer service window" gratuito di Meta.
--
-- Idempotente per i pezzi che lo consentono. La ALTER su ENUM è
-- "additive only" (i valori esistenti restano validi).
-- ============================================================

-- 1) Estende ENUM origine in com_messaggi (additivo)
ALTER TABLE com_messaggi
    MODIFY COLUMN origine ENUM('portale','telegram','email','sa','whatsapp')
    NOT NULL DEFAULT 'portale';

-- 2) Numero WhatsApp del cliente (E.164 senza '+', es. "393331234567").
--    Indice per lookup veloce sul webhook inbound.
--    Il blocco SET @ + PREPARE rende la ALTER idempotente: se la colonna
--    esiste già (ri-run su tenant già migrato) si fa un SELECT-noop.
SET @col_cnt := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'whatsapp_numero'
);
SET @sql := IF(@col_cnt = 0,
    "ALTER TABLE users
       ADD COLUMN whatsapp_numero VARCHAR(20) NULL DEFAULT NULL AFTER telegram_chat_id,
       ADD INDEX idx_u_whatsapp (whatsapp_numero)",
    "SELECT 'users.whatsapp_numero already exists' AS skip"
);
PREPARE _stmt FROM @sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- 3) Log/dedup messaggi inbound WhatsApp. Serve a:
--    - dedup su wa_message_id (Meta a volte rispedisce lo stesso update)
--    - tracciamento ricezioni per debugging / audit
--    - associazione messaggio → comunicazione per future analytics
CREATE TABLE IF NOT EXISTS whatsapp_inbound_log (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    wa_message_id   VARCHAR(120) NOT NULL,
    wa_from         VARCHAR(20)  NOT NULL,            -- mittente E.164 senza '+'
    wa_phone_id     VARCHAR(50)  NULL,                -- phone_number_id ricevente
    user_id         INT          NULL,                -- match utente (NULL se sconosciuto)
    comunicazione_id INT         NULL,                -- com creata/aggiornata
    messaggio_id    INT          NULL,                -- com_messaggi.id risultante
    tipo            VARCHAR(20)  NOT NULL DEFAULT 'text',
    payload_summary VARCHAR(500) NULL,                -- estratto leggibile (NON il full body)
    esito           ENUM('ok','no_user','no_text','dup','error') NOT NULL DEFAULT 'ok',
    note            VARCHAR(255) NULL,
    received_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_wa_msgid (wa_message_id),
    INDEX idx_wa_from (wa_from),
    INDEX idx_wa_user (user_id),
    INDEX idx_wa_com  (comunicazione_id),
    INDEX idx_wa_received (received_at),
    CONSTRAINT fk_wa_user FOREIGN KEY (user_id)          REFERENCES users(id)          ON DELETE SET NULL,
    CONSTRAINT fk_wa_com  FOREIGN KEY (comunicazione_id) REFERENCES comunicazioni(id)  ON DELETE SET NULL,
    CONSTRAINT fk_wa_msg  FOREIGN KEY (messaggio_id)     REFERENCES com_messaggi(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Seed impostazioni WhatsApp (tutte spente di default).
--    L'add-on viene proposto in admin/impostazioni → tab WhatsApp; il gating
--    "a pagamento" è fatto da src/piani.php (feature_codes + pianoHasFeature).
INSERT INTO impostazioni (chiave, valore, tipo, gruppo, etichetta) VALUES
    ('whatsapp_attivo',          '0', 'booleano', 'integrazioni', 'WhatsApp Cloud API attivo'),
    ('whatsapp_phone_id',        '',  'testo',    'integrazioni', 'Meta Phone Number ID'),
    ('whatsapp_token',           '',  'testo',    'integrazioni', 'Permanent Access Token Meta'),
    ('whatsapp_app_secret',      '',  'testo',    'integrazioni', 'App Secret per firma webhook'),
    ('whatsapp_verify_token',    '',  'testo',    'integrazioni', 'Verify Token (handshake GET webhook)'),
    ('whatsapp_numero_display',  '',  'testo',    'integrazioni', 'Numero WhatsApp pubblico (display)'),
    ('whatsapp_auto_close_ore',  '24','numero',   'integrazioni', 'Ore prima della chiusura automatica (0 = disattivo)'),
    ('whatsapp_business_account_id','','testo',   'integrazioni', 'Meta WhatsApp Business Account ID (opz.)')
ON DUPLICATE KEY UPDATE chiave = VALUES(chiave);

-- 5) Marker per riconoscere le comunicazioni auto-chiuse dal cron 24h.
--    Permette di filtrare/riaprirle senza ambiguità rispetto a chiusure manuali.
SET @col_cnt2 := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'comunicazioni'
      AND COLUMN_NAME  = 'auto_chiusa_motivo'
);
SET @sql2 := IF(@col_cnt2 = 0,
    "ALTER TABLE comunicazioni ADD COLUMN auto_chiusa_motivo VARCHAR(40) NULL DEFAULT NULL AFTER chiusa_il",
    "SELECT 'comunicazioni.auto_chiusa_motivo already exists' AS skip"
);
PREPARE _stmt2 FROM @sql2; EXECUTE _stmt2; DEALLOCATE PREPARE _stmt2;
