-- Portata/corso di servizio (ADR-portata): attributo di RAGGRUPPAMENTO su Article,
-- snapshottato su ContoRiga (pattern reparto/vat_percent). NON è sequenziamento
-- dell'uscita (fuori scope, trigger board KDS live).
--
-- Additiva pura: nuovo enum + due colonne NOT NULL DEFAULT 'nessuna' su tabelle
-- esistenti → NESSUN backfill (come `stornata`, non come `vat_percent`). Il default
-- copre articoli e righe pre-migration; l'immagine BE vecchia gira sopra la colonna
-- (non la scrive, il default la riempie) → rollback = tag-swap, DB intatto.
--
-- Ordine di dichiarazione dell'enum = ordine di servizio (Postgres ordina per
-- posizione): `bevanda` in coda come portata vera, `nessuna` ultima come fallback
-- del non-classificato. Predisposto per l'ordinamento del consumer (board/vista
-- conto), NON esercitato da questa migration.

-- CreateEnum
CREATE TYPE "portata" AS ENUM ('antipasto', 'primo', 'secondo', 'contorno', 'dolce', 'bevanda', 'nessuna');

-- AlterTable: Article
ALTER TABLE "articles" ADD COLUMN "portata" "portata" NOT NULL DEFAULT 'nessuna';

-- AlterTable: ContoRiga (snapshot)
ALTER TABLE "conti_righe" ADD COLUMN "portata" "portata" NOT NULL DEFAULT 'nessuna';
