-- CreateEnum
CREATE TYPE "user_tipo" AS ENUM ('operatore', 'cliente');

-- CreateEnum
CREATE TYPE "cliente_ruolo" AS ENUM ('admin', 'utente');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "azienda_id" TEXT,
ADD COLUMN     "cliente_ruolo" "cliente_ruolo",
ADD COLUMN     "tipo" "user_tipo" NOT NULL DEFAULT 'operatore';

-- CreateIndex
CREATE INDEX "users_azienda_id_idx" ON "users"("azienda_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Invariante identità (ADR-0046 §2 DP-invariante), appeso a mano come le policy
-- RLS di add_comunicazioni/add_documenti/add_circolari. Garantisce a livello DB:
--   operatore ⇒ azienda_id NULL   (un operatore non appartiene a un'azienda)
--   cliente   ⇒ azienda_id NOT NULL (un cliente è sempre legato a un'azienda)
-- Defense-in-depth: nessun path applicativo può creare un cliente orfano o un
-- operatore agganciato a un'azienda. Backfill implicito sicuro: le righe
-- esistenti hanno tipo='operatore' (DEFAULT) + azienda_id NULL → CHECK soddisfatto.
-- =============================================================================
ALTER TABLE "users" ADD CONSTRAINT "chk_cliente_azienda_id"
  CHECK (
    (tipo = 'operatore' AND azienda_id IS NULL) OR
    (tipo = 'cliente'   AND azienda_id IS NOT NULL)
  );
