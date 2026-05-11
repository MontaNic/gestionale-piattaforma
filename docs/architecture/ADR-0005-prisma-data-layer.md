# ADR-0005 — Prisma data layer in `packages/db` + multi-tenancy base

- **Status:** Accepted
- **Date:** 2026-05-12
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** `PROJECT_BRIEF.md` §A4 (struttura monorepo), §B1 (auth/ruoli/permessi), §C1 (modello dati — convenzioni vincolanti), §C5 (sicurezza)

## Context

Il brief richiede un data layer multi-tenant per F1 con vincoli stringenti (§C1):

- `id` UUID v7 (ordinamento naturale)
- `tenant_id` su ogni tabella multi-tenant, `sede_id` su quelle operative
- `created_at` / `updated_at` / `deleted_at` (soft delete dove sensato)
- **Row Level Security PostgreSQL attiva** su tutte le tabelle multi-tenant
- FK sempre con `ON DELETE` esplicito
- Indici su `tenant_id`, `sede_id`, FK, colonne ricercate
- Migrazioni versionate con Prisma Migrate, **mai modificare migrazioni applicate**

Lo stack è già fissato (§A3): **PostgreSQL 16+ con RLS** + **NestJS + Prisma**. Le decisioni aperte erano:

1. **Dove vive Prisma** — nel solo `apps/api` (come implicito in §A4) o in `packages/db` condiviso
2. **Come generare UUID v7** — extension PG, libreria app-side, fallback UUID v4
3. **Strategia RLS** — abilitarla subito con policy placeholder o aspettare l'arrivo dell'auth NestJS
4. **Come implementare soft delete** — middleware Prisma deprecato, extension client-side, o solo flag su schema senza enforcement

Inoltre l'analisi di `user_roles` (assegnazione user↔role con `sede_id` nullable per ruoli tenant-wide) ha fatto emergere un problema sottile di **semantica NULL in PostgreSQL** che richiede una mitigazione esplicita a livello DDL.

## Decision

### 1. Prisma vive in `packages/db`, non in `apps/api`

Schema, migrations e client tipizzato risiedono in [`packages/db/`](../../packages/db/), importabile da qualunque workspace via `@gestionale/db`.

**Razionale.** Il client Prisma e i tipi del dominio servono almeno a:

- `apps/api` (NestJS backend, primario)
- `apps/web` (Next.js, potenziale uso da Server Components / Server Actions per query lette)
- futuri worker / job runner (es. processi batch di dunning, export, AI tools)
- script operativi in `scripts/` (es. backup logici, dump dati di test)

Tenere Prisma in un solo workspace costringerebbe gli altri a duplicare i tipi o accoppiarsi al backend tramite API anche per casi semplici (es. SSR di una pagina che mostra dati pubblici). `packages/db` evita la duplicazione mantenendo un confine pulito (RLS lato DB) e API-first (NestJS è sempre il consumer principale).

**Divergenza da §A4 del brief.** Il brief elenca solo `apps/api` come location del backend e `packages/shared` per tipi/validatori, senza menzionare un `packages/db` dedicato. La divergenza è consapevole: §A4 non vieta, e il pattern `packages/db` è lo standard de facto nei monorepo pnpm + Prisma. Documentata qui per tracciabilità.

### 2. UUID v7 generato app-side via `uuidv7`

