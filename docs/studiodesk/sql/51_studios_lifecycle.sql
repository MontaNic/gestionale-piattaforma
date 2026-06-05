-- ============================================================
-- FILE: migrations/51_studios_lifecycle.sql
-- Ciclo di vita di uno studio (tenant): sospensione + cestino + purge.
-- Da applicare SOLO su portal_master, non sui tenant.
--
-- Stati derivati dalle colonne di studios:
--   attivo=1                          → studio OPERATIVO
--   attivo=0  AND eliminato_at NULL   → SOSPESO (DB intatto, riattivabile)
--   eliminato_at IS NOT NULL          → NEL CESTINO (purge schedulato a purge_at)
--   (riga rimossa)                    → PURGATO (DB + storage eliminati)
--
-- Gestione: superadmin/studi.php (web) + bin/cron-purge-studi.php (cron).
-- ============================================================

ALTER TABLE studios
    ADD COLUMN sospeso_at   DATETIME NULL DEFAULT NULL AFTER attivo,
    ADD COLUMN eliminato_at DATETIME NULL DEFAULT NULL AFTER sospeso_at,
    ADD COLUMN purge_at     DATETIME NULL DEFAULT NULL AFTER eliminato_at,
    ADD COLUMN eliminato_da INT      NULL DEFAULT NULL AFTER purge_at;

-- Indice per la scansione del cron di purge (purge_at <= NOW()).
ALTER TABLE studios
    ADD INDEX idx_studios_purge (purge_at);
