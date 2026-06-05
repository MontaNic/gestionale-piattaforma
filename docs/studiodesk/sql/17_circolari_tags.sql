-- ============================================================
-- migrations/17_circolari_tags.sql
--
-- Tag normalizzati per circolari (M:N). I tag sono case-insensitive
-- e per-tenant. Possono essere generati dall'AI o aggiunti a mano
-- dall'operatore. La ricerca cliente userà questi tag come filtri.
-- ============================================================

CREATE TABLE IF NOT EXISTS circolari_tags (
    id          INT NOT NULL AUTO_INCREMENT,
    nome        VARCHAR(50) NOT NULL,
    slug        VARCHAR(60) NOT NULL,        -- normalizzato lowercase + dashes
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS circolari_tag_link (
    circolare_id INT NOT NULL,
    tag_id       INT NOT NULL,
    PRIMARY KEY (circolare_id, tag_id),
    CONSTRAINT fk_ctl_circ FOREIGN KEY (circolare_id) REFERENCES circolari(id)        ON DELETE CASCADE,
    CONSTRAINT fk_ctl_tag  FOREIGN KEY (tag_id)       REFERENCES circolari_tags(id)   ON DELETE CASCADE,
    KEY idx_ctl_tag (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
