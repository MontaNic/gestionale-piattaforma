-- AlterTable
ALTER TABLE "circolari" ADD COLUMN     "richiede_conferma" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "circolari_letture" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "circolare_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "letta_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confermata_at" TIMESTAMP(3),

    CONSTRAINT "circolari_letture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "circolari_letture_tenant_id_idx" ON "circolari_letture"("tenant_id");

-- CreateIndex
CREATE INDEX "circolari_letture_user_id_idx" ON "circolari_letture"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "circolari_letture_circolare_id_user_id_key" ON "circolari_letture"("circolare_id", "user_id");

-- AddForeignKey
ALTER TABLE "circolari_letture" ADD CONSTRAINT "circolari_letture_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circolari_letture" ADD CONSTRAINT "circolari_letture_circolare_id_fkey" FOREIGN KEY ("circolare_id") REFERENCES "circolari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circolari_letture" ADD CONSTRAINT "circolari_letture_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation (forma reale repo, ADR-0009 / ADR-0043 DP-N2): USING-only
-- + FORCE, tenant_id TEXT, no cast. `circolari_letture` ha tenant_id diretto
-- (denormalizzato) → policy FLAT, identica a circolari/circolari_destinatari
-- (ADR-0048, livello 2 portale cliente).
-- =============================================================================
ALTER TABLE "circolari_letture" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "circolari_letture" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "circolari_letture_tenant_isolation" ON "circolari_letture"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
