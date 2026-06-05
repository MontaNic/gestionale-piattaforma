-- ============================================================
-- 22_superadmin_security.sql
-- Schema per il pannello /superadmin/sicurezza|server|log esteso.
-- Tutto in portal_master: sono dati di piattaforma, non per-tenant.
--
-- Applicare con:
--   mysql -u root portal_master < migrations/22_superadmin_security.sql
-- ============================================================

-- Cache geolocalizzazione IP (ip-api.com, free tier 45 req/min).
-- Chiave binaria via INET6_ATON per supporto IPv4+IPv6.
CREATE TABLE IF NOT EXISTS geoip_cache (
  ip            VARBINARY(16) NOT NULL PRIMARY KEY,
  ip_str        VARCHAR(45)   NOT NULL,
  country_code  CHAR(2)       NULL,
  country_name  VARCHAR(64)   NULL,
  region        VARCHAR(64)   NULL,
  city          VARCHAR(64)   NULL,
  isp           VARCHAR(160)  NULL,
  org           VARCHAR(160)  NULL,
  asn           VARCHAR(32)   NULL,
  lat           DECIMAL(9,6)  NULL,
  lon           DECIMAL(9,6)  NULL,
  resolved_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status        ENUM('ok','fail','private') NOT NULL DEFAULT 'ok',
  INDEX idx_geoip_resolved (resolved_at),
  INDEX idx_geoip_country  (country_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Storico ban IP eseguiti dal pannello (target = fail2ban | ufw | both).
CREATE TABLE IF NOT EXISTS ip_ban_history (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  ip              VARCHAR(45)   NOT NULL,
  target          ENUM('fail2ban','ufw','both') NOT NULL,
  jail            VARCHAR(48)   NULL,
  motivo          VARCHAR(255)  NULL,
  banned_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unbanned_at     DATETIME      NULL,
  duration_sec    INT           NULL,
  superadmin_id   INT           NULL,
  esito           ENUM('ok','err') NOT NULL DEFAULT 'ok',
  errore          VARCHAR(500)  NULL,
  INDEX idx_ban_ip       (ip),
  INDEX idx_ban_at       (banned_at),
  INDEX idx_ban_target   (target)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Log della console diagnostica del pannello (whitelist: ping, dig, ecc).
CREATE TABLE IF NOT EXISTS superadmin_console_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  superadmin_id INT           NOT NULL,
  command       VARCHAR(60)   NOT NULL,
  arguments     VARCHAR(255)  NULL,
  exit_code     SMALLINT      NULL,
  duration_ms   INT           NULL,
  ip            VARCHAR(45)   NULL,
  executed_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_console_when (executed_at),
  INDEX idx_console_cmd  (command)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshot risorse server (CPU/RAM/load) salvati ogni 1-5 min dal cron.
-- Serve per grafici "ultimi 30 min" senza dover bufferare in memoria.
CREATE TABLE IF NOT EXISTS server_metrics (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  sampled_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cpu_pct       DECIMAL(5,2)  NULL,
  ram_used_mb   INT           NULL,
  ram_total_mb  INT           NULL,
  disk_used_pct DECIMAL(5,2)  NULL,
  load_1        DECIMAL(6,2)  NULL,
  load_5        DECIMAL(6,2)  NULL,
  load_15       DECIMAL(6,2)  NULL,
  net_rx_kbps   INT           NULL,
  net_tx_kbps   INT           NULL,
  INDEX idx_metrics_when (sampled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── GRANTS ───────────────────────────────────────────────────
-- portal_master_user ha grants per-tabella (intenzionale). Le 5 tabelle
-- nuove richiedono grant esplicito altrimenti il pannello SA risponde
-- 500 con "SELECT command denied" / "INSERT command denied".
-- Eseguire come root:
--   GRANT SELECT, INSERT, UPDATE, DELETE
--     ON portal_master.geoip_cache             TO 'portal_master_user'@'localhost';
--   GRANT SELECT, INSERT, UPDATE, DELETE
--     ON portal_master.ip_ban_history          TO 'portal_master_user'@'localhost';
--   GRANT SELECT, INSERT, UPDATE, DELETE
--     ON portal_master.superadmin_console_log  TO 'portal_master_user'@'localhost';
--   GRANT SELECT, INSERT, UPDATE, DELETE
--     ON portal_master.server_metrics          TO 'portal_master_user'@'localhost';
--   GRANT SELECT, INSERT, UPDATE, DELETE
--     ON portal_master.ssh_attempts_hourly     TO 'portal_master_user'@'localhost';
--   FLUSH PRIVILEGES;

-- Aggrega tentativi SSH falliti per IP+ora (popolato da parser di auth.log).
-- Avere già la pre-aggregation evita di fare tail/grep ad ogni request.
CREATE TABLE IF NOT EXISTS ssh_attempts_hourly (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  hour_bucket   DATETIME      NOT NULL,
  ip            VARCHAR(45)   NOT NULL,
  user_tentato  VARCHAR(64)   NULL,
  count         INT           NOT NULL DEFAULT 0,
  successo      TINYINT(1)    NOT NULL DEFAULT 0,
  UNIQUE KEY uk_ssh_hr_ip_user (hour_bucket, ip, user_tentato, successo),
  INDEX idx_ssh_hr_when (hour_bucket),
  INDEX idx_ssh_hr_ip   (ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
