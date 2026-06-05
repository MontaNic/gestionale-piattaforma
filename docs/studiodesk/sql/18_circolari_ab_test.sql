-- ============================================================
-- migrations/18_circolari_ab_test.sql
--
-- A/B test sul "subject" email di una circolare.
-- - subject_variant_a / subject_variant_b: due varianti scritte dall'op.
-- - circolari_letture.email_variant: traccia quale variante è stata
--   inviata a ciascun destinatario (50/50 random)
-- ============================================================

ALTER TABLE circolari
    ADD COLUMN subject_variant_a VARCHAR(255) NULL AFTER oggetto,
    ADD COLUMN subject_variant_b VARCHAR(255) NULL AFTER subject_variant_a;

ALTER TABLE circolari_letture
    ADD COLUMN email_variant CHAR(1) NULL AFTER tipo_lettura;

-- Nuova tabella: ogni invio email tracciato con la variante assegnata.
-- Permette il calcolo dell'open rate (letture / invii) per variante.
CREATE TABLE IF NOT EXISTS circolari_email_invii (
    id           INT NOT NULL AUTO_INCREMENT,
    circolare_id INT NOT NULL,
    user_id      INT NOT NULL,
    variant      CHAR(1) NOT NULL,                          -- 'A' o 'B'
    sent_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_circ_user (circolare_id, user_id),
    CONSTRAINT fk_cei_circ FOREIGN KEY (circolare_id) REFERENCES circolari(id) ON DELETE CASCADE,
    CONSTRAINT fk_cei_user FOREIGN KEY (user_id)      REFERENCES users(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
