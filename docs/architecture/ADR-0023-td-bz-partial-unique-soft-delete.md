# ADR-0023 — Fix TD-BZ: unicità nome soft-delete-aware (partial unique index)

- **Status:** Accepted
- **Date:** 2026-05-22 (sessione 21)
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0022](./ADR-0022-f1-listini-ui.md) (§Finding — TD-BZ scoperto dal GATE runtime S20), [ADR-0021](./ADR-0021-soft-delete-rls-tx-escape-fix.md) (soft-delete RLS-aware — riusa lo spec E2E non-superuser `soft-delete-rls.e2e-spec.ts`), [ADR-0019](./ADR-0019-f1-menu-crud-schema.md) (schema dominio Menu), [ADR-0005](./ADR-0005-prisma-data-layer.md) (§"RBAC e NULL semantics" — precedente partial unique index `user_roles_*`)

## ✅ Status finale

**TD-BZ RESOLVED.** Gli unique index **full** `@@unique([tenantId, name…])` sui **5 modelli soft-delete-aware** — Menu, MenuCategory, Article, PriceList **e Role** — sono sostituiti da **partial unique index `WHERE deleted_at IS NULL`**. Effetto: ricreare un'entità col nome di una soft-deleted **torna legale** (DB e applicativo coerenti); la duplicazione tra entità **attive** resta bloccata. **Solo backend** (`packages/db` + `apps/api/test`), nessun cambio API.

- 5 `@@unique` rimossi dallo schema (Prisma 6 non esprime i partial index nel DSL).
- 2 migration: `td_bz_partial_unique_soft_delete` (4 modelli Menu) + `td_bz_partial_unique_role` (Role, scoperto al check pre-merge — vedi §Role). Ognuna: `DROP INDEX` full + `CREATE UNIQUE INDEX … WHERE deleted_at IS NULL`.
- `prisma/seed.ts`: 5 `upsert` convertiti a find-then-create/update (conseguenza necessaria — vedi §convention/§seed).
- `apps/api/test/e2e/helpers/menu-test-fixtures.ts`: `ON CONFLICT` allineato al predicato del partial index (§convention).
- 8 nuovi test E2E non-superuser (4 modelli Menu × 2 scenari; Role non ha endpoint → nessun test — §Role).
- GATE Pattern 38: E2E **56 pass / 4 skip**, unit **91/91**, typecheck clean, 5 partial index verificati in DB.

## Context

**TD-BZ** (scoperto dal GATE runtime di S20, ADR-0022 §Finding): il pre-check applicativo di unicità nome usa `findFirst`, che la `softDeleteExtension` filtra escludendo le righe soft-deleted. Ma il vincolo DB `@@unique([tenantId, name…])` **include** le righe soft-deleted. Disallineamento → ricreare un'entità col nome di una soft-deleted: il pre-check passa, poi `create()` viola il constraint → `P2002` non gestito → HTTP 500.

Verifica empirica STOP 0 (S21):

- **5 modelli** hanno `deletedAt` + un `@@unique` con `name`: Menu, MenuCategory, Article, PriceList (dominio Menu) **e Role** (RBAC). STOP 0/STOP 1 ne identificarono 4; **Role è stato scoperto al check pre-merge** — anch'esso ha lo stesso bug (vedi §Role). Nessun partial index pre-esistente su di essi.
- Il pre-check (`findFirst`) è **duplicato** in ogni service (8 punti: 4 create + 4 update-conflict), nessun helper condiviso, **nessun catch di `P2002`**.
- Prisma **6.19.3**: nessun supporto dichiarativo ai partial/filtered index nel DSL `@@unique`.
- **Precedente nel progetto:** `UserRole` usa già 2 partial unique index raw (`user_roles_per_sede_unique` / `user_roles_tenant_wide_unique`, migration init, `WHERE sede_id IS [NOT] NULL`) **senza `@@unique` nello schema**.

## Decision

**Opzione 1 (confermata owner): allineare la regola DB al pre-check applicativo.** Sostituire gli unique full con **partial unique index `WHERE deleted_at IS NULL`** — la regola DB combacia con `findFirst` (soft-delete-aware). Conseguenza voluta: il nome di un'entità soft-deleted è **riusabile**; la duplicazione tra entità attive resta bloccata (pre-check + partial index).

Opzioni scartate: (a) pre-check che include `deletedAt` + nome bloccato per sempre — mantiene un nome occupato da un record invisibile, contro-intuitivo; (b) solo catch `P2002` — rete di sicurezza, non risolve la semantica "riuso del nome".

