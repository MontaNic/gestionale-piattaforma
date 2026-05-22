-- =============================================================================
-- TD-BZ — Unicità nome soft-delete-aware (ADR-0023)
-- =============================================================================
-- Gli unique index FULL su (tenant_id, name…) includevano le righe soft-deleted,
-- mentre il pre-check applicativo (`findFirst`, filtrato da softDeleteExtension)
-- le esclude → ricreare un'entità col nome di una soft-deleted violava il
-- constraint DB → P2002 non gestito → HTTP 500.
--
-- Fix: sostituire gli unique full con partial unique index `WHERE deleted_at IS
-- NULL` — la regola DB combacia col pre-check applicativo. Effetto: il riuso del
-- nome di un'entità soft-deleted torna legale; la duplicazione tra entità ATTIVE
-- resta bloccata. Prisma 6 non esprime i partial index nel DSL → niente @@unique
-- nello schema (stesso pattern di `user_roles_*_unique`, migration init).
-- =============================================================================

-- DropIndex
DROP INDEX "articles_tenant_id_category_id_name_key";

-- DropIndex
DROP INDEX "menu_categories_tenant_id_menu_id_name_key";

-- DropIndex
DROP INDEX "menus_tenant_id_name_key";

-- DropIndex
DROP INDEX "price_lists_tenant_id_name_key";

-- CreateIndex — partial unique index soft-delete-aware
CREATE UNIQUE INDEX "menus_tenant_name_active_uq"
  ON "menus" ("tenant_id", "name")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "menu_categories_tenant_menu_name_active_uq"
  ON "menu_categories" ("tenant_id", "menu_id", "name")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "articles_tenant_category_name_active_uq"
  ON "articles" ("tenant_id", "category_id", "name")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "price_lists_tenant_name_active_uq"
  ON "price_lists" ("tenant_id", "name")
  WHERE "deleted_at" IS NULL;
