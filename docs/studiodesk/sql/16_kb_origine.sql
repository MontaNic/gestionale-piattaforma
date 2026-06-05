-- ============================================================
-- 16_kb_origine.sql
-- Aggiunge tracciamento dell'origine alle voci KB.
-- NULL  = creata manualmente (default per voci pre-esistenti)
-- 'ai_da_domanda' = trasformata da ai_domande_non_risolte
-- 'ai_genera'     = generata da "Genera con AI" (tema)
-- 'ai_assist'     = creata con "Aiutami con AI" sul modalCrea
-- ============================================================

ALTER TABLE knowledge_base
    ADD COLUMN IF NOT EXISTS origine VARCHAR(30) NULL DEFAULT NULL
        COMMENT 'manuale (NULL) | ai_da_domanda | ai_genera | ai_assist'
        AFTER attivo;

ALTER TABLE knowledge_base
    ADD INDEX IF NOT EXISTS idx_kb_origine (origine);

-- Aggiunge il campo anche al template per i nuovi tenant
-- (vedi migrations/01_studio_template.sql per la versione canonica)
