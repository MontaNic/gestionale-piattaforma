-- CreateEnum
CREATE TYPE "circolare_stato" AS ENUM ('bozza', 'pubblicata', 'archiviata');

-- CreateEnum
CREATE TYPE "destinatario_tipo" AS ENUM ('tutti', 'azienda', 'utente');

-- CreateTable
CREATE TABLE "circolari" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "titolo" VARCHAR(200) NOT NULL,
    "oggetto_email" VARCHAR(200) NOT NULL,
    "body_html" TEXT NOT NULL,
    "stato" "circolare_stato" NOT NULL DEFAULT 'bozza',
    "priorita" INTEGER NOT NULL DEFAULT 0,
    "pubblicata_il" TIMESTAMP(3),
    "scade_il" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "circolari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circolari_destinatari" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "circolare_id" TEXT NOT NULL,
    "tipo" "destinatario_tipo" NOT NULL,
    "azienda_id" TEXT,

    CONSTRAINT "circolari_destinatari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "circolari_tenant_id_idx" ON "circolari"("tenant_id");

-- CreateIndex
CREATE INDEX "circolari_tenant_id_stato_deleted_at_idx" ON "circolari"("tenant_id", "stato", "deleted_at");

-- CreateIndex
CREATE INDEX "circolari_destinatari_tenant_id_idx" ON "circolari_destinatari"("tenant_id");

-- CreateIndex
CREATE INDEX "circolari_destinatari_circolare_id_idx" ON "circolari_destinatari"("circolare_id");

-- CreateIndex
CREATE INDEX "circolari_destinatari_tenant_id_azienda_id_idx" ON "circolari_destinatari"("tenant_id", "azienda_id");

-- AddForeignKey
ALTER TABLE "circolari" ADD CONSTRAINT "circolari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circolari_destinatari" ADD CONSTRAINT "circolari_destinatari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circolari_destinatari" ADD CONSTRAINT "circolari_destinatari_circolare_id_fkey" FOREIGN KEY ("circolare_id") REFERENCES "circolari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circolari_destinatari" ADD CONSTRAINT "circolari_destinatari_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation (forma reale repo, ADR-0009 / ADR-0043 DP-N2): USING-only
-- + FORCE, tenant_id TEXT, no cast. Entrambe le tabelle hanno tenant_id diretto
-- (destinatari denormalizzato) → policy FLAT, niente subquery risalente al parent.
-- =============================================================================
ALTER TABLE "circolari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "circolari" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "circolari_tenant_isolation" ON "circolari"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

ALTER TABLE "circolari_destinatari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "circolari_destinatari" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "circolari_destinatari_tenant_isolation" ON "circolari_destinatari"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
