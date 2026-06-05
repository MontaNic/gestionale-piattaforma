-- ============================================================
-- 13_search_indexes.sql
-- Indici e colonne per ricerca veloce/fuzzy su aziende e users.
-- Additiva e retrocompatibile: tutti i campi nuovi sono NULL,
-- il vecchio search LIKE continua a funzionare in parallelo.
--
-- Richiede MySQL 5.7+ per ngram + generated columns.
-- NON è idempotente: per applicare in modo idempotente su tenant
-- esistenti, usare il runner: bin/migrate-search-indexes.php
-- ============================================================

-- ── AZIENDE ─────────────────────────────────────────────────

-- Campi geografici e settoriali per filtri (popolabili gradualmente)
ALTER TABLE aziende
    ADD COLUMN citta      VARCHAR(80) NULL AFTER indirizzo,
    ADD COLUMN provincia  VARCHAR(2)  NULL AFTER citta,
    ADD COLUMN cap        VARCHAR(5)  NULL AFTER provincia,
    ADD COLUMN settore    VARCHAR(80) NULL AFTER codice_ateco;

-- Soundex per fuzzy fallback. Colonna virtuale STORED → indicizzabile.
-- "Roosi" e "Rossi" hanno lo stesso SOUNDEX → match anche con refuso.
ALTER TABLE aziende
    ADD COLUMN nome_soundex VARCHAR(32)
        GENERATED ALWAYS AS (SOUNDEX(nome)) STORED;

-- Indice FULLTEXT con parser ngram (token min 2 char globali).
-- Permette match parziali ("ros" trova "Rossi") senza wildcard a inizio.
ALTER TABLE aziende
    ADD FULLTEXT INDEX ft_search (nome, codice, partita_iva, codice_fiscale, email, citta)
    WITH PARSER ngram;

-- Indici su filtri composti più usati
ALTER TABLE aziende
    ADD INDEX idx_az_citta_attivo (citta, attivo, eliminato),
    ADD INDEX idx_az_tipo_attivo  (tipo_cliente, attivo, eliminato),
    ADD INDEX idx_az_settore      (settore),
    ADD INDEX idx_az_created      (created_at),
    ADD INDEX idx_az_soundex      (nome_soundex);


-- ── USERS ───────────────────────────────────────────────────

-- Soundex su "nome cognome" concatenati. NB: SOUNDEX in MySQL si
-- applica al primo token ASCII alfabetico — quindi è un soundex
-- del nome, non del cognome. È una limitazione voluta: il caso
-- d'uso primario è "ho sbagliato il nome", il cognome di norma
-- viene digitato meno.
ALTER TABLE users
    ADD COLUMN nome_soundex VARCHAR(32)
        GENERATED ALWAYS AS (SOUNDEX(CONCAT(nome,' ',COALESCE(cognome,'')))) STORED;

ALTER TABLE users
    ADD FULLTEXT INDEX ft_search (nome, cognome, email)
    WITH PARSER ngram;

ALTER TABLE users
    ADD INDEX idx_u_soundex (nome_soundex);