Il fix replica il **pattern UserRole consolidato**: partial unique index via raw SQL in migration, niente `@@unique` nello schema. I `findFirst` dei service restano **invariati** (già corretti — ora coerenti col DB).

### §convention — Unicità soft-delete-aware

> Per ogni modello con `deletedAt` (soft-delete), l'unicità di un campo "naturale" (es. `name`) si esprime con un **partial unique index `… WHERE deleted_at IS NULL`** in una migration raw SQL, **non** con `@@unique` nello schema Prisma (Prisma 6 non supporta i partial index dichiarativi). Lo schema documenta la scelta con un commento sul modello. Un `@@unique` full bloccherebbe il riuso del nome di una riga soft-deleted, disallineandosi dal pre-check applicativo `findFirst`.

**Rimuovere un `@@unique` impatta tre superfici** — vanno cercate e adeguate tutte e tre (le prime due emerse dal GATE typecheck, la terza dal GATE E2E):

1. **`WhereUniqueInput` compound (Prisma client):** Prisma genera la chiave compound (es. `tenantId_name`) solo in presenza del `@@unique`. Rimuovendolo, ogni `findUnique`/`upsert`/`connect` che la referenzia non compila più → convertire a find-then-act sulla chiave naturale. Errore **a compile-time**.
2. **`upsert` idempotenti:** caso particolare di (1) — un `upsert` richiede una `WhereUniqueInput` → diventa `findFirst` + `create`/`update` (es. `prisma/seed.ts`). Errore **a compile-time**.
3. **`ON CONFLICT` raw SQL:** un `INSERT … ON CONFLICT (col…)` matcha un partial index **solo se include lo stesso predicato** (`ON CONFLICT (col…) WHERE deleted_at IS NULL`). Senza il `WHERE`, Postgres non trova un constraint corrispondente → errore **a runtime** ("there is no unique or exclusion constraint matching the ON CONFLICT specification") — invisibile al typecheck.

### §seed — Conseguenza: `upsert` → find-then-create/update

Rimuovere `@@unique` rimuove anche le `WhereUniqueInput` compound generate da Prisma (`tenantId_name`, `tenantId_menuId_name`, `tenantId_categoryId_name`). `prisma/seed.ts` le usava per gli `upsert` idempotenti dei 5 modelli → non compilavano più. **Scoperto dal GATE Pattern 38** (typecheck — STOP intermedio con evidenza prima di procedere). Fix: i **5** `upsert` (Menu/MenuCategory/Article/PriceList + Role) convertiti a **find-then-create/update** sulla chiave naturale (`findFirst` + `create`/`update`) — stesso pattern dei pre-check dei service, idempotenza preservata (verificata: 2 run consecutivi → ID stabili). `ArticlePrice` (`@@unique([articleId, priceListId])`, no `deletedAt`) **non** toccato.

### §Role — 5° modello, scoperto al check pre-merge (S21-bis)

Il fix iniziale (STOP 1) coprì i 4 modelli del dominio Menu. Il **check pre-merge** ha rilevato che anche `Role` (RBAC) ha `deletedAt` + `@@unique([tenantId, name])` → stesso identico bug TD-BZ. Estensione fatta **nello stesso atomo** (stesso branch/PR): mergiare senza Role = dichiarare TD-BZ RESOLVED col bug vivo sul 5° modello (over-claim).

Caso minimale: `Role` non ha service né endpoint CRUD utente-facing (nessun pre-check `findFirst`, nessun `E_ROLE_NAME_EXISTS`); le sole scritture sono `tenants.service.ts` (`tx.role.create()` diretto nel bootstrap, no compound key) e il seed. Quindi **nessun nuovo test E2E** per Role — il path non è testabile via API. Il fix è **strutturale** (schema + migration + seed), validato da typecheck + presenza del partial index in DB, non da test runtime. Migration **incrementale separata** (`td_bz_partial_unique_role`) — `td_bz_partial_unique_soft_delete` era già applicata, editarla causerebbe checksum drift.

L'estensione a Role ha scoperto la **terza superficie** (§convention punto 3): l'helper E2E `menu-test-fixtures.ts` inserisce un ruolo via raw SQL `ON CONFLICT (tenant_id, name)` — rotto dal passaggio a partial index, **43 fallimenti E2E a cascata** (è il setup di 6 spec). Fix: `ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL`. Il primo GATE (4 modelli Menu) era verde perché **nessuna** tabella del dominio Menu ha un `ON CONFLICT` raw — solo `roles`.

### §TD-BY — defer a S23 (deciso in S21)

