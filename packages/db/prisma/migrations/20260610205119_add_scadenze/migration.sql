-- CreateEnum
CREATE TYPE "visibilita_scadenza" AS ENUM ('tutti', 'azienda', 'utente');

-- CreateTable
CREATE TABLE "scadenze_categorie" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "nome" VARCHAR(100) NOT NULL,
    "colore" VARCHAR(7) NOT NULL DEFAULT '#3b82f6',
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "attivo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "scadenze_categorie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scadenze" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "titolo" VARCHAR(255) NOT NULL,
    "descrizione" TEXT,
    "data_scadenza" DATE NOT NULL,
    "categoria_id" TEXT,
    "visibilita" "visibilita_scadenza" NOT NULL DEFAULT 'tutti',
    "azienda_id" TEXT,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "codice_import" VARCHAR(80),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scadenze_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scadenze_categorie_tenant_id_idx" ON "scadenze_categorie"("tenant_id");

-- CreateIndex
CREATE INDEX "scadenze_tenant_id_idx" ON "scadenze"("tenant_id");

-- CreateIndex
CREATE INDEX "scadenze_tenant_id_data_scadenza_idx" ON "scadenze"("tenant_id", "data_scadenza");

-- CreateIndex
CREATE INDEX "scadenze_azienda_id_idx" ON "scadenze"("azienda_id");

-- CreateIndex
CREATE INDEX "scadenze_categoria_id_idx" ON "scadenze"("categoria_id");

-- AddForeignKey
ALTER TABLE "scadenze_categorie" ADD CONSTRAINT "scadenze_categorie_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scadenze" ADD CONSTRAINT "scadenze_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scadenze" ADD CONSTRAINT "scadenze_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "scadenze_categorie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scadenze" ADD CONSTRAINT "scadenze_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation su `scadenze` (forma identica ad add_aziende/add_preventivi,
-- ADR-0009/0031). NB: `scadenze_categorie` NON ha RLS — le righe piattaforma sono
-- tenant_id NULL e una policy per-tenant ne romperebbe la lettura globale. Le
-- categorie custom (tenant_id non-NULL) sono protette applicativamente nel service.
-- =============================================================================
--   - USING only (no WITH CHECK: Postgres riusa USING come default per INSERT)
--   - FORCE ROW LEVEL SECURITY (table owner postgres altrimenti bypassa)
--   - Naming: <table>_tenant_isolation
-- Settings letti per-operation tx dall'extension RLS (packages/db/src/rls.ts):
-- app.is_super_admin ('true'|'false'), app.tenant_id (TEXT). No ::uuid cast.
ALTER TABLE "scadenze" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scadenze" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "scadenze_tenant_isolation" ON "scadenze"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- =============================================================================
-- Partial-unique-index su `scadenze_categorie`: nome unico PER-TENANT solo sulle
-- righe custom (WHERE tenant_id IS NOT NULL). Le righe piattaforma (tenant_id
-- NULL) NON hanno vincolo di unicita' tra loro — design intenzionale (pattern
-- documenti_tipi legacy). Prisma 6 non esprime i partial index nel DSL.
-- =============================================================================
CREATE UNIQUE INDEX "scadenze_categorie_tenant_nome_uq"
  ON "scadenze_categorie" ("tenant_id", "nome") WHERE "tenant_id" IS NOT NULL;

-- =============================================================================
-- Partial-unique-index soft-delete-aware (Pattern 42, ADR-0023) su `scadenze`:
-- codice_import per-tenant unico SOLO sulle righe attive (predisposto import
-- esterni). I codice_import NULL multipli sono ammessi (NULL distinto in unique).
-- =============================================================================
CREATE UNIQUE INDEX "scadenze_tenant_codice_import_active_uq"
  ON "scadenze" ("tenant_id", "codice_import") WHERE "deleted_at" IS NULL;
