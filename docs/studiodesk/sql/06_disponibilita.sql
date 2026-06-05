-- ============================================================
-- Migration 06 — Disponibilità operatori
--
-- 2 nuove tabelle per gestire:
--   1. Orari lavorativi standard (settimanali ricorrenti, multi-fascia)
--   2. Assenze (giornaliere, con date_inizio/date_fine + tipologia)
--
-- L'esistente colonna `users.disponibile` (TINYINT) resta come override
-- manuale "in pausa adesso" — utile per chiusure brevi non pianificate.
--
-- Logica di "isDisponibile($userId, $now)" applicata da UserDisponibilitaService:
--   - se users.disponibile = 0          → false (override manuale)
--   - se ho un'assenza che copre $now   → false
--   - se ho orari standard configurati e $now non rientra in nessuno → false
--   - altrimenti                         → true
-- ============================================================

USE portal_template;

-- ── 1. Orari lavorativi standard (settimanali) ────────────────
-- Una riga per ogni "fascia" (es. lun 9-13 e lun 14-18 = 2 righe)
CREATE TABLE IF NOT EXISTS user_orari_lavorativi (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT          NOT NULL,
    -- 0 = lunedì, 1 = martedì, ..., 6 = domenica (compat ISO)
    giorno          TINYINT      NOT NULL,
    -- Orari salvati come HH:MM (TIME), confronti con CURTIME()
    ora_inizio      TIME         NOT NULL,
    ora_fine        TIME         NOT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_orari_user (user_id, giorno),
    CONSTRAINT fk_orari_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_orari_giorno  CHECK (giorno BETWEEN 0 AND 6),
    CONSTRAINT chk_orari_orario  CHECK (ora_fine > ora_inizio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Assenze (ferie / malattia / permesso) ──────────────────
CREATE TABLE IF NOT EXISTS user_assenze (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT          NOT NULL,
    data_inizio     DATE         NOT NULL,
    data_fine       DATE         NOT NULL,
    tipo            ENUM('ferie','malattia','permesso','altro') NOT NULL DEFAULT 'ferie',
    motivo          VARCHAR(255) DEFAULT NULL,
    -- Chi ha inserito l'assenza (l'utente stesso o un responsabile/admin)
    inserita_da     INT          NOT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Flag per alert "assenza già notificata al responsabile":
    -- evita duplicati nei cron giornalieri
    alert_sent_at   TIMESTAMP    NULL DEFAULT NULL,
    INDEX idx_assenza_user   (user_id, data_inizio, data_fine),
    INDEX idx_assenza_range  (data_inizio, data_fine),
    CONSTRAINT fk_assenza_user      FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_assenza_inserita  FOREIGN KEY (inserita_da) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT chk_assenza_range    CHECK (data_fine >= data_inizio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
