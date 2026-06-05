-- @target: tenant
-- ============================================================
-- migrations/63_preventivi_notifiche.sql
-- Fase 2 modulo Preventivi: 5 eventi email configurabili.
-- Riusa il sistema MailerService::inviaNotificaSistema esistente.
-- Idempotente.
-- ============================================================

INSERT INTO notifiche_config (evento, attiva, destinatario) VALUES
    ('preventivo_inviato',     1, 'utente_target'),
    ('preventivo_accettato',   1, 'admin_studio'),
    ('preventivo_rifiutato',   1, 'admin_studio'),
    ('preventivo_revisione',   1, 'admin_studio'),
    -- in_scadenza: trigger cron Fase 6, default OFF (attivabile da /admin/notifiche)
    ('preventivo_in_scadenza', 0, 'admin_studio')
ON DUPLICATE KEY UPDATE evento = VALUES(evento);
