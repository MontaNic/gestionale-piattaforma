-- ============================================================
-- FILE: migrations/25_audit_immutable.sql
-- Tamper-protection sull'audit_log: trigger BEFORE UPDATE/DELETE
-- che bloccano la modifica/cancellazione retroattiva delle righe.
--
-- L'eccezione legittima e' il cron di archiviazione, che cancella
-- le righe vecchie dopo averle copiate in audit_log_archive. Per
-- distinguere un DELETE "buono" da uno "cattivo" usiamo la
-- variabile di sessione @audit_archiving = 1, settata dal cron
-- inside transazione PRIMA del DELETE e ripulita dopo.
--
-- Pattern speculare al trigger esistente su circolari_audit
-- (migrations/13_circolari_v2.sql).
--
-- Applicare via bin/migrate-audit-immutable.php (idempotente:
-- DROP TRIGGER IF EXISTS + CREATE).
-- ============================================================

DROP TRIGGER IF EXISTS trg_audit_log_no_update;
DROP TRIGGER IF EXISTS trg_audit_log_no_delete;

DELIMITER $$

CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'audit_log e\' append-only: UPDATE non consentito';
END$$

CREATE TRIGGER trg_audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW
BEGIN
    IF COALESCE(@audit_archiving, 0) <> 1 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'audit_log e\' append-only: DELETE consentito solo al cron di archiviazione';
    END IF;
END$$

DELIMITER ;
