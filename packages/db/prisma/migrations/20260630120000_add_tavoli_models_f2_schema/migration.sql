-- CreateTable
CREATE TABLE "tavoli" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "capienza" INTEGER NOT NULL,
    "pos_x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pos_y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tavoli_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tavoli_tenant_id_idx" ON "tavoli"("tenant_id");

-- CreateIndex — partial unique index soft-delete-aware (TD-BZ, ADR-0023).
-- Tabella greenfield: il partial unique nasce direttamente qui (niente full-index
-- da rimpiazzare, a differenza del retrofit menu in due migration). Forma copiata
-- da td_bz_partial_unique_soft_delete. Prisma 6 non esprime i partial index nel
-- DSL → nessun @@unique nello schema; il riuso del `numero` di un tavolo
-- soft-deleted resta legale, la duplicazione tra tavoli ATTIVI è bloccata.
CREATE UNIQUE INDEX "tavoli_tenant_numero_active_uq"
  ON "tavoli" ("tenant_id", "numero")
  WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "tavoli" ADD CONSTRAINT "tavoli_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS policy F2 Tavoli (ADR-0058)
-- =============================================================================
-- Pattern replicato 1:1 dalle policy menu (migration 20260520000939):
--   - super-admin bypass OR tenant_id match (text-to-text, no ::uuid cast)
--   - USING only (no WITH CHECK: Postgres riusa USING come default per INSERT)
--   - FORCE ROW LEVEL SECURITY (table owner postgres altrimenti bypassa)
--   - Naming: <table>_tenant_isolation
--
-- Settings letti: app.tenant_id (TEXT), app.is_super_admin ('true'|'false'),
-- settati per-operation tx dall'extension RLS (packages/db/src/rls.ts).
-- -----------------------------------------------------------------------------
ALTER TABLE "tavoli" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tavoli" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "tavoli_tenant_isolation" ON "tavoli"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
