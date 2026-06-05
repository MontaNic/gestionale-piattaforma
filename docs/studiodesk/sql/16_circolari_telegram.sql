-- ============================================================
-- migrations/16_circolari_telegram.sql
--
-- Aggiunge:
-- 1. circolari.telegram_broadcast — flag per-circolare per invio Telegram
-- 2. seed di una preferenza utente "notif_telegram_circolari"
--    (default ON; il cliente può disattivare da profilo se vuole solo email)
-- ============================================================

ALTER TABLE circolari
    ADD COLUMN telegram_broadcast TINYINT(1) NOT NULL DEFAULT 0 AFTER richiede_conferma;
