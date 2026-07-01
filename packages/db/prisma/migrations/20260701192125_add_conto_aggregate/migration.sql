-- CreateEnum
CREATE TYPE "stato_conto" AS ENUM ('aperto', 'chiuso', 'annullato');

-- CreateTable
CREATE TABLE "conti" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tavolo_id" TEXT,
    "channel" "channel" NOT NULL,
    "coperti" INTEGER,
    "stato" "stato_conto" NOT NULL DEFAULT 'aperto',
    "aperto_il" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chiuso_il" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "conti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conti_righe" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conto_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "nome_articolo" TEXT NOT NULL,
    "prezzo_unitario" DECIMAL(10,2) NOT NULL,
    "quantita" INTEGER NOT NULL,
    "reparto" "print_department" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "conti_righe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conti_tenant_id_idx" ON "conti"("tenant_id");

-- CreateIndex
CREATE INDEX "conti_tavolo_id_idx" ON "conti"("tavolo_id");

-- CreateIndex
CREATE INDEX "conti_righe_tenant_id_idx" ON "conti_righe"("tenant_id");

-- CreateIndex
CREATE INDEX "conti_righe_conto_id_idx" ON "conti_righe"("conto_id");

-- CreateIndex
CREATE INDEX "conti_righe_article_id_idx" ON "conti_righe"("article_id");

-- AddForeignKey
ALTER TABLE "conti" ADD CONSTRAINT "conti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conti" ADD CONSTRAINT "conti_tavolo_id_fkey" FOREIGN KEY ("tavolo_id") REFERENCES "tavoli"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conti_righe" ADD CONSTRAINT "conti_righe_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conti_righe" ADD CONSTRAINT "conti_righe_conto_id_fkey" FOREIGN KEY ("conto_id") REFERENCES "conti"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conti_righe" ADD CONSTRAINT "conti_righe_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- RLS policy — aggregato Conto (PR-1 blocco COMANDE, ADR-0067)
-- =============================================================================
-- Pattern replicato 1:1 dalle policy tavoli (20260630120000) / menu (20260520000939):
--   - super-admin bypass OR tenant_id match (text-to-text, no ::uuid cast)
--   - USING only (no WITH CHECK: Postgres riusa USING come default per INSERT)
--   - FORCE ROW LEVEL SECURITY (il table owner postgres altrimenti bypassa)
--   - Naming: <table>_tenant_isolation
--
-- Settings letti: app.tenant_id (TEXT), app.is_super_admin ('true'|'false'),
-- settati per-operation tx dall'extension RLS (packages/db/src/rls.ts).
-- Vincolo architetturale STOP 1: FORCE su ENTRAMBI i model (testata + riga).
-- -----------------------------------------------------------------------------
ALTER TABLE "conti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conti" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "conti_tenant_isolation" ON "conti"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

ALTER TABLE "conti_righe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conti_righe" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "conti_righe_tenant_isolation" ON "conti_righe"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
