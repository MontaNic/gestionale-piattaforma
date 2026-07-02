-- =============================================================================
-- PR-2 (ADR-0068) — Un tavolo, un conto aperto (DP-2)
-- =============================================================================
-- Regola di dominio: al più UN conto in stato 'aperto' per tavolo. Finora
-- garantita solo applicativamente (nessun vincolo DB) → una race TOCTOU o due
-- aperture concorrenti dallo stesso tavolo potevano creare 2 conti aperti sullo
-- stesso tavolo. Qui la regola diventa invariante di database.
--
-- Partial unique index tenant-scoped, stesso pattern dei `*_active_uq` del repo
-- (TD-BZ soft-delete, migration 20260522111054): il predicato DB combacia col
-- filtro applicativo della mappa (`listConti({ stato: 'aperto', tavoloId })`).
--   - Solo lo stato 'aperto' è vincolato → chiuso/annullato liberano il tavolo,
--     un nuovo conto sullo stesso tavolo torna legale.
--   - `tavolo_id IS NOT NULL`: in Postgres i NULL non collidono già su unique,
--     ma renderlo esplicito documenta l'intento (asporto/delivery/menu_online
--     hanno tavolo_id NULL → N conti aperti senza tavolo restano legali) e
--     mantiene l'indice piccolo (esclude le righe NULL).
--   - `tenant_id` in testa: coerenza col pattern repo (tavolo_id è già FK a un
--     tavolo tenant-owned, quindi globalmente unico, ma l'indice segue la
--     convenzione tenant-first).
--
-- Prisma 6 non esprime i partial index nel DSL → raw SQL qui, nessun @@unique
-- nello schema (solo commento documentale nel model Conto). Violazione runtime
-- → P2002 → catchUniqueViolation → 409 E_CONTO_TAVOLO_ALREADY_OPEN
-- (conti.service.create).
-- =============================================================================

-- CreateIndex — partial unique index: un solo conto 'aperto' per (tenant, tavolo)
CREATE UNIQUE INDEX "conti_tenant_tavolo_aperto_uq"
  ON "conti" ("tenant_id", "tavolo_id")
  WHERE "stato" = 'aperto' AND "tavolo_id" IS NOT NULL;
