-- CreateEnum
CREATE TYPE "TipoCliente" AS ENUM ('azienda', 'persona_fisica');

-- CreateTable
CREATE TABLE "aziende" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "codice" VARCHAR(20) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo_cliente" "TipoCliente" NOT NULL DEFAULT 'azienda',
    "partita_iva" VARCHAR(20),
    "codice_fiscale" VARCHAR(20),
    "codice_ateco" VARCHAR(20),
    "email" VARCHAR(255),
    "email_operativa" VARCHAR(255),
    "pec" VARCHAR(255),
    "sito_web" VARCHAR(255),
    "telefono" VARCHAR(40),
    "telefono_2" VARCHAR(40),
    "indirizzo" VARCHAR(255),
    "note_operative" TEXT,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aziende_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aziende_tenant_id_idx" ON "aziende"("tenant_id");

-- CreateIndex
CREATE INDEX "aziende_tenant_id_nome_idx" ON "aziende"("tenant_id", "nome");

-- AddForeignKey
ALTER TABLE "aziende" ADD CONSTRAINT "aziende_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation (forma identica ad add_menu_models_f1_schema, ADR-0009)
-- =============================================================================
--   - USING only (no WITH CHECK: Postgres riusa USING come default per INSERT)
--   - FORCE ROW LEVEL SECURITY (table owner postgres altrimenti bypassa)
--   - Naming: <table>_tenant_isolation
-- Settings letti per-operation tx dall'extension RLS (packages/db/src/rls.ts):
-- app.is_super_admin ('true'|'false'), app.tenant_id (TEXT). No ::uuid cast
-- (tenant_id e' TEXT). GRANT DML su gestionale_app: ereditato da ALTER DEFAULT
-- PRIVILEGES FOR ROLE postgres (migration create_app_role_and_grants) → no GRANT esplicito.
ALTER TABLE "aziende" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aziende" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "aziende_tenant_isolation" ON "aziende"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- =============================================================================
-- Partial-unique-index soft-delete-aware (Pattern 42, TD-BZ / ADR-0023)
-- =============================================================================
-- Unicita' naturale `codice` per-tenant SOLO sulle righe attive: combacia col
-- pre-check applicativo (softDeleteExtension filtra deleted_at IS NULL) e
-- consente il riuso del codice di un'azienda soft-deleted. Prisma 6 non esprime
-- i partial index nel DSL → niente @@unique nello schema.
CREATE UNIQUE INDEX "aziende_tenant_codice_active_uq"
  ON "aziende" ("tenant_id", "codice") WHERE "deleted_at" IS NULL;
