-- ============================================================
-- 23_com_indici.sql
-- Indici composti su comunicazioni per velocizzare la lista inbox
-- (filtri + ORDER BY urgente,updated_at) anche su tenant grandi.
--
-- Idempotente: applicato via bin/migrate-com-indexes.php (skip se già presenti).
-- ============================================================

-- Inbox principale: filtra su chiusa + (eventualmente) operatore_assegnato_id,
-- ordina per urgente DESC, updated_at DESC.
ALTER TABLE comunicazioni
  ADD INDEX idx_com_inbox (chiusa, operatore_assegnato_id, urgente, updated_at);

-- Lista per azienda (modal "ultime comunicazioni" + admin azienda detail):
-- filtra su azienda_id + chiusa, ordina per updated_at DESC.
ALTER TABLE comunicazioni
  ADD INDEX idx_com_azienda_aperte (azienda_id, chiusa, updated_at);
