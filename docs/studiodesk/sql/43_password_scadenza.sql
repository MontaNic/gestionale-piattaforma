-- ============================================================
-- Migration 43 — Scadenza password (policy per-tenant)
--
-- Aggiunge il tracciamento dell'eta' della password e lo storico
-- degli ultimi hash usati (anti-riciclo).
--
-- La policy vera e propria vive in `impostazioni`:
--   password_scadenza_staff   -> operatore/responsabile/capoufficio
--   password_scadenza_clienti -> ruolo 'cliente'
-- Valori ammessi: 0 (mai), 30, 60, 90, 180 giorni.
-- admin/direzione: mai soggetti a scadenza.
-- Esonero automatico per chi ha un 2o fattore forte (2FA TOTP o passkey).
--
-- Backfill: password_changed_at = NOW(). L'eta' reale della password
-- non era tracciata (created_at != ultimo cambio password), quindi il
-- conteggio parte dall'applicazione di questa migration. password_storico
-- viene seedato con l'hash corrente cosi' la password attuale e' gia'
-- nel set bloccato per l'anti-riciclo.
--
-- Applicare su OGNI tenant attivo, es.:
--   for db in $(mysql -N -e "SELECT db_name FROM portal_master.studios WHERE attivo=1"); do
--     mysql "$db" < migrations/43_password_scadenza.sql
--   done
-- ============================================================

ALTER TABLE users
    ADD COLUMN password_changed_at DATETIME NULL DEFAULT NULL
        COMMENT 'Ultimo cambio password — base per il calcolo della scadenza',
    ADD COLUMN password_storico    JSON     NULL DEFAULT NULL
        COMMENT 'Hash delle ultime password usate (anti-riciclo), recente->vecchio';

UPDATE users
   SET password_changed_at = NOW(),
       password_storico    = JSON_ARRAY(password_hash)
 WHERE password_changed_at IS NULL;