**TD-BY** (pricing resolution backend) è **deferito al primo consumer (Cassa, S23+)**. Razionale dall'evidenza empirica STOP 0: la resolution non è un `override ?? basePrice` banale ma un **motore multi-match** (il commento schema su `PriceList.priority` recita "tie-break futuro multi-match" → più listini possono coprire lo stesso canale via `channels[]`; servono filtro channel-containment + finestra `validFromDate/validToDate` + tie-break `priority`). **Zero consumer backend** attuali. Implementarla ora = fissare scelte (data-riferimento, finestre sovrapposte, fallback no-match) senza un consumatore reale che le validi → il primo consumer definirà i requisiti.

## Tech debt

### TD-CA — catch `P2002` → `E_*_NAME_EXISTS` per race TOCTOU

Categoria: **robustezza**. Il pre-check `findFirst` + `create` non è atomico: due create concorrenti dello stesso nome **attivo** possono superare entrambe il pre-check, poi una viola il partial unique index → `P2002` non gestito → HTTP 500 (invece di un 4xx `E_*_NAME_EXISTS` pulito). **Confine:** finché non gestito, la race TOCTOU su nomi attivi concorrenti restituisce 500 su una delle due richieste. Pre-esistente, ortogonale a TD-BZ, raro (dev single-user). Fix: `try/catch` su `P2002` nei service (o helper condiviso) → `ConflictException E_*_NAME_EXISTS`. Severità BASSA, ~30min.

### TD-BZ → RESOLVED

Era MEDIA (aperto S20, ADR-0022). Chiuso da questo ADR.

## GATE — Pattern 38 (anti-regressione)

Baseline registrata **prima** del fix: E2E 48 pass / 4 skip. Post-fix (incl. estensione Role S21-bis):

- **E2E** full suite: **56 pass / 4 skip** (10 file) — baseline 48 invariati + **8 nuovi test TD-BZ** verdi. Lo spec `soft-delete-rls.e2e-spec.ts` (ruolo `gestionale_app` non-superuser, RLS reale) passa da 3 a 11 test. L'estensione Role non aggiunge test (no endpoint — §Role) e non regredisce nulla.
- **Unit:** **91/91** invariati.
- **typecheck** workspace: clean (dopo i fix seed — vedi §seed/§convention).
- **Partial index in DB** (`pg_indexes`, verifica empirica non dedotta): i **5** index esistono con `WHERE (deleted_at IS NULL)`.
- `migrate status`: clean (9 migration). Seed: idempotente (2 run → ID stabili).

8 test TD-BZ = 4 modelli Menu × {riuso nome soft-deleted → 201, duplicato attivo → 409 `E_*_NAME_EXISTS`}.

## Files

| Path                                                                                          | Cosa cambia                                                                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                                            | rimossi 5 `@@unique` (Menu/MenuCategory/Article/PriceList/Role) + commento §convention |
| `packages/db/prisma/migrations/20260522111054_td_bz_partial_unique_soft_delete/migration.sql` | new — 4 DROP INDEX + 4 partial unique index (dominio Menu)                             |
| `packages/db/prisma/migrations/20260522114603_td_bz_partial_unique_role/migration.sql`        | new — DROP INDEX + partial unique index (Role)                                         |
| `packages/db/prisma/seed.ts`                                                                  | 5 `upsert` → find-then-create/update (§seed)                                           |
| `apps/api/test/e2e/soft-delete-rls.e2e-spec.ts`                                               | +8 test regressione TD-BZ (nested describe)                                            |
| `apps/api/test/e2e/helpers/menu-test-fixtures.ts`                                             | `ON CONFLICT` su `roles` allineato al predicato del partial index (§Role)              |
| `docs/architecture/ADR-0023-td-bz-partial-unique-soft-delete.md`                              | questo file                                                                            |

## Definition of Done (S21)

- [x] Task 1 — baseline Pattern 38 (E2E 48/4) + verifica empirica nomi fisici
- [x] Task 2 — rimossi 4 `@@unique` dallo schema
- [x] Task 3 — migration partial unique index + applicata + `migrate status` clean
- [x] Task 4 — 8 test regressione E2E non-superuser
- [x] Task 5 — GATE Pattern 38 verde (E2E 56/4, unit 91/91, typecheck, index verificati); seed fix scoperto dal GATE e risolto in scope
- [x] S21-bis — esteso a `Role` (5° modello, scoperto al check pre-merge); helper E2E `ON CONFLICT` allineato al partial index; GATE ri-eseguito verde (E2E 56/4)
- [x] ADR-0023 + PROGRESS aggiornati; TD-BZ → RESOLVED, TD-CA catturato, TD-BY → defer S23
- [ ] HEAD main avanzato via squash merge PR (owner da UI)
