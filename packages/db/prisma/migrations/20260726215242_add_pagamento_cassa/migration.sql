-- CreateEnum
CREATE TYPE "metodo_pagamento_conto" AS ENUM ('contanti', 'carta', 'altro');

-- AlterTable
ALTER TABLE "conti" ADD COLUMN     "riepilogo_iva_snapshot" JSONB;

-- CreateTable
CREATE TABLE "pagamenti" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conto_id" TEXT NOT NULL,
    "metodo" "metodo_pagamento_conto" NOT NULL,
    "importo" DECIMAL(10,2) NOT NULL,
    "stornato" BOOLEAN NOT NULL DEFAULT false,
    "stornato_il" TIMESTAMP(3),
    "operatore_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagamenti_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pagamenti_tenant_id_idx" ON "pagamenti"("tenant_id");

-- CreateIndex
CREATE INDEX "pagamenti_conto_id_idx" ON "pagamenti"("conto_id");

-- AddForeignKey
ALTER TABLE "pagamenti" ADD CONSTRAINT "pagamenti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamenti" ADD CONSTRAINT "pagamenti_conto_id_fkey" FOREIGN KEY ("conto_id") REFERENCES "conti"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS policy — Pagamento (Cassa pre-fiscale, ADR-0081)
-- =============================================================================
-- Nuova tabella tenant-scoped → policy replicata 1:1 dal pattern
-- conti/conti_righe (migration 20260701192125) e comande (20260702190558):
-- super-admin bypass OR tenant_id match, USING only, FORCE ROW LEVEL SECURITY
-- (il table owner postgres altrimenti bypassa), naming <table>_tenant_isolation.
-- Settings app.tenant_id / app.is_super_admin settati per-operation dall'extension
-- RLS (packages/db/src/rls.ts).
--
-- `conti` ha già RLS FORCE (migration 20260701192125): l'ADD COLUMN
-- riepilogo_iva_snapshot NON la altera. La sola tabella nuova da proteggere qui
-- è `pagamenti`.
--
-- Nessun GRANT esplicito: ALTER DEFAULT PRIVILEGES FOR ROLE postgres
-- (migration 20260513002159) propaga SELECT/INSERT/UPDATE/DELETE a
-- gestionale_app su ogni tabella futura creata da postgres.
--
-- Nessun backfill: `riepilogo_iva_snapshot` è nullable e NULL è il valore
-- semanticamente corretto per i conti pre-migration (riepilogo mai congelato) —
-- nessuna data-migration cross-tenant, quindi nessuna dipendenza da DIRECT_URL
-- superuser (caveat ADR-0070 D3 non applicabile qui).
-- -----------------------------------------------------------------------------
ALTER TABLE "pagamenti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pagamenti" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "pagamenti_tenant_isolation" ON "pagamenti"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
