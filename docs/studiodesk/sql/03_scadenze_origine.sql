-- ============================================================
-- Migration 03 — Tracciamento origine delle scadenze
-- Aggiunge:
--   • origine ENUM(manuale, import_ufficiale, ai)
--   • codice_import VARCHAR(80) — chiave univoca per evitare doppioni
--     quando re-importi lo stesso dataset (es. f24-gennaio-2026)
-- Idempotente: si può rieseguire senza errori se le colonne esistono.
-- ============================================================

USE portal_template;

ALTER TABLE scadenze
    ADD COLUMN origine ENUM('manuale','import_ufficiale','ai') NOT NULL DEFAULT 'manuale' AFTER attivo,
    ADD COLUMN codice_import VARCHAR(80) NULL AFTER origine,
    ADD UNIQUE KEY uniq_codice_import (codice_import);
