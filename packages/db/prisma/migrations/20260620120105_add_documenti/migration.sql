-- CreateEnum
CREATE TYPE "direzione_documento" AS ENUM ('studio_cliente', 'cliente_studio', 'bidirezionale');

-- CreateEnum
CREATE TYPE "visibilita_documento" AS ENUM ('tutti', 'azienda');

-- CreateTable
CREATE TABLE "documenti_tipi" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "nome" VARCHAR(100) NOT NULL,
    "direzione" "direzione_documento" NOT NULL,
    "visibilita_default" "visibilita_documento" NOT NULL DEFAULT 'tutti',
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "attivo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "documenti_tipi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documenti" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tipo_id" TEXT NOT NULL,
    "azienda_id" TEXT NOT NULL,
    "nome_originale" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
    "dimensione" INTEGER NOT NULL DEFAULT 0,
    "visibilita" "visibilita_documento" NOT NULL DEFAULT 'tutti',
    "note" TEXT,
    "created_by" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documenti_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documenti_tipi_tenant_id_idx" ON "documenti_tipi"("tenant_id");

-- CreateIndex
CREATE INDEX "documenti_tenant_id_idx" ON "documenti"("tenant_id");

-- CreateIndex
CREATE INDEX "documenti_tenant_id_azienda_id_deleted_at_idx" ON "documenti"("tenant_id", "azienda_id", "deleted_at");

-- CreateIndex
CREATE INDEX "documenti_tipo_id_idx" ON "documenti"("tipo_id");

-- AddForeignKey
ALTER TABLE "documenti_tipi" ADD CONSTRAINT "documenti_tipi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "documenti_tipi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation su `documenti` (forma reale repo, ADR-0009): USING-only +
-- FORCE, tenant_id TEXT, no cast. `documenti_tipi` NON ha RLS (le righe platform
-- hanno tenant_id NULL → una policy per-tenant ne romperebbe la lettura globale;
-- lo scoping è applicativo `tenantId IS NULL OR tenantId = current`, pattern
-- ScadenzaCategoria/ADR-0039).
-- =============================================================================
ALTER TABLE "documenti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documenti" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "documenti_tenant_isolation" ON "documenti"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- =============================================================================
-- Partial-unique soft-delete-aware (Pattern 42, ADR-0023) su `documenti_tipi`:
-- `nome` per-tenant unico SOLO sulle righe CUSTOM (tenant_id NOT NULL). Le righe
-- platform (tenant_id NULL) sono seedate idempotentemente find-then-create.
-- =============================================================================
CREATE UNIQUE INDEX "documenti_tipi_tenant_nome_uq"
  ON "documenti_tipi" ("tenant_id", "nome") WHERE "tenant_id" IS NOT NULL;
