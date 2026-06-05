-- ============================================================
-- portal_master — registry centrale di Portal
-- Contiene: registry studi, account superadmin, audit superadmin
-- ============================================================

CREATE DATABASE IF NOT EXISTS portal_master
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE portal_master;

CREATE TABLE IF NOT EXISTS studios (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    nome         VARCHAR(150) NOT NULL,
    slug         VARCHAR(50)  NOT NULL UNIQUE,
    dominio      VARCHAR(255) NULL,
    db_host      VARCHAR(120) NOT NULL DEFAULT 'localhost',
    db_name      VARCHAR(64)  NOT NULL,
    db_user      VARCHAR(64)  NOT NULL,
    db_pass      VARCHAR(255) NOT NULL,
    piano        ENUM('base','pro','enterprise') NOT NULL DEFAULT 'base',
    attivo       TINYINT(1)   NOT NULL DEFAULT 1,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS superadmin_users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    nome          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    attivo        TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login    TIMESTAMP    NULL DEFAULT NULL
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS superadmin_audit (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    -- NULL ammesso per eventi non legati ad un superadmin specifico
    -- (es. login_failed con email tentata ignota o admin disattivato).
    superadmin_id  INT NULL,
    studio_id      INT NULL,
    azione         VARCHAR(60) NOT NULL,
    ip             VARCHAR(45) NULL,
    dettagli       JSON NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sa_aud         (superadmin_id, created_at),
    INDEX idx_aud_azione_ts  (azione, created_at DESC),
    INDEX idx_aud_studio_ts  (studio_id, created_at DESC)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
