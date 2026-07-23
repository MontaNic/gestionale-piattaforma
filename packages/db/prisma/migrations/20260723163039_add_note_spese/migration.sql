-- CreateEnum
CREATE TYPE "stato_nota_spesa" AS ENUM ('bozza', 'inviata', 'approvata', 'respinta');

-- CreateEnum
CREATE TYPE "metodo_pagamento_nota_spesa" AS ENUM ('contanti', 'carta_aziendale', 'carta_personale', 'bonifico');

-- CreateEnum
CREATE TYPE "tipo_spesa" AS ENUM ('vitto', 'alloggio', 'trasporto', 'carburante', 'pedaggio', 'parcheggio', 'rappresentanza', 'formazione', 'cancelleria', 'altro');

-- CreateEnum
CREATE TYPE "aliquota_iva_nota_spesa" AS ENUM ('iva_22', 'iva_10', 'iva_4', 'esente', 'non_applicabile');

-- CreateEnum
CREATE TYPE "deducibilita_fiscale" AS ENUM ('d_100', 'd_75', 'd_50', 'd_0');

-- CreateEnum
CREATE TYPE "tipo_allegato_nota_spesa" AS ENUM ('giustificativo', 'scontrino_pos');

-- CreateTable
CREATE TABLE "note_spese" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "azienda_id" TEXT,
    "mandato_id" TEXT,
    "tipo_spesa" "tipo_spesa" NOT NULL,
    "metodo_pagamento" "metodo_pagamento_nota_spesa" NOT NULL,
    "totale" DECIMAL(10,2) NOT NULL,
    "aliquota_iva" "aliquota_iva_nota_spesa" NOT NULL,
    "deducibilita_fiscale" "deducibilita_fiscale" NOT NULL,
    "fatturata_a_societa" BOOLEAN NOT NULL DEFAULT false,
    "distanza_km" DECIMAL(8,2),
    "scopo_missione" TEXT NOT NULL,
    "note" TEXT,
    "stato" "stato_nota_spesa" NOT NULL DEFAULT 'bozza',
    "inviata_at" TIMESTAMP(3),
    "decisa_at" TIMESTAMP(3),
    "decisa_da_id" TEXT,
    "motivo_rifiuto" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_spese_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_spese_allegati" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nota_spesa_id" TEXT NOT NULL,
    "tipo" "tipo_allegato_nota_spesa" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "nome_originale" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "dimensione" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_spese_allegati_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_spese_tenant_id_user_id_data_idx" ON "note_spese"("tenant_id", "user_id", "data");

-- CreateIndex
CREATE INDEX "note_spese_tenant_id_stato_idx" ON "note_spese"("tenant_id", "stato");

-- CreateIndex
CREATE INDEX "note_spese_allegati_tenant_id_idx" ON "note_spese_allegati"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_spese_allegati_nota_spesa_id_tipo_key" ON "note_spese_allegati"("nota_spesa_id", "tipo");

-- AddForeignKey
ALTER TABLE "note_spese" ADD CONSTRAINT "note_spese_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_spese" ADD CONSTRAINT "note_spese_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_spese" ADD CONSTRAINT "note_spese_decisa_da_id_fkey" FOREIGN KEY ("decisa_da_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_spese" ADD CONSTRAINT "note_spese_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_spese" ADD CONSTRAINT "note_spese_mandato_id_fkey" FOREIGN KEY ("mandato_id") REFERENCES "mandati"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_spese_allegati" ADD CONSTRAINT "note_spese_allegati_nota_spesa_id_fkey" FOREIGN KEY ("nota_spesa_id") REFERENCES "note_spese"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS — Note Spese (pattern corrente, ADR-0009). Prisma non genera le policy:
-- aggiunte a mano come per tutte le tabelle multi-tenant.
--   - super-admin bypass OR tenant_id match (text-to-text, nessun cast ::uuid)
--   - USING only (Postgres riusa USING come default per INSERT/WITH CHECK)
--   - FORCE ROW LEVEL SECURITY (il table owner `postgres` altrimenti bypassa)
-- Settings letti: app.tenant_id (TEXT), app.is_super_admin ('true'|'false').
-- Nessun GRANT esplicito: ALTER DEFAULT PRIVILEGES FOR ROLE postgres (migration
-- create_app_role_and_grants) copre le tabelle nuove → gestionale_app eredita
-- SELECT/INSERT/UPDATE/DELETE. tenant_id denormalizzato sull'allegato: l'RLS è
-- per-tabella, non segue la FK verso note_spese.
-- =============================================================================
ALTER TABLE "note_spese" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note_spese" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "note_spese_tenant_isolation" ON "note_spese"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

ALTER TABLE "note_spese_allegati" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note_spese_allegati" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "note_spese_allegati_tenant_isolation" ON "note_spese_allegati"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
