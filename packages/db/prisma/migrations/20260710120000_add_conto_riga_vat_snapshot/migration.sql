-- Snapshot dell'aliquota IVA sulla riga conto (ADR-0070). Prezzi LORDI (IVA
-- inclusa): il totale è Σ prezzo×qta, nessuna IVA aggiunta. `vat_percent` è
-- memorizzato per lo scorporo differito alla cassa e va CONGELATO al momento
-- dell'ordine (come nome/prezzo/reparto): cambiare l'IVA di un articolo NON deve
-- alterare lo scorporo dei conti già chiusi.
--
-- 3 step (colonna NOT NULL su tabella non vuota → non auto-generabile):
--   1. colonna nullable
--   2. backfill dall'aliquota CORRENTE dell'articolo. `article_id` è FK required
--      → sempre risolvibile, nessun orfano. Nessun filtro deleted_at: il vincolo
--      NOT NULL vale anche per le righe soft-deleted. LIMITE (ADR-0070): l'aliquota
--      vigente all'ordine non è ricostruibile (mai salvata) → best-effort sulle
--      righe pre-migration; snapshot vero dal deploy in poi.
--   3. NOT NULL dopo il backfill.

-- AlterTable: colonna nullable
ALTER TABLE "conti_righe" ADD COLUMN "vat_percent" INTEGER;

-- Backfill: aliquota corrente dell'articolo (tutte le righe, incl. soft-deleted)
UPDATE "conti_righe" cr
SET "vat_percent" = a."vat_percent"
FROM "articles" a
WHERE cr."article_id" = a."id";

-- NOT NULL dopo il backfill
ALTER TABLE "conti_righe" ALTER COLUMN "vat_percent" SET NOT NULL;
