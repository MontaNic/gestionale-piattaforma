# ADR-0033 — Backend `referenti` (satellite 1:N di `aziende`)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Relates:** ADR-0031 (slice `aziende`), ADR-0019 (pattern nested `menu-categories`), ADR-0009 (RLS), ADR-0021 (soft-delete), ADR-0023 (partial-unique soft-delete-aware)

## Context

STOP-c3a del verticale commercialisti: primo satellite di dominio. `referenti` è
un'anagrafica 1:N sotto `aziende` (origine StudioDesk `aziende_referenti`, DDL
`01_studio_template.sql:1309` ≡ `52_pannello_azienda.sql:76`, definizioni byte-identiche).
Modulo nested `/api/v1/aziende/:aziendaId/referenti` in `accountant-api`. Split STOP-c3:
**c3a backend** (questo) → **c3b UI** (detail `clienti/[id]` + sezione referenti).

Lo STOP 0 ha letto il DDL StudioDesk (tabella, campi, FK, enum ruolo) e i template di
progetto: `menu-categories` (pattern nested controller) e `aziende.service` (pattern lean
del genitore diretto).

## Decisions

### Schema `Referente` — satellite 1:N, FK azienda CASCADE

`id`/`tenantId`/`aziendaId` + `nome` VarChar(150) + `ruolo` enum + `email?`/`telefono?`/`note?`

- `attivo` + soft-delete + timestamps. FK `tenantId`→tenants **Cascade** e `aziendaId`→aziende
  **Cascade** (un referente non esiste senza la sua azienda — dal DDL `ON DELETE CASCADE`).
  `@@index([tenantId])` + `@@index([aziendaId])`. Relazioni inverse su `Tenant` e `Azienda`.
  `nome` a 150 (fedele al DDL referente; `aziende.nome` è 200 — entità diverse, valori DDL diversi).

### DP-ruolo — enum Prisma `RuoloReferente`

Replica fedele del DDL: `legale_rappresentante`, `amministrativo`, `tecnico`, `altro`
(default `altro`). Type-safe + select nativo in UI (c3b), coerente con `TipoCliente`/
`PrintDepartment`. Scartato `String` libero (perde il vincolo).

### Pattern service = LEAN (eredita da `aziende.service`, NON da `menu-categories`)

I due template divergono: `menu-categories.service` usa `withTenantContextAtomicTx` + audit
su ogni mutation; `aziende.service` (STOP-c1) è single-op via `this.db.prisma`, MVP senza
audit. I referenti ereditano dal **genitore diretto** (`aziende`): single-op, no atomic tx,
no audit. Niente `catchUniqueViolation` perché referenti non ha unicità naturale (no
partial-unique). Il parent-check `assertAziendaExists` resta (404 parent + isolamento al
cliente corretto). Razionale: un referente è attributo dell'anagrafica cliente — se `aziende`
non audita, il suo satellite non deve. Coerenza > ricchezza. Conseguenza esplicita:
introdurre l'audit come standard del verticale accountant è un STOP a sé (allineerebbe anche
`aziende`), non da infilare qui.

### Permessi — riuso `anagrafica.cliente.*`

`list`/`getById` → `anagrafica.cliente.visualizza`; `create` → `.crea`; `update` → `.modifica`;
`softDelete` → `.elimina`. Nessun permesso `anagrafica.referente.*` dedicato (un referente è
attributo del cliente, non entità con governance separata). **Catalogo permessi invariato.**
Stesso principio per cui `MenuCategory` riusa `menu.categoria.gestisci`.

### Deferiti

- **`user_id`** (referente↔user dello studio): stessa circolarità RFM→users deferita in
  ADR-0031 (`operatore_riferimento_id`). Campo opzionale senza valore finché non si apre il
  join verso users.
- **Log modifiche**: `aziende_modifiche_log` del DDL è etichettato "decisione aperta"; il
  progetto ha già `audit_logs` core. Build-ahead senza driver → scartato.

### Migration — forma `add_aziende`, senza partial-unique

Prisma genera CreateEnum + CreateTable + 2 index + 2 FK cascade; blocco RLS
`referenti_tenant_isolation` USING-only + FORCE appeso a mano (ADR-0009/0031). **Nessun
partial-unique** (no unicità naturale nel DDL → un'azienda può avere due referenti omonimi).

## Doc note (campi MVP)

Il commento del model dice "MVP 7 campi": i campi di **dominio** sono 6 (nome, ruolo, email,
telefono, note, attivo); il 7° è `aziendaId` (la FK parent). Annotazione per chiarezza, nessun
cambio.

## Files

| File                                                                                             | Type                                                                  |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                                               | mod (enum `RuoloReferente` + model `Referente` + 2 relazioni inverse) |
| `packages/db/src/index.ts`                                                                       | mod (re-export `RuoloReferente` + `Referente`)                        |
| `packages/db/prisma/migrations/20260609080733_add_referenti/migration.sql`                       | new                                                                   |
| `apps/accountant-api/src/referenti/{referenti.controller,referenti.service,referenti.module}.ts` | new                                                                   |
| `apps/accountant-api/src/referenti/dto/{create,update}-referente.dto.ts`                         | new                                                                   |
| `apps/accountant-api/src/app.module.ts`                                                          | mod (registra `ReferentiModule`)                                      |
| `apps/accountant-api/test/e2e/referenti-crud.e2e-spec.ts`                                        | new (11 scenari)                                                      |
| `apps/accountant-api/test/e2e/helpers/referenti-test-fixtures.ts`                                | new (re-export aziende + `createAziendaViaApi`)                       |
| `docs/architecture/ADR-0033-referenti-backend.md`                                                | new                                                                   |
| `PROGRESS.md`                                                                                    | mod                                                                   |

## Gate

- typecheck 16/16 · lint · format clean
- migration applicata, verifica DB: policy `referenti_tenant_isolation`, RLS enabled+forced,
  3 index (pkey + tenant + azienda), 2 FK cascade
- e2e `referenti-crud` 11/11 + `aziende-crud` 11/11 regression = **22/22** (solo locale, TD-CB)

## Tech debt

Nessuno nuovo a sé. **`TD-RLS-aziende` esteso a referenti**: la policy `referenti_tenant_isolation`
è strutturalmente presente ma non esercitata a livello DB — la suite e2e gira come superuser
(TD-BV) e `smoke:rls-core` copre solo le core table. Isolamento verificato applicativamente
(e2e scenario 10). Stessa natura del TD aperto su `aziende`; da accorpare nella stessa voce
(rinominabile `TD-RLS-anagrafica`).

## Reversibility

Slice backend additiva: rimuovere il modulo `referenti/` + la registrazione, revertire schema
(enum + model + 2 relazioni inverse) + barrel, e fare migration inversa (`DROP TABLE referenti`

- `DROP TYPE RuoloReferente`) riportano allo stato ADR-0031. `aziende` e core intatti.
