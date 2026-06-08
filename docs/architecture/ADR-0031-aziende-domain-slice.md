# ADR-0031 — Prima slice dominio: anagrafica `aziende` (verticale commercialisti)

**Status:** Accepted
**Data:** 2026-06-08
**Contesto:** STOP-c1. Primo dominio reale del 2° verticale, dopo lo skeleton (ADR-0029 BE + ADR-0030 FE). Deriva dal modello dati StudioDesk (`docs/studiodesk/`). Cfr. ADR-0009 (RLS), ADR-0021 (soft-delete), ADR-0023 (partial-unique), ADR-0024 (catchUniqueViolation).

## Context

`aziende` = anagrafica clienti dello studio (StudioDesk `01_studio_template.sql`). STOP 0 ha mappato l'entità come **standalone**: unica FK in uscita = circolare `operatore_riferimento_id`→users (RFM), le 13 FK in entrata sono entità non ancora nel dominio. La traduzione StudioDesk (MySQL, DB-per-tenant) → Gestionale (Postgres, RLS single-DB) richiede: `tenant_id` + RLS, soft-delete `deletedAt` (collassa `eliminato`+`eliminata_il`), `attivo` come campo distinto, UUID v7 app-side, unicità naturale `codice` per-tenant.

## Decision

1. **Modello `Azienda` (`@@map("aziende")`), MVP 15 campi**: `codice`, `nome`, `tipoCliente` (enum), `partitaIva`, `codiceFiscale`, `codiceAteco`, `email`, `emailOperativa`, `pec`, `sitoWeb`, `telefono`, `telefono2`, `indirizzo`, `noteOperative`, `attivo` + standard (`id` UUID v7, `tenantId`+FK Cascade, `deletedAt`, `createdAt`/`updatedAt`). **Deferiti**: RFM `operatore_riferimento_id` (dipendenza circolare con users; l'assegnazione operatori è dominio a sé) e il blocco arricchimento `32_*` (8 campi, cache da provider esterno non integrato — YAGNI). Riaggiunta additiva.
2. **Unicità naturale `codice` per-tenant** via **partial-unique-index** `aziende_tenant_codice_active_uq (tenant_id, codice) WHERE deleted_at IS NULL` (Pattern 42 / ADR-0023): no `@@unique` nello schema (Prisma 6 non esprime i partial index). Consente il riuso del `codice` di un'azienda soft-deleted. P.IVA/CF nullable e **non-unique** (persone fisiche/esteri; nessun vincolo che StudioDesk non ha).
3. **RLS `aziende_tenant_isolation`** (USING-only + `ENABLE`/`FORCE ROW LEVEL SECURITY`), forma identica al pattern delle tabelle menu (ADR-0009). GRANT DML su `gestionale_app` ereditato da `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` → nessun GRANT esplicito.
4. **Soft-delete via `update({ deletedAt })` esplicito** (ADR-0021 — mai `.delete()`). **Conflict**: pre-check `findFirst` (soft-delete-aware) → `ConflictException` + `catchUniqueViolation` (da `@gestionale/platform`, ADR-0024) come backstop sulla race verso il partial-unique. `getById`/`update`/`softDelete` → `NotFoundException`.
5. **Modulo `aziende` in `accountant-api`** (controller + service + 2 DTO + unit test), `@Inject(Token)` esplicito (Discovery #29). Rotte `/api/v1/aziende` con permessi `anagrafica.cliente.{visualizza,crea,modifica,elimina}`. **DELETE ritorna `200 { id, deleted: true }`** (pattern restaurant-api, non 204).
6. **Permesso `anagrafica.cliente.elimina` aggiunto al catalogo** (32→33): mancava (catalogo ristorazione-flavored aveva solo crea/modifica/visualizza). Assegnato a Super Admin (via `ALL_PERMISSION_CODES`) + Admin sede + Direzione, seguendo il criterio degli altri `.elimina`. La granularità crea/modifica/elimina è la convenzione del progetto.
7. **DTO**: `codice`/`nome` required, `tipoCliente` required `@IsEnum` (input esplicito; DB ha comunque `@default(azienda)`), contatti opzionali con `@IsEmail`/`@MaxLength`. `message` = errorCode (convenzione restaurant-api). Validazione coperta da **unit test** class-validator (TD-BS Sub-1: la `ValidationPipe` non si attiva in e2e SWC).
8. **Nasce la suite e2e Testcontainers di `accountant-api`** (infra replicata da restaurant-api: `.swcrc`, project `e2e`, helper container/app/env + fixture `aziende`). `aziende-crud.e2e-spec` (11 scenari: CRUD, dup-409, ricrea-201 partial-unique, 404, RBAC-403 viewer, isolamento applicativo). E2E api **solo locale** (TD-CB), non in CI.

## Consequences

- `accountant-api` espone il CRUD anagrafica clienti tenant-isolato, soft-delete-aware, con unicità `codice` per-tenant.
- Catalogo permessi a 33 (la granularità `.elimina` è ora completa per l'anagrafica).
- Suite e2e del verticale operativa; le devDeps di test (omesse negli skeleton) sono rientrate.
- Gli slot nav `clienti`/`fatture` (ADR-0030) possono ora puntare a UI reale (STOP-c2).

## Empirical evidence

- DB: indice partial `aziende_tenant_codice_active_uq`, policy `aziende_tenant_isolation`, RLS forced.
- Gate statico: typecheck 16/16, lint/format clean, 12 unit DTO verdi.
- Smoke HTTP `:3002`: create 201, dup 409, update 200, soft-delete 200, ricrea-201 (partial-unique), isolamento cross-tenant `[]`.
- E2E: 11/11 `aziende-crud` (CRUD, 409, ricrea-201, 404, 403 viewer, isolamento applicativo), DI bootstrap pulito.

## Tech debt

- **TD-RLS-aziende** (nuovo): l'isolamento di `aziende` è esercitato in e2e solo **applicativamente** (filtro `where:{tenantId}`, suite superuser — TD-BV); la policy RLS DB-level esiste ed è verificata strutturalmente in DB, ma non da test non-superuser né da `smoke:rls-core` (solo core tables). Valutare l'estensione di `smoke:rls-core` o una e2e non-superuser quando il dominio cresce. Coerente con TD-BV.

## Considered alternatives

- **DELETE permesso = riuso `.modifica`** — scartato: cancellare ≠ modificare; romperebbe la granularità RBAC. Aggiunto `.elimina`.
- **Includere RFM / arricchimento nel MVP** — scartato (dipendenza circolare / YAGNI).
- **e2e non-superuser per la RLS DB-level di `aziende`** — rinviato (TD-RLS-aziende), coerente col pattern superuser della suite.

## Reversibility

Slice additiva. Rollback = drop `apps/accountant-api/src/aziende/` + revert migration `add_aziende` (drop table/enum) + revert permesso `.elimina` dal seed. Nessun impatto su `restaurant-*`.