Tutti gli `id` nello schema sono `String @id` **senza `@default`**. La generazione avviene lato app via [`uuidv7`](https://www.npmjs.com/package/uuidv7) (npm, ~1KB).

**Razionale.**

- PostgreSQL 16 **non ha** una funzione `uuidv7()` nativa (introdotta in PG 18 con la builtin `uuidv7()`). Aspettare PG 18 significava rinviare il task; pinning a una versione che non c'è ancora stabile sul lato cloud non è opzione.
- Estensione `pg_uuidv7` (Andrey Borodin) avrebbe richiesto install dell'estensione su ogni env (dev, staging, prod), aumentando la superficie operativa. Per un campo derivato così semplice, preferiamo gestirlo in app.
- Generare in app rende il pattern **deterministico e cross-DB** (utile per import/export, test con SQLite eventuale, ecc.).
- Tradeoff principale: omettere `id` in un `prisma.tenant.create({ data: {} })` fa **fallire esplicitamente** la query (Prisma richiede id se non c'è default). Voluto: serve come reminder al developer che gli UUID v7 vanno passati esplicitamente. Il wrapper Prisma client (Macro-task B successivo) esporrà un helper `id()` riusabile.

**Alternative considerate.**

- `pg_uuidv7` extension PG → rejected per overhead operativo
- `@default(uuid())` (UUID v4 di Prisma) → rejected: v4 non è sortable, perdiamo il vantaggio di v7 (ordinamento temporale naturale → migliori performance index su id, query "ultimi creati" ordinabili senza colonna timestamp extra)
- `@default(cuid())` → rejected: cuid è sortable ma non è UUID; cambierebbe il tipo del campo (`String` con formato non-UUID, breaking)

### 3. RLS attivo subito con policy placeholder `USING (true)`

Tutte le tabelle multi-tenant (7) hanno **RLS abilitata** dal primo deploy, con policy **permissive `USING (true)`** che non isolano i dati ma lasciano il framework pronto.

```sql
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenants_policy" ON "tenants" USING (true);
-- TODO(F1 auth): replace with USING (id = current_setting('app.tenant_id')::uuid)
```

Quando arriverà l'auth NestJS:

- Middleware NestJS estrae il `tenant_id` dal JWT e lo imposta sulla transaction Prisma corrente via `SET app.tenant_id = '<uuid>'`
- Le policy reali sostituiranno il placeholder. Tre pattern identificati:

  **Pattern A — tabelle con `tenant_id` diretto** (sedi, users, roles, audit_logs):

  ```sql
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  ```

  **Pattern B — tabelle senza `tenant_id`, isolate via parent FK** (user_roles, sessions):

  ```sql
  USING (EXISTS (
    SELECT 1 FROM "roles" r
    WHERE r.id = user_roles.role_id
      AND r.tenant_id = current_setting('app.tenant_id')::uuid
  ))
  ```

  **Pattern C — `tenants` stesso con bypass Super Admin**:

  ```sql
  USING (id = current_setting('app.tenant_id')::uuid)
  -- + BYPASSRLS sul role Postgres usato dal Super Admin, oppure policy ad-hoc
  ```

**Razionale per "subito anche se placeholder".** Abilitare RLS dopo, su un DB con dati esistenti, è una migration delicata che richiede `ALTER TABLE ... ENABLE RLS` su tabelle popolate (lock + scan); farlo subito su tabelle vuote è gratis. Inoltre, dimenticarsi di abilitarla è un anti-pattern di sicurezza che vogliamo prevenire by-design.

**Tabelle skip RLS.**

- `permissions` — catalogo globale immutabile, niente da isolare
- `system_role_templates` — globale (template clonati per tenant nel bootstrap)
- `system_role_template_permissions` — join globale
- `role_permissions` — join role↔permission, **senza `tenant_id` diretto**. L'isolamento avviene indirettamente: query app-side fa `WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = ...)`, che con RLS attivo su `roles` filtra già. **Follow-up**: quando si scriveranno le policy reali, valutare se aggiungere RLS su `role_permissions` come defense-in-depth con `USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.tenant_id = current_setting('app.tenant_id')::uuid))`.

### 4. Soft delete via Prisma client extension (Macro-task B)

I campi `deletedAt DateTime?` sono già nello schema per: `tenants`, `sedi`, `users`, `roles`. **L'implementazione del comportamento "filtra `deletedAt IS NULL` automaticamente + intercetta `delete()` → `update({deletedAt})`"** arriva nel macro-task successivo via [Prisma client extension](https://www.prisma.io/docs/orm/prisma-client/client-extensions).

**Razionale.** L'API `prisma.$use(middleware)` di Prisma 4 è deprecata in Prisma 5+; le extension sono la API moderna (composable, type-safe). Implementazione rimandata per dare alla extension un test rigoroso (cosa fa `prisma.user.findFirst({where: {email}})` vs `prisma.user.delete()` vs `deleteMany`), out of scope per questo task focalizzato sullo schema.

**Alternative considerate.**

- Middleware `$use` → rejected (deprecato Prisma 5+)
- Solo flag schema senza enforcement client → rejected (dimenticarsi di filtrare `deletedAt: null` è bug ricorrente, non vogliamo affidarci alla disciplina manuale)

## RBAC e NULL semantics su `user_roles`

`UserRole` rappresenta l'assegnazione `(user, role, sede?)`. La semantica voluta:

- `sede_id IS NULL` → ruolo tenant-wide (es. Super Admin attivo su tutte le sedi)
- `sede_id` valorizzato → ruolo specifico per quella sede

**Vincolo di unicità:** per ogni `(user, role)` ci deve essere **al massimo un'assegnazione tenant-wide** **e al massimo una per ciascuna sede specifica**.

Un singolo `UNIQUE (user_id, role_id, sede_id)` **non funziona** perché PostgreSQL nello standard considera `NULL != NULL` negli UNIQUE constraint: due righe con stesso `(user_id, role_id, NULL)` sono entrambe permesse.

**Soluzione: due UNIQUE INDEX parziali complementari** (definiti via SQL raw nella migration `init_multitenancy_base`):

```sql
CREATE UNIQUE INDEX user_roles_per_sede_unique
  ON user_roles (user_id, role_id, sede_id)
  WHERE sede_id IS NOT NULL;

CREATE UNIQUE INDEX user_roles_tenant_wide_unique
  ON user_roles (user_id, role_id)
  WHERE sede_id IS NULL;
```

Prisma `@@unique` non esprime UNIQUE parziali → gestiti come SQL raw aggiunto alla migration init. Documentati con commento esteso in-file (18 righe esplicative).

## Consequences

### Positive

- **Data layer riusabile** da qualsiasi workspace via `@gestionale/db`, niente duplicazione tipi
- **Schema professional-grade**: 11 entità con FK esplicite, indici mirati, naming snake_case DB / camelCase TS coerente, `[PRE F2]` su campi anticipati (totp, valid_until, badge_nfc)
- **RLS pronto per F1 auth**: 7 tabelle con RLS attiva, 3 pattern policy identificati, sostituzione `USING (true)` → policy reale è meccanica
- **UUID v7 sortable**: index su `id` ordinati temporalmente, query "ultimi N record" performanti senza colonna timestamp aggiuntiva
- **NULL semantics gestita**: i 2 partial unique index su `user_roles` garantiscono unicità in entrambi i modi di assegnazione

### Negative / Trade-off

- **2 migration invece di 1**: `init_multitenancy_base` + `enable_rls`. Voluto: separare DDL strutturale (tabelle, FK, indici) da DDL di sicurezza (RLS, policy) facilita rollback chirurgico in dev se serve.
- **Seed deferred** al macro-task successivo: il bootstrap automatico di un nuovo tenant (clone template → roles) non è ancora possibile. Tenant manuale via Prisma Studio o SQL diretto fino ad allora.
- **Soft-delete extension non implementata**: chi usa `prisma.user.delete()` oggi fa hard delete senza warning. Mitigazione: il client non è ancora esportato verso altri workspace (è solo locale a packages/db), quindi nessun consumer rischia accidentalmente.
- **`id` obbligatorio in ogni `create()`**: se passi `data: {...}` senza id, Prisma errora. Voluto, ma richiede disciplina (o l'helper wrapper della Macro-task B).

### Neutral

- **2 unique partial index** sono SQL raw, non espressi in `schema.prisma`. Documentati in commento in-migration; un developer futuro potrebbe rigenerare lo schema da DB (`prisma db pull`) e perderli — segnalato come noto.
- **`role_permissions` no RLS**: protetto indirettamente via FK→roles. Rivalutare con auth reale.

## Considered Alternatives (tabella riassuntiva)

| Decisione       | Alternativa                       | Esito    | Razionale                                                                     |
| --------------- | --------------------------------- | -------- | ----------------------------------------------------------------------------- |
| Prisma location | `apps/api/prisma/`                | Rejected | Non riusabile da web/SSR/worker; accoppia tutto al backend                    |
| Prisma location | `packages/shared/` con altri tipi | Rejected | Mischia concerns: tipi domain + schema DB + client                            |
| UUID strategy   | `@default(uuid())` (v4)           | Rejected | No sortability; perde vantaggio v7                                            |
| UUID strategy   | `pg_uuidv7` extension             | Rejected | Overhead operativo install extension su ogni env                              |
| UUID strategy   | `@default(cuid())`                | Rejected | Non è UUID, cambia tipo campo                                                 |
| RLS strategy    | Disabilitato in F1                | Rejected | Anti-pattern sicurezza, dimenticabile, costoso aggiungere dopo su dati reali  |
| RLS strategy    | Policy reali subito               | Rejected | Manca `current_setting('app.tenant_id')` finché non c'è auth NestJS           |
| Soft delete     | Middleware `$use`                 | Rejected | Deprecato Prisma 5+                                                           |
| Soft delete     | Solo flag schema                  | Rejected | Niente enforcement, bug ricorrenti                                            |
| User scope      | sede_id su users                  | Rejected | Brief §B6 dice "clienti tenant-wide"; ruoli per-sede via `user_roles.sede_id` |

## Reversibility

- **Spostare schema da `packages/db` a `apps/api`**: ~1h. Move directory, aggiornare import paths nei consumer, aggiornare script di migration. Migrations files sono portabili.
- **Cambiare UUID strategy a v4 / cuid**: nuova migration che cambia tipo colonna, ricalcola id (probabilmente non vorremo mai per dati esistenti, ma per dati di test sì). Per UUID v7→PG18 nativo: in PG 18 si potrà fare `ALTER COLUMN id SET DEFAULT uuidv7()` mantenendo i valori esistenti, no breaking.
- **Disattivare RLS**: `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` per ogni tabella. Trivial.
- **Promuovere RLS policy reali**: `DROP POLICY ... ; CREATE POLICY ... USING (...)` per ogni tabella. Migration ad-hoc, attesa nel macro-task NestJS auth.

## Notes

- Prisma version installata: `prisma@6.19.3` + `@prisma/client@6.19.3` (2026-05-12). Inizialmente tentato `prisma@7` ma richiede Node 20.19+ mentre noi siamo su 20.18.1 (`.nvmrc`). Downgrade a major 6 (LTS, compatibile) — la migration a 7 quando si bumperà Node è meccanica.
- `uuidv7@1.2.1` libreria scelta: piccola (~1KB), no dependencies, output `String` UUID v7 compatibile RFC.
- DATABASE_URL gestita via root `.env` + `dotenv-cli` wrapper sugli script `prisma:*` in `packages/db/package.json`. Pattern monorepo standard; evita un secondo `.env` in `packages/db/`.
- Postgres porta esposta come `127.0.0.1:5432:5432` (localhost-only) per `prisma migrate dev` da host. L'API in container userà sempre `postgres:5432` via `gestionale_network`.

## Macro-task B implementation (2026-05-12)

Le 4 decisioni del macro-task A erano "scelte di disegno"; il macro-task B le ha tradotte in codice. Qui i dettagli per il futuro reviewer.

### Soft-delete extension — implementazione finale (`packages/db/src/soft-delete.ts`)

- **Auto-detect** dei modelli con campo `deletedAt` via `Prisma.dmmf.datamodel.models[].fields[].name`. Niente lista hardcoded — il modello aggiunto domani che ha `deletedAt` viene automaticamente incluso.
- **Query intercept** su 6 operazioni (`findUnique`, `findFirst`, `findMany`, `count`, `aggregate`, `groupBy`) tramite `query.$allModels`. Helper `withSoftDeleteFilter()` con cast `as any` interno (necessario per il tipo union di `$allModels`, runtime-safe via guard `modelsWithDeletedAt.has(model)`).
- **Escape semantics**: helper `explicitDeletedAt(where)` controlla `'deletedAt' in where`. Se il chiamante esplicita un check (anche `{ not: undefined }`), l'extension NON inietta. Permette query del cestino, history admin, audit.
- **Delete intercept** (`delete`, `deleteMany`) trasforma in `update`/`updateMany` con `data: { deletedAt: new Date() }`. **Warning documentato in-file**: `deleteMany()` senza `where` diventa soft-delete dell'intero modello — intenzionale, ma pattern raro che può ferire in test/dev.
- **`forceDelete(where: { id: string })`** come model extension via `Prisma.getExtensionContext(this).$name` + lookup `tableName` da `dmmf.datamodel.models[].dbName` (mappato `@@map`) + `$executeRawUnsafe('DELETE FROM "<table>" WHERE id = $1', id)`. Bypassa la query extension (no ricorsione) sfruttando il fatto che il raw SQL non passa per il delegate Prisma. ON DELETE CASCADE/SET NULL del DB sono rispettati naturalmente da PostgreSQL.

### Helper `id()` + dual export (`packages/db/src/index.ts`)

- `id()` → `string` ritornante UUID v7 fresh. Re-export `uuidv7` raw per chi preferisce.
- `createPrismaClient()` factory: nuova istanza extended per **NestJS DI** e **test isolati**.
- `prisma` singleton: istanza eager creata al primo import. Connessione TCP al DB resta lazy (Prisma 6 non connette prima del primo query). Costo memoria trascurabile. Pattern adottato per **script seed/smoke/utility**.

### Permission catalog (32 voci, 8 namespace, `packages/db/prisma/seed.ts`)

| Namespace      | Permissions | Note                                                                                                          |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `sistema.*`    | 8           | tenant.gestisci, utente.\{crea,modifica,disabilita\}, ruolo.\{crea,assegna\}, sede.gestisci, audit.visualizza |
| `anagrafica.*` | 4           | cliente.\{crea,modifica,visualizza\}, fornitore.gestisci                                                      |
| `menu.*`       | 5           | categoria.gestisci, piatto.\{crea,modifica\}, prezzo.modifica, visualizza                                     |
| `comande.*`    | 5           | crea, modifica, elimina, visualizza, stato.cambia                                                             |
| `cassa.*`      | 4           | scontrino.emetti, storno.esegui, chiusura.giornaliera, visualizza                                             |
| `magazzino.*`  | 2           | **`isPreF2: true`** — articolo.gestisci, movimento.crea                                                       |
| `report.*`     | 3           | fatturato.visualizza, operativo.visualizza, export                                                            |
| `ai.*`         | 1           | **`isPreF2: true`** — assistant.usa                                                                           |

Schema `Permission.isPreF2` aggiunto in **migration intermedia** `20260511204441_add_permission_is_pre_f2` per supportare il flag. Le UI F1 escluderanno i permessi `isPreF2: true` dai picker di creazione ruolo custom; saranno re-abilitati con i feature flag F2.

### 6 System role templates (mapping → 104 totali)

`isDefault: true` per tutti: ogni nuovo tenant li eredita automaticamente al bootstrap (NestJS service da scrivere — clona `system_role_templates` con `isDefault: true` → `roles` con `is_system: true` e `tenant_id` valorizzato, poi copia mapping da `system_role_template_permissions` a `role_permissions`).

| Template    | Permissions | Note                                                                                |
| ----------- | ----------- | ----------------------------------------------------------------------------------- |
| Super Admin | 32          | ALL                                                                                 |
| Admin sede  | 31          | ALL meno `sistema.tenant.gestisci` (config tenant globale riservata a Super Admin)  |
| Direzione   | 24          | report.\* + anagrafica + menu + cassa + comande (no stato.cambia) + audit + F2 stub |
| Cassiere    | 10          | menu.visualizza + comande (escluso stato.cambia) + cassa + report.operativo         |
| Cameriere   | 4           | menu.visualizza + comande (crea/modifica/visualizza, no elimina/stato)              |
| Cucina/Bar  | 3           | menu.visualizza + comande.visualizza + comande.stato.cambia                         |

### Smoke test (`packages/db/scripts/smoke-soft-delete.ts`)

5 scenari, 9 assertion totali, tutti verdi:

1. Create + `findUnique` trova (record fresh ha `deletedAt: null`)
2. `delete` → `findUnique` ritorna `null` (soft-delete); escape `deletedAt: { not: null }` trova la riga still in DB
3. `findMany` con escape esplicito ritorna i soft-deleted (query "cestino")
4. `count` default = 0, `count` con escape = 1
5. `forceDelete` → riga effettivamente sparita anche con escape

Cleanup automatico: scenario 5 fa hard-delete del tenant `smoke-test`. Su fallimento intermedio, hard-delete manuale via psql: `DELETE FROM tenants WHERE slug='smoke-test';`.

**Vitest framework rimandato** alla sessione NestJS auth, quando avremo il primo unit test reale di business logic e la pipeline test sarà giustificata.

### Fix tsconfig packages/db

`rootDir: ./src` impediva l'inclusione di `prisma/seed.ts` e `scripts/*.ts` nel typecheck. Rimosso (irrilevante con `noEmit: true`), aggiunto glob `scripts/**/*.ts` a `include`. Tutti i sorgenti TS del workspace ora sotto typecheck (verificato con `pnpm --filter @gestionale/db typecheck`).

⚠️ **Issue parallelo (follow-up)**: il root `pnpm typecheck` (tsconfig solution-style `files: []`) non propaga ai workspace. CI attuale non rileva errori TS in `packages/db`. Tracciato in PROGRESS come "Strategia typecheck monorepo" da risolvere prima dello scaffold NestJS.

### Deprecation warning Prisma 7 (osservato)

`prisma db seed` emette warning: `package.json#prisma` deprecato in Prisma 7, sostituito da `prisma.config.ts`. Non blocca oggi (siamo su 6.19.3). Migration meccanica quando bumperemo Node a 20.19+ → Prisma 7. Tracciato in PROGRESS.
