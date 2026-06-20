-- CreateEnum
CREATE TYPE "com_apertura" AS ENUM ('studio', 'cliente');

-- CreateEnum
CREATE TYPE "com_lato" AS ENUM ('studio', 'cliente', 'interno');

-- CreateEnum
CREATE TYPE "com_origine" AS ENUM ('portale');

-- CreateTable
CREATE TABLE "comunicazioni" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "codice" VARCHAR(20) NOT NULL,
    "azienda_id" TEXT NOT NULL,
    "referente_id" TEXT,
    "aperta_da" "com_apertura" NOT NULL,
    "operatore_assegnato_id" TEXT,
    "oggetto" VARCHAR(255) NOT NULL,
    "urgente" BOOLEAN NOT NULL DEFAULT false,
    "chiusa" BOOLEAN NOT NULL DEFAULT false,
    "chiusa_il" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comunicazioni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_messaggi" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "comunicazione_id" TEXT NOT NULL,
    "autore_user_id" TEXT,
    "lato" "com_lato" NOT NULL,
    "origine" "com_origine" NOT NULL DEFAULT 'portale',
    "testo" TEXT NOT NULL,
    "letto_studio" BOOLEAN NOT NULL DEFAULT false,
    "letto_cliente" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "com_messaggi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_allegati" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "messaggio_id" TEXT NOT NULL,
    "nome_orig" VARCHAR(255) NOT NULL,
    "percorso" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
    "dimensione" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "com_allegati_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_counter" (
    "tenant_id" TEXT NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "com_counter_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "comunicazioni_tenant_id_idx" ON "comunicazioni"("tenant_id");

-- CreateIndex
CREATE INDEX "comunicazioni_tenant_id_chiusa_operatore_assegnato_id_urgen_idx" ON "comunicazioni"("tenant_id", "chiusa", "operatore_assegnato_id", "urgente", "updated_at");

-- CreateIndex
CREATE INDEX "comunicazioni_tenant_id_azienda_id_chiusa_updated_at_idx" ON "comunicazioni"("tenant_id", "azienda_id", "chiusa", "updated_at");

-- CreateIndex
CREATE INDEX "com_messaggi_tenant_id_idx" ON "com_messaggi"("tenant_id");

-- CreateIndex
CREATE INDEX "com_messaggi_comunicazione_id_created_at_idx" ON "com_messaggi"("comunicazione_id", "created_at");

-- CreateIndex
CREATE INDEX "com_messaggi_tenant_id_lato_letto_studio_letto_cliente_idx" ON "com_messaggi"("tenant_id", "lato", "letto_studio", "letto_cliente");

-- CreateIndex
CREATE INDEX "com_allegati_tenant_id_idx" ON "com_allegati"("tenant_id");

-- CreateIndex
CREATE INDEX "com_allegati_messaggio_id_idx" ON "com_allegati"("messaggio_id");

-- AddForeignKey
ALTER TABLE "comunicazioni" ADD CONSTRAINT "comunicazioni_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicazioni" ADD CONSTRAINT "comunicazioni_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicazioni" ADD CONSTRAINT "comunicazioni_referente_id_fkey" FOREIGN KEY ("referente_id") REFERENCES "referenti"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicazioni" ADD CONSTRAINT "comunicazioni_operatore_assegnato_id_fkey" FOREIGN KEY ("operatore_assegnato_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_messaggi" ADD CONSTRAINT "com_messaggi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_messaggi" ADD CONSTRAINT "com_messaggi_comunicazione_id_fkey" FOREIGN KEY ("comunicazione_id") REFERENCES "comunicazioni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_messaggi" ADD CONSTRAINT "com_messaggi_autore_user_id_fkey" FOREIGN KEY ("autore_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_allegati" ADD CONSTRAINT "com_allegati_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_allegati" ADD CONSTRAINT "com_allegati_messaggio_id_fkey" FOREIGN KEY ("messaggio_id") REFERENCES "com_messaggi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_counter" ADD CONSTRAINT "com_counter_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation (forma identica ad add_aziende/add_scadenze, ADR-0009)
-- =============================================================================
--   - USING only (no WITH CHECK: Postgres riusa USING come default per INSERT)
--   - FORCE ROW LEVEL SECURITY (table owner postgres altrimenti bypassa)
--   - Naming: <table>_tenant_isolation
-- Settings letti per-operation tx dall'extension RLS (packages/db/src/rls.ts):
-- app.is_super_admin ('true'|'false'), app.tenant_id (TEXT). No ::uuid/::int cast
-- (tenant_id e' TEXT/uuidv7). Tutte e 3 le tabelle business + il counter hanno
-- tenant_id DENORMALIZZATO (ADR-0043 DP-N2) → policy FLAT, niente subquery di
-- nesting risalente al parent (com_allegati incluso: ha tenant_id diretto).
ALTER TABLE "comunicazioni" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comunicazioni" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "comunicazioni_tenant_isolation" ON "comunicazioni"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

ALTER TABLE "com_messaggi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "com_messaggi" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "com_messaggi_tenant_isolation" ON "com_messaggi"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

ALTER TABLE "com_allegati" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "com_allegati" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "com_allegati_tenant_isolation" ON "com_allegati"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

ALTER TABLE "com_counter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "com_counter" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "com_counter_tenant_isolation" ON "com_counter"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- =============================================================================
-- Partial-unique-index soft-delete-aware (Pattern 42, ADR-0023) su `comunicazioni`:
-- `codice` per-tenant unico SOLO sulle righe attive → combacia col counter-row
-- (codice mai riusato finché la riga vive) e consente il riuso del codice di una
-- comunicazione soft-deleted. Prisma 6 non esprime i partial index nel DSL →
-- niente @@unique nello schema (come Azienda).
-- =============================================================================
CREATE UNIQUE INDEX "comunicazioni_tenant_codice_active_uq"
  ON "comunicazioni" ("tenant_id", "codice") WHERE "deleted_at" IS NULL;
