-- @target: tenant
-- ============================================================
-- migrations/67_user_memo.sql
-- Spec: docs/prompt-memo-operatori.md
--
-- Memo flottanti per operatori interni dello studio (stile Apple
-- Stickies / iOS Notes flottanti). Ogni utente interno (admin /
-- direzione / responsabile / operatore / capoufficio) puo' creare
-- piccoli "post-it" colorati, draggabili, persistenti per-utente.
-- Il toggle attiva/disattiva vive in user_preferenze (chiave
-- memo_attivi), gia' esistente: nessuna colonna nuova qui.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_memo (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    testo       TEXT NULL,
    colore      ENUM('giallo','rosa','verde','blu','viola','arancio')
                NOT NULL DEFAULT 'giallo',
    dimensione  ENUM('s','m','l') NOT NULL DEFAULT 'm',
    posizione_x INT NOT NULL DEFAULT 100,
    posizione_y INT NOT NULL DEFAULT 100,
    z_order     INT NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_memo_user (user_id, z_order DESC),
    CONSTRAINT fk_memo_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
