-- CreateTable
CREATE TABLE "cliente_inviti" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "azienda_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cliente_ruolo" "cliente_ruolo" NOT NULL DEFAULT 'utente',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "invitato_da_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_inviti_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cliente_inviti_tenant_id_idx" ON "cliente_inviti"("tenant_id");

-- CreateIndex
CREATE INDEX "cliente_inviti_token_hash_idx" ON "cliente_inviti"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_inviti_tenant_id_azienda_id_email_key" ON "cliente_inviti"("tenant_id", "azienda_id", "email");

-- AddForeignKey
ALTER TABLE "cliente_inviti" ADD CONSTRAINT "cliente_inviti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_inviti" ADD CONSTRAINT "cliente_inviti_azienda_id_fkey" FOREIGN KEY ("azienda_id") REFERENCES "aziende"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_inviti" ADD CONSTRAINT "cliente_inviti_invitato_da_id_fkey" FOREIGN KEY ("invitato_da_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- RLS tenant-isolation (forma reale repo, ADR-0009 / ADR-0048): USING-only +
-- FORCE, tenant_id TEXT, no cast. `cliente_inviti` ha tenant_id diretto
-- (denormalizzato) → policy FLAT, identica a password_resets / circolari_letture.
-- =============================================================================
ALTER TABLE "cliente_inviti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cliente_inviti" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "cliente_inviti_tenant_isolation" ON "cliente_inviti"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
