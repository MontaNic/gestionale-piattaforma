-- CreateEnum
CREATE TYPE "StatoPreventivo" AS ENUM ('bozza', 'inviato', 'accettato', 'rifiutato');

-- CreateEnum
CREATE TYPE "UnitaMisura" AS ENUM ('forfait', 'ora', 'mese', 'anno', 'documento', 'dipendente', 'pezzo');

-- CreateTable
CREATE TABLE "preventivi" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "azienda_id" TEXT NOT NULL,
    "codice" VARCHAR(32) NOT NULL,
    "oggetto" VARCHAR(200) NOT NULL,
    "cover_letter" TEXT,
    "note_interne" TEXT,
    "stato" "StatoPreventivo" NOT NULL DEFAULT 'bozza',
    "valido_fino" DATE,
    "totale_imponibile" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totale_iva" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totale" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preventivi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preventivi_voci" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "preventivo_id" TEXT NOT NULL,
    "nome" VARCHAR(180) NOT NULL,
    "descrizione" TEXT,
    "unita_misura" "UnitaMisura" NOT NULL DEFAULT 'forfait',
    "quantita" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "prezzo_unitario" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sconto_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "iva_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 22,
    "totale_riga" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(255),

    CONSTRAINT "preventivi_voci_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "preventivi_tenant_id_idx" ON "preventivi"("tenant_id");

-- CreateIndex
CREATE INDEX "preventivi_azienda_id_idx" ON "preventivi"("azienda_id");

-- CreateIndex
CREATE INDEX "preventivi_tenant_id_stato_idx" ON "preventivi"("tenant_id", "stato");

-- CreateIndex
CREATE INDEX "preventivi_voci_tenant_id_idx" ON "preventivi_voci"("tenant_id");

-- CreateIndex
CREATE INDEX "preventivi_voci_preventivo_id_ordine_idx" ON "preventivi_voci"("preventivo_id", "ordine");

-- AddForeignKey
ALTER TABLE "preventivi" ADD CONSTRAINT "preventivi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventivi" ADD CONSTRAINT "preventivi_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventivi_voci" ADD CONSTRAINT "preventivi_voci_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventivi_voci" ADD CONSTRAINT "preventivi_voci_preventivo_id_fkey" FOREIGN KEY ("preventivo_id") REFERENCES "preventivi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation su entrambe le tabelle (ADR-0009/0031)
-- =============================================================================
ALTER TABLE "preventivi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preventivi" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "preventivi_tenant_isolation" ON "preventivi"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

ALTER TABLE "preventivi_voci" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preventivi_voci" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "preventivi_voci_tenant_isolation" ON "preventivi_voci"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- =============================================================================
-- Partial-unique-index soft-delete-aware (Pattern 42, ADR-0023): codice
-- per-tenant unico SOLO sulle righe attive.
-- =============================================================================
CREATE UNIQUE INDEX "preventivi_tenant_codice_active_uq"
  ON "preventivi" ("tenant_id", "codice") WHERE "deleted_at" IS NULL;
