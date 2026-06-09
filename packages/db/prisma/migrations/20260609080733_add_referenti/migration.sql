-- CreateEnum
CREATE TYPE "RuoloReferente" AS ENUM ('legale_rappresentante', 'amministrativo', 'tecnico', 'altro');

-- CreateTable
CREATE TABLE "referenti" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "azienda_id" TEXT NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "ruolo" "RuoloReferente" NOT NULL DEFAULT 'altro',
    "email" VARCHAR(255),
    "telefono" VARCHAR(40),
    "note" VARCHAR(255),
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referenti_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referenti_tenant_id_idx" ON "referenti"("tenant_id");

-- CreateIndex
CREATE INDEX "referenti_azienda_id_idx" ON "referenti"("azienda_id");

-- AddForeignKey
ALTER TABLE "referenti" ADD CONSTRAINT "referenti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referenti" ADD CONSTRAINT "referenti_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation (forma identica ad add_aziende, ADR-0009/0031)
-- =============================================================================
--   - USING only (Postgres riusa USING come default per INSERT)
--   - FORCE ROW LEVEL SECURITY (table owner postgres altrimenti bypassa)
--   - GRANT DML su gestionale_app ereditato da ALTER DEFAULT PRIVILEGES → no GRANT esplicito
-- NB: nessun partial-unique — referenti non ha unicità naturale (DDL StudioDesk).
ALTER TABLE "referenti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referenti" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "referenti_tenant_isolation" ON "referenti"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
