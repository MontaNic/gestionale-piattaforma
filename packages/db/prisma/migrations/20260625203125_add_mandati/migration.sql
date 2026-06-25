-- CreateEnum
CREATE TYPE "StatoMandato" AS ENUM ('in_corso', 'sospeso', 'concluso', 'annullato');

-- AlterEnum
ALTER TYPE "StatoPreventivo" ADD VALUE 'convertito';

-- CreateTable
CREATE TABLE "mandati" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "preventivo_id" TEXT NOT NULL,
    "azienda_id" TEXT NOT NULL,
    "codice" VARCHAR(32) NOT NULL,
    "stato" "StatoMandato" NOT NULL DEFAULT 'in_corso',
    "inizio" DATE,
    "fine_prevista" DATE,
    "fine_effettiva" DATE,
    "note" TEXT,
    "importo_concordato" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandati_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rdl_counter" (
    "tenant_id" TEXT NOT NULL,
    "anno" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rdl_counter_pkey" PRIMARY KEY ("tenant_id","anno")
);

-- CreateIndex
CREATE INDEX "mandati_tenant_id_idx" ON "mandati"("tenant_id");

-- CreateIndex
CREATE INDEX "mandati_azienda_id_idx" ON "mandati"("azienda_id");

-- CreateIndex
CREATE INDEX "mandati_tenant_id_stato_idx" ON "mandati"("tenant_id", "stato");

-- AddForeignKey
ALTER TABLE "mandati" ADD CONSTRAINT "mandati_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandati" ADD CONSTRAINT "mandati_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandati" ADD CONSTRAINT "mandati_preventivo_id_fkey" FOREIGN KEY ("preventivo_id") REFERENCES "preventivi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rdl_counter" ADD CONSTRAINT "rdl_counter_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS FORCE (pattern Preventivo / ComCounter, ADR-0009): tenant_id denormalizzato
-- → policy flat USING. Settings letti per-operation dall'extension RLS
-- (app.is_super_admin, app.tenant_id).
-- =============================================================================
ALTER TABLE "mandati" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandati" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "mandati_tenant_isolation" ON "mandati"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

ALTER TABLE "rdl_counter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rdl_counter" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "rdl_counter_tenant_isolation" ON "rdl_counter"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- =============================================================================
-- Partial-unique-index soft-delete-aware (Pattern 42, ADR-0023): un preventivo
-- ha AL PIÙ un mandato ATTIVO (deleted_at IS NULL) → 1:1 robusto + riuso dopo
-- soft-delete. Prisma 6 non esprime i partial index → raw SQL.
-- =============================================================================
CREATE UNIQUE INDEX "mandati_preventivo_id_unique"
  ON "mandati" ("preventivo_id")
  WHERE "deleted_at" IS NULL;
