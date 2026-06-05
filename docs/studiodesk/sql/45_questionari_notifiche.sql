-- ============================================================
-- migrations/45_questionari_notifiche.sql
-- Modulo Questionari: notifiche email + solleciti automatici.
-- Per-tenant. Applicare su ogni tenant attivo.
-- ============================================================

-- Marca temporale dell'ultimo sollecito inviato per (questionario, cliente).
-- NULL = nessun sollecito ancora inviato.
ALTER TABLE questionari_risposte
    ADD COLUMN sollecitato_at DATETIME NULL DEFAULT NULL AFTER completato_at;

-- Eventi di notifica configurabili da /admin/notifiche.
INSERT INTO notifiche_config (evento, attiva, destinatario) VALUES
    ('questionario_assegnato',  1, 'utente_target'),
    ('questionario_completato', 1, 'admin_studio'),
    ('questionario_sollecito',  1, 'utente_target')
ON DUPLICATE KEY UPDATE evento = VALUES(evento);
