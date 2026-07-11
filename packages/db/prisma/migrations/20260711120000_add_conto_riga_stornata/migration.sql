-- Storno di una riga INVIATA su ContoRiga (ADR-storno). Additiva pura: due colonne
-- con default/nullable su tabella esistente → nessun backfill (nessuna riga è
-- stornata), nessun NOT NULL posticipato.
--
-- Semantica DISTINTA da `deleted_at`:
--   - deleted_at != NULL → riga pending rimossa PRIMA dell'invio ("mai esistita
--     per la cucina").
--   - stornata = true → riga INVIATA poi revocata ("è esistita, la cucina l'ha
--     vista, è stata annullata"). Esclusa dal totale, ma resta visibile marcata.
-- Le due condizioni non si sovrappongono (stornata solo su righe con comanda_id).

-- AlterTable
ALTER TABLE "conti_righe" ADD COLUMN "stornata" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stornata_il" TIMESTAMP(3);
