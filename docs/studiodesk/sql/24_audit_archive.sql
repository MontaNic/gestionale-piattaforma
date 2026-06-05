-- ============================================================
-- FILE: migrations/24_audit_archive.sql
-- Tabelle di archivio per audit log >12 mesi.
--
-- Schema speculare alla tabella attiva, con indici minimi:
-- gli archivi servono per query browsing/forensic occasionali,
-- non per lookup ad alta frequenza. Lo scopo e' fermare la
-- crescita unbounded delle tabelle audit principali, mantenendo
-- EXPLAIN sani sul flusso operativo.
--
-- Applicata automaticamente dal cron bin/cron-archive-audit.php
-- (self-bootstrapping: crea la tabella alla prima esecuzione).
-- Questo file resta come reference per i nuovi tenant.
-- ============================================================

-- ── Per-tenant: audit_log_archive ────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log_archive (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NULL,
    ip          VARCHAR(45) NULL,
    azione      VARCHAR(80) NOT NULL,
    entita      VARCHAR(80) NULL,
    entita_id   INT NULL,
    dettagli    JSON NULL,
    created_at  TIMESTAMP NULL,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ala_created (created_at)
) ENGINE=InnoDB;

-- ── Master: superadmin_audit_archive ─────────────────────────
-- Da applicare al DB portal_master (non per-tenant).
-- CREATE TABLE IF NOT EXISTS superadmin_audit_archive (
--     id             INT AUTO_INCREMENT PRIMARY KEY,
--     superadmin_id  INT NULL,
--     studio_id      INT NULL,
--     azione         VARCHAR(60) NOT NULL,
--     ip             VARCHAR(45) NULL,
--     dettagli       JSON NULL,
--     created_at     TIMESTAMP NULL,
--     archived_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     INDEX idx_saa_created (created_at)
-- ) ENGINE=InnoDB;
