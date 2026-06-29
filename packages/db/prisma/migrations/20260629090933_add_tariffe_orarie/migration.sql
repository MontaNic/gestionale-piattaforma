-- CreateTable
CREATE TABLE "tariffe_orarie" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role_id" TEXT,
    "user_id" TEXT,
    "tariffa_oraria" DECIMAL(10,2) NOT NULL,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariffe_orarie_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tariffe_orarie_tenant_id_idx" ON "tariffe_orarie"("tenant_id");

-- CreateIndex
CREATE INDEX "tariffe_orarie_role_id_idx" ON "tariffe_orarie"("role_id");

-- CreateIndex
CREATE INDEX "tariffe_orarie_user_id_idx" ON "tariffe_orarie"("user_id");

-- AddForeignKey
ALTER TABLE "tariffe_orarie" ADD CONSTRAINT "tariffe_orarie_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariffe_orarie" ADD CONSTRAINT "tariffe_orarie_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariffe_orarie" ADD CONSTRAINT "tariffe_orarie_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS FORCE (pattern Mandato / Preventivo, ADR-0009): tenant_id denormalizzato
-- → policy flat USING. Settings letti per-operation dall'extension RLS
-- (app.is_super_admin, app.tenant_id).
-- =============================================================================
ALTER TABLE "tariffe_orarie" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tariffe_orarie" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "tariffe_orarie_tenant_isolation" ON "tariffe_orarie"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- =============================================================================
-- Scope esclusivo (ADR-0055): ogni tariffa è per-ruolo XOR per-utente. Prisma 6
-- non esprime i CHECK nel DSL → raw SQL. `<>` su due booleani = XOR: vero solo
-- se esattamente uno tra role_id / user_id è valorizzato.
-- =============================================================================
ALTER TABLE "tariffe_orarie" ADD CONSTRAINT "tariffe_orarie_scope_xor"
  CHECK (("role_id" IS NOT NULL) <> ("user_id" IS NOT NULL));

-- =============================================================================
-- Partial-unique soft-delete-aware (Pattern 42, ADR-0023): AL PIÙ una tariffa
-- ATTIVA (deleted_at IS NULL) per ruolo e una per utente, per tenant → riuso
-- dopo soft-delete. Prisma 6 non esprime i partial index → raw SQL.
-- =============================================================================
CREATE UNIQUE INDEX "tariffe_orarie_tenant_role_unique"
  ON "tariffe_orarie" ("tenant_id", "role_id")
  WHERE "role_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "tariffe_orarie_tenant_user_unique"
  ON "tariffe_orarie" ("tenant_id", "user_id")
  WHERE "user_id" IS NOT NULL AND "deleted_at" IS NULL;
