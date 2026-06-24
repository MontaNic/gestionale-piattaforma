-- CreateTable
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_resets_tenant_id_idx" ON "password_resets"("tenant_id");

-- CreateIndex
CREATE INDEX "password_resets_user_id_idx" ON "password_resets"("user_id");

-- CreateIndex
CREATE INDEX "password_resets_token_hash_idx" ON "password_resets"("token_hash");

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation (forma reale repo, ADR-0009 / ADR-0048): USING-only +
-- FORCE, tenant_id TEXT, no cast. `password_resets` ha tenant_id diretto
-- (denormalizzato) → policy FLAT, identica a circolari_letture.
-- Escape super_admin (current_setting('app.is_super_admin')) coerente con le
-- altre policy del repo: senza, un contesto super-admin perderebbe l'accesso.
-- =============================================================================
ALTER TABLE "password_resets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_resets" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "password_resets_tenant_isolation" ON "password_resets"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
