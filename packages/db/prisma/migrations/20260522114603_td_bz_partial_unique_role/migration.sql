-- =============================================================================
-- TD-BZ — Unicità nome soft-delete-aware: 5° modello `Role` (ADR-0023)
-- =============================================================================
-- Estensione del fix `td_bz_partial_unique_soft_delete` (4 modelli del dominio
-- Menu) a `Role`: anche `Role` ha `deleted_at` + `@@unique([tenant_id, name])`
-- full → stesso bug TD-BZ. Scoperto al check pre-merge S21.
--
-- Migration incrementale separata: `td_bz_partial_unique_soft_delete` è già
-- applicata, editarla causerebbe checksum drift.
-- =============================================================================

-- DropIndex
DROP INDEX "roles_tenant_id_name_key";

-- CreateIndex — partial unique index soft-delete-aware (coerente con td_bz_…)
CREATE UNIQUE INDEX "roles_tenant_name_active_uq"
  ON "roles" ("tenant_id", "name")
  WHERE "deleted_at" IS NULL;
