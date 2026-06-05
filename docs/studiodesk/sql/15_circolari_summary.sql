-- ============================================================
-- migrations/15_circolari_summary.sql
--
-- Aggiunge il campo `summary_html` alla tabella circolari per
-- memorizzare il riassunto AI generato lazy-on-demand. Un riassunto
-- per circolare (la circolare è immutabile dopo pubblicazione).
--
-- Apply per-tenant; idempotente.
-- ============================================================

ALTER TABLE circolari
    ADD COLUMN summary_html TEXT NULL AFTER body_html,
    ADD COLUMN summary_generated_at DATETIME NULL AFTER summary_html;
