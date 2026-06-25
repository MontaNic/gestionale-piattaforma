-- CreateEnum
CREATE TYPE "TipoRicorrenza" AS ENUM ('una_tantum', 'mensile', 'annuale');

-- AlterTable
ALTER TABLE "preventivi_voci" ADD COLUMN     "servizio_id" TEXT;

-- CreateTable
CREATE TABLE "servizi_categorie" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "nome" TEXT NOT NULL,
    "descrizione" TEXT,
    "colore" TEXT NOT NULL DEFAULT '#6366f1',
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servizi_categorie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servizi_catalogo" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "codice" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descrizione" TEXT,
    "categoria_id" TEXT,
    "unita_misura" "UnitaMisura" NOT NULL DEFAULT 'forfait',
    "prezzo_base" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "iva_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 22,
    "tipo_ricorrenza" "TipoRicorrenza" NOT NULL DEFAULT 'una_tantum',
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servizi_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "servizi_categorie_tenant_id_idx" ON "servizi_categorie"("tenant_id");

-- CreateIndex
CREATE INDEX "servizi_catalogo_tenant_id_idx" ON "servizi_catalogo"("tenant_id");

-- CreateIndex
CREATE INDEX "servizi_catalogo_categoria_id_idx" ON "servizi_catalogo"("categoria_id");

-- AddForeignKey
ALTER TABLE "preventivi_voci" ADD CONSTRAINT "preventivi_voci_servizio_id_fkey" FOREIGN KEY ("servizio_id") REFERENCES "servizi_catalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servizi_catalogo" ADD CONSTRAINT "servizi_catalogo_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "servizi_categorie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique indexes (Prisma 6 non li esprime in schema): unicità PER-TENANT
-- solo sulle righe custom. Le righe piattaforma (tenant_id NULL) NON sono
-- vincolate fra loro — design intenzionale (pattern scadenze_categorie/documenti_tipi).
CREATE UNIQUE INDEX "servizi_categorie_tenant_nome_unique"
  ON "servizi_categorie" ("tenant_id", "nome")
  WHERE "tenant_id" IS NOT NULL;

CREATE UNIQUE INDEX "servizi_catalogo_tenant_codice_unique"
  ON "servizi_catalogo" ("tenant_id", "codice")
  WHERE "tenant_id" IS NOT NULL;

-- Nessuna RLS su questi due modelli (scoping applicativo nel service, pattern
-- ScadenzaCategoria): le righe piattaforma tenant_id NULL sarebbero incompatibili
-- con una policy tenant_isolation. Vedi ADR-0050.
