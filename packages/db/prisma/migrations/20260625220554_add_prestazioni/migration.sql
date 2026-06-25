-- CreateTable
CREATE TABLE "prestazioni" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "mandato_id" TEXT NOT NULL,
    "voce_id" TEXT,
    "user_id" TEXT,
    "data" DATE NOT NULL,
    "ore" DECIMAL(5,2) NOT NULL,
    "descrizione" VARCHAR(500) NOT NULL,
    "fatturabile" BOOLEAN NOT NULL DEFAULT true,
    "importo" DECIMAL(10,2),
    "note" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prestazioni_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prestazioni_tenant_id_idx" ON "prestazioni"("tenant_id");

-- CreateIndex
CREATE INDEX "prestazioni_mandato_id_data_idx" ON "prestazioni"("mandato_id", "data");

-- AddForeignKey
ALTER TABLE "prestazioni" ADD CONSTRAINT "prestazioni_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestazioni" ADD CONSTRAINT "prestazioni_mandato_id_fkey" FOREIGN KEY ("mandato_id") REFERENCES "mandati"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestazioni" ADD CONSTRAINT "prestazioni_voce_id_fkey" FOREIGN KEY ("voce_id") REFERENCES "preventivi_voci"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestazioni" ADD CONSTRAINT "prestazioni_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- RLS FORCE (pattern Mandato/Preventivo, ADR-0009): tenant_id denormalizzato →
-- policy flat USING. Settings letti per-operation dall'extension RLS
-- (app.is_super_admin, app.tenant_id).
-- =============================================================================
ALTER TABLE "prestazioni" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prestazioni" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "prestazioni_tenant_isolation" ON "prestazioni"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
