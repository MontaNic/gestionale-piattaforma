-- ============================================================
-- 28_email_per_servizio.sql
--
-- Migrazione master.
--
-- 1) Rinomina platform_settings.contact_email → email_general
--    (config.php legge prima 'email_general' poi 'contact_email' come
--     fallback, quindi i tenant non aggiornati continuano a funzionare).
-- 2) Inserisce platform_settings.email_privacy come override esplicito
--    per il canale "Privacy & richieste legali" (form delle pagine
--    /privacy /cookie /termini con pulsante "Clicca qui").
-- 3) Aggiunge contatti_richieste.motivo per tracciare la sezione di
--    provenienza delle richieste legali (whitelist: privacy_titolare,
--    privacy_diritti, termini_chiarimenti). NULL = form generico landing.
--
-- Idempotente: rilanciabile in sicurezza.
-- ============================================================

USE portal_master;

-- (1) rinomina chiave contact_email → email_general
UPDATE platform_settings SET chiave = 'email_general'
  WHERE chiave = 'contact_email';

-- (2) seed riga email_privacy (preserva eventuale override esistente)
INSERT INTO platform_settings (chiave, valore, updated_by)
VALUES ('email_privacy', NULL, NULL)
ON DUPLICATE KEY UPDATE valore = valore;

-- (3) contatti_richieste.motivo — solo se non già presente
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'portal_master'
     AND TABLE_NAME   = 'contatti_richieste'
     AND COLUMN_NAME  = 'motivo'
);
SET @ddl := IF(@exists = 0,
  'ALTER TABLE contatti_richieste ADD COLUMN motivo VARCHAR(40) NULL AFTER studio',
  'SELECT ''motivo already exists'' AS skipped'
);
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
