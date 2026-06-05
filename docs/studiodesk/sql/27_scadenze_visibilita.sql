-- ============================================================
-- migrations/27_scadenze_visibilita.sql
--
-- Aggiunge visibilità per scadenze (fix privacy / GDPR).
-- Prima di questa migration, TUTTE le scadenze in `scadenze` erano
-- globali al tenant: ogni cliente vedeva ogni memo dello studio,
-- incluse scadenze "manuali" che spesso contengono dati personali
-- di un singolo cliente nel titolo (es. "Scadenza CIE — Mario Rossi").
--
-- Da questa migration ogni scadenza dichiara chi può vederla, con
-- pattern identico a documenti/circolari:
--   - visibilita='tutti'    → tutti i clienti del tenant
--   - visibilita='azienda'  → solo i dipendenti dell'azienda X
--   - visibilita='reparto'  → solo i dipendenti del reparto Y dell'azienda X
--   - visibilita='utente'   → solo l'utente Z
--
-- Idempotente (tutte le ALTER protette da controllo information_schema).
-- ============================================================

-- 1) visibilita ENUM (default 'tutti' = comportamento legacy preservato
--    per le scadenze ufficiali/fiscali nazionali).
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'scadenze'
      AND COLUMN_NAME  = 'visibilita'
);
SET @sql := IF(@col = 0,
    "ALTER TABLE scadenze
       ADD COLUMN visibilita ENUM('tutti','azienda','reparto','utente')
         NOT NULL DEFAULT 'tutti' AFTER origine",
    "SELECT 'scadenze.visibilita already exists' AS skip"
);
PREPARE _s1 FROM @sql; EXECUTE _s1; DEALLOCATE PREPARE _s1;

-- 2) azienda_id (FK su aziende, NULL se visibilita='tutti'|'utente').
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'scadenze'
      AND COLUMN_NAME  = 'azienda_id'
);
SET @sql := IF(@col = 0,
    "ALTER TABLE scadenze
       ADD COLUMN azienda_id INT NULL DEFAULT NULL AFTER visibilita,
       ADD CONSTRAINT fk_sc_azienda FOREIGN KEY (azienda_id)
         REFERENCES aziende(id) ON DELETE SET NULL,
       ADD INDEX idx_sc_azienda (azienda_id, attivo)",
    "SELECT 'scadenze.azienda_id already exists' AS skip"
);
PREPARE _s2 FROM @sql; EXECUTE _s2; DEALLOCATE PREPARE _s2;

-- 3) reparto_id (FK su reparti_azienda, valido solo se visibilita='reparto').
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'scadenze'
      AND COLUMN_NAME  = 'reparto_id'
);
SET @sql := IF(@col = 0,
    "ALTER TABLE scadenze
       ADD COLUMN reparto_id INT NULL DEFAULT NULL AFTER azienda_id,
       ADD CONSTRAINT fk_sc_reparto FOREIGN KEY (reparto_id)
         REFERENCES reparti_azienda(id) ON DELETE SET NULL,
       ADD INDEX idx_sc_reparto (reparto_id)",
    "SELECT 'scadenze.reparto_id already exists' AS skip"
);
PREPARE _s3 FROM @sql; EXECUTE _s3; DEALLOCATE PREPARE _s3;

-- 4) user_id (FK su users, valido solo se visibilita='utente').
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'scadenze'
      AND COLUMN_NAME  = 'user_id'
);
SET @sql := IF(@col = 0,
    "ALTER TABLE scadenze
       ADD COLUMN user_id INT NULL DEFAULT NULL AFTER reparto_id,
       ADD CONSTRAINT fk_sc_user FOREIGN KEY (user_id)
         REFERENCES users(id) ON DELETE SET NULL,
       ADD INDEX idx_sc_user (user_id, attivo)",
    "SELECT 'scadenze.user_id already exists' AS skip"
);
PREPARE _s4 FROM @sql; EXECUTE _s4; DEALLOCATE PREPARE _s4;

-- 5) Marker quarantena: le scadenze MANUALI esistenti vengono
--    disattivate (attivo=0) e segnate "da_revisionare=1" perché prima
--    erano globali e ora rischiano di essere mostrate al destinatario
--    sbagliato. Il pannello admin mostrerà un banner finché ne resta
--    almeno una in quarantena.
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'scadenze'
      AND COLUMN_NAME  = 'da_revisionare'
);
SET @sql := IF(@col = 0,
    "ALTER TABLE scadenze
       ADD COLUMN da_revisionare TINYINT(1) NOT NULL DEFAULT 0 AFTER user_id,
       ADD INDEX idx_sc_revisione (da_revisionare)",
    "SELECT 'scadenze.da_revisionare already exists' AS skip"
);
PREPARE _s5 FROM @sql; EXECUTE _s5; DEALLOCATE PREPARE _s5;

-- 6) Quarantena retroattiva delle scadenze manuali esistenti.
--    Solo prima esecuzione: una volta che `da_revisionare` esiste,
--    re-run di questo UPDATE è no-op (filtra su da_revisionare=0).
--    Si esclude origine='import_ufficiale' (universali, già OK con
--    default 'tutti') e 'ai' (suggerite automaticamente, basso rischio).
UPDATE scadenze
   SET attivo = 0, da_revisionare = 1
 WHERE origine = 'manuale'
   AND attivo = 1
   AND da_revisionare = 0;
