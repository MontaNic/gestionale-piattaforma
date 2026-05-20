-- CreateEnum
CREATE TYPE "allergen" AS ENUM ('cereali_glutine', 'crostacei', 'uova', 'pesce', 'arachidi', 'soia', 'latte', 'frutta_guscio', 'sedano', 'senape', 'semi_sesamo', 'anidride_solforosa', 'lupini', 'molluschi');

-- CreateEnum
CREATE TYPE "dietary_tag" AS ENUM ('vegano', 'vegetariano', 'gluten_free', 'piccante');

-- CreateEnum
CREATE TYPE "print_department" AS ENUM ('cucina', 'pizzeria', 'bar');

-- CreateEnum
CREATE TYPE "article_availability" AS ENUM ('in_carta', 'esaurito', 'sospeso');

-- CreateEnum
CREATE TYPE "channel" AS ENUM ('cassa', 'menu_online', 'asporto', 'delivery');

-- CreateTable
CREATE TABLE "menus" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "menu_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description_short" TEXT NOT NULL,
    "description_long" TEXT,
    "photo_url" TEXT,
    "base_price" DECIMAL(10,2) NOT NULL,
    "vat_percent" INTEGER NOT NULL,
    "allergens" "allergen"[],
    "dietary_tags" "dietary_tag"[],
    "print_department" "print_department" NOT NULL,
    "preparation_time_minutes" INTEGER,
    "availability" "article_availability" NOT NULL DEFAULT 'in_carta',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "channel_visibility" "channel"[],
    "co2_kg_eq" DECIMAL(10,4),
    "pricing_rule_id" TEXT,
    "recipe_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channels" "channel"[],
    "valid_from_date" DATE,
    "valid_to_date" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_prices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menus_tenant_id_idx" ON "menus"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "menus_tenant_id_name_key" ON "menus"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "menu_categories_tenant_id_idx" ON "menu_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "menu_categories_menu_id_idx" ON "menu_categories"("menu_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_tenant_id_menu_id_name_key" ON "menu_categories"("tenant_id", "menu_id", "name");

-- CreateIndex
CREATE INDEX "articles_tenant_id_idx" ON "articles"("tenant_id");

-- CreateIndex
CREATE INDEX "articles_category_id_idx" ON "articles"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "articles_tenant_id_category_id_name_key" ON "articles"("tenant_id", "category_id", "name");

-- CreateIndex
CREATE INDEX "price_lists_tenant_id_idx" ON "price_lists"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_tenant_id_name_key" ON "price_lists"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "article_prices_tenant_id_idx" ON "article_prices"("tenant_id");

-- CreateIndex
CREATE INDEX "article_prices_article_id_idx" ON "article_prices"("article_id");

-- CreateIndex
CREATE INDEX "article_prices_price_list_id_idx" ON "article_prices"("price_list_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_prices_article_id_price_list_id_key" ON "article_prices"("article_id", "price_list_id");

-- CreateIndex
CREATE INDEX "recipes_tenant_id_idx" ON "recipes"("tenant_id");

-- CreateIndex
CREATE INDEX "pricing_rules_tenant_id_idx" ON "pricing_rules"("tenant_id");

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_pricing_rule_id_fkey" FOREIGN KEY ("pricing_rule_id") REFERENCES "pricing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_prices" ADD CONSTRAINT "article_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_prices" ADD CONSTRAINT "article_prices_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_prices" ADD CONSTRAINT "article_prices_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS policy F1 Menu domain (sessione 17, ADR-0019)
-- =============================================================================
-- Pattern replicato 1:1 da migration 20260513003613_replace_rls_placeholder_with_real:
--   - super-admin bypass OR tenant_id match (text-to-text, no ::uuid cast)
--   - USING only (no WITH CHECK: Postgres riusa USING come default per INSERT)
--   - FORCE ROW LEVEL SECURITY (table owner postgres altrimenti bypassa)
--   - Naming: <table>_tenant_isolation (ammette future policy multiple per tabella)
--
-- Le 7 tabelle hanno tutte tenant_id come colonna diretta (verificato dal DDL
-- generato sopra) -> nessun caso EXISTS join (come user_roles/sessions in D3b).
--
-- Settings letti: app.tenant_id (TEXT), app.is_super_admin ('true'|'false').
-- Settati per-operation tx dall'extension RLS (vedi packages/db/src/rls.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- menus
-- -----------------------------------------------------------------------------
ALTER TABLE "menus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menus" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "menus_tenant_isolation" ON "menus"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- -----------------------------------------------------------------------------
-- menu_categories
-- -----------------------------------------------------------------------------
ALTER TABLE "menu_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_categories" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "menu_categories_tenant_isolation" ON "menu_categories"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- -----------------------------------------------------------------------------
-- articles
-- -----------------------------------------------------------------------------
ALTER TABLE "articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "articles" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "articles_tenant_isolation" ON "articles"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- -----------------------------------------------------------------------------
-- price_lists
-- -----------------------------------------------------------------------------
ALTER TABLE "price_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_lists" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "price_lists_tenant_isolation" ON "price_lists"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- -----------------------------------------------------------------------------
-- article_prices
-- -----------------------------------------------------------------------------
ALTER TABLE "article_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_prices" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "article_prices_tenant_isolation" ON "article_prices"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- -----------------------------------------------------------------------------
-- recipes
-- -----------------------------------------------------------------------------
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipes" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "recipes_tenant_isolation" ON "recipes"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- -----------------------------------------------------------------------------
-- pricing_rules
-- -----------------------------------------------------------------------------
ALTER TABLE "pricing_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pricing_rules" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "pricing_rules_tenant_isolation" ON "pricing_rules"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
