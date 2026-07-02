-- CreateEnum
CREATE TYPE "stato_comanda" AS ENUM ('inviata', 'in_preparazione', 'pronta');

-- AlterTable
ALTER TABLE "conti_righe" ADD COLUMN     "comanda_id" TEXT,
ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "comande" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conto_id" TEXT NOT NULL,
    "reparto" "print_department" NOT NULL,
    "stato" "stato_comanda" NOT NULL DEFAULT 'inviata',
    "inviata_il" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "in_preparazione_il" TIMESTAMP(3),
    "pronta_il" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "comande_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comande_tenant_id_idx" ON "comande"("tenant_id");

-- CreateIndex
CREATE INDEX "comande_conto_id_idx" ON "comande"("conto_id");

-- CreateIndex
CREATE INDEX "comande_tenant_id_stato_reparto_idx" ON "comande"("tenant_id", "stato", "reparto");

-- CreateIndex
CREATE INDEX "conti_righe_comanda_id_idx" ON "conti_righe"("comanda_id");

-- AddForeignKey
ALTER TABLE "conti_righe" ADD CONSTRAINT "conti_righe_comanda_id_fkey" FOREIGN KEY ("comanda_id") REFERENCES "comande"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comande" ADD CONSTRAINT "comande_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comande" ADD CONSTRAINT "comande_conto_id_fkey" FOREIGN KEY ("conto_id") REFERENCES "conti"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS policy — Comanda (KDS, ADR-attivazione-layer-comanda)
-- =============================================================================
-- Nuova tabella tenant-scoped → policy replicata 1:1 dal pattern conti/conti_righe
-- (migration 20260701192125): super-admin bypass OR tenant_id match, USING only,
-- FORCE ROW LEVEL SECURITY (il table owner postgres altrimenti bypassa), naming
-- <table>_tenant_isolation. Settings app.tenant_id / app.is_super_admin settati
-- per-operation dall'extension RLS (packages/db/src/rls.ts).
-- `conti_righe` ha già RLS FORCE (migration #151): l'ADD COLUMN comanda_id/note
-- NON la altera. La sola tabella nuova da proteggere qui è `comande`.
-- -----------------------------------------------------------------------------
ALTER TABLE "comande" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comande" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "comande_tenant_isolation" ON "comande"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
