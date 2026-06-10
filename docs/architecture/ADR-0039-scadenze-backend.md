# ADR-0039 — Scadenze backend (calendario fiscale) + categorie piattaforma/custom

- **Status:** Accepted
- **Date:** 2026-06-10
- **Relates:** ADR-0031 (aziende backend / CRUD tenant-level), ADR-0036 (preventivi backend), ADR-0009 (RLS tenant context), ADR-0021 (soft-delete), ADR-0023 (partial-unique soft-delete-aware / Pattern 42), ADR-0035 (RLS isolation e2e)
- **Slice:** FULL — schema/migration/RLS/permessi + **pattern NUOVO** (categorie con seed piattaforma `tenant_id NULL` + custom per tenant)

## Contesto

Primo modulo del livello "operatore-studio" oltre anagrafica/preventivi/dashboard:
`scadenze` (calendario fiscale). Origine StudioDesk PHP, MVP: niente ricorrenze,
notifiche, generazione automatica. Una scadenza è un evento datato, tenant-level (NON
nested sotto azienda come preventivi), opzionalmente associabile a un'azienda. Introduce
un pattern non ancora in nessun ADR: **categorie con seed di piattaforma + custom per
tenant**.

## Decisioni

**DP-1 — Scadenza tenant-level, non nested.** `@Controller('scadenze')`, service su
`tenantId` diretto (pattern aziende, non preventivi). `aziendaId` è un filtro/attributo
opzionale, non il parent della rotta. Una scadenza globale (`visibilita=tutti`) non ha
azienda; una `visibilita=azienda` la richiede.

**DP-2 — Categorie: seed piattaforma (`tenant_id NULL`) + custom (`tenant_id` valorizzato).**
Le 7 categorie predefinite (Dichiarativi, Versamenti, Adempimenti, Bilancio, Lavoro e
Paghe, Scadenze CIE/Documenti, Altro) sono seedate con `tenant_id NULL`, immutabili. Ogni
tenant può crearne di proprie via `POST /scadenze/categorie`. La lettura unisce le due
sorgenti (`WHERE tenant_id IS NULL OR tenant_id = :tenant`).

**DP-3 — `scadenze_categorie` NON ha RLS; protezione applicativa.** Una policy RLS
`tenant_id = current_setting(...)` filtrerebbe via le righe piattaforma (`tenant_id NULL`)
rompendo la lettura delle categorie globali. Quindi la tabella **non** ha RLS: lo scoping
è esplicito nel service (read = `OR[null, tenant]`; write = `tenant` corrente; ogni
`categoriaId` in input è validato come piattaforma-o-custom-del-tenant via
`assertCategoriaAccessibile`). `scadenze` invece ha RLS + FORCE standard (forma
aziende/preventivi: `is_super_admin OR tenant_id = …`).

**DP-4 — Partial-unique nome categorie SOLO sulle custom.**
`CREATE UNIQUE INDEX … ON scadenze_categorie (tenant_id, nome) WHERE tenant_id IS NOT NULL`.
Le righe piattaforma (`tenant_id NULL`) non hanno vincolo di unicità tra loro (pattern
documenti_tipi legacy): l'idempotenza del seed piattaforma è applicativa (find-then-create
su `nome` WHERE `tenant_id IS NULL`). Prisma 6 non esprime i partial index nel DSL → indice
a mano in migration.

**DP-5 — Seed categorie piattaforma incondizionato (reference data).** Seedate accanto a
permessi/template (sempre, anche in production), NON dentro il blocco dev-only: sono dati
di riferimento globali come i permessi (scelta owner; lo spec letterale le metteva dopo
`seedDevCollaboratore`). Idempotente.

**DP-6 — Validazioni business nel service, non nei DTO.** `visibilita='azienda' ⇒ aziendaId`
obbligatorio (400 `E_SCADENZA_AZIENDA_REQUIRED`), `aziendaId`/`categoriaId` devono esistere
ed essere accessibili al tenant (400 `E_SCADENZA_AZIENDA_NOT_FOUND` /
`E_SCADENZA_CATEGORIA_NOT_FOUND`). Messe nel service perché la `ValidationPipe` non gira in
e2e (TD-BS) → così la regola è esercitabile dagli e2e. Sull'`update` la coerenza è valutata
sullo stato risultante (merge dto+before), non solo sui campi inviati.

**DP-7 — `visibilita='utente'` predisposto, non cablato.** L'enum ha il valore ma non
esiste un campo `userId` su `Scadenza` nell'MVP: nessun filtro per-utente. `codiceImport`
analogo (predisposto import esterni), con partial-unique per-tenant soft-delete-aware
`(tenant_id, codice_import) WHERE deleted_at IS NULL` (NULL multipli ammessi).

**DP-8 — Permessi `scadenze.{visualizza,gestisci}` (catalogo 35→37).** GET → `visualizza`,
POST/PATCH/DELETE + POST categorie custom → `gestisci`. Template studio estesi (mirror
preventivi): Collaboratore → visualizza+gestisci; Segreteria/Praticante → visualizza;
Socio/Admin via `ALL_PERMISSION_CODES`.

## Routing — gotcha ordine rotte

`GET/POST /scadenze/categorie` sono dichiarate **prima** di `GET /scadenze/:id` nello
stesso controller: Express registra in ordine di dichiarazione, quindi le rotte statiche
`categorie` matchano prima del param `:id` (altrimenti `categorie` finirebbe come `:id`).

## File

Backend nuovi: `apps/accountant-api/src/scadenze/{scadenze.module,scadenze.controller,scadenze.service}.ts` + `dto/{create-scadenza,update-scadenza,create-scadenza-categoria}.dto.ts` + e2e `scadenze-crud.e2e-spec.ts` + helper `scadenze-test-fixtures.ts`.

DB: `schema.prisma` (enum `VisibilitaScadenza` + modelli `Scadenza`/`ScadenzaCategoria` + relazioni inverse Tenant/Azienda), migration `add_scadenze` (RLS+FORCE su scadenze, 2 partial-unique), `seed.ts` (2 permessi + ruoli + `seedScadenzeCategorie`), `db/src/index.ts` (re-export enum/tipi).

Mod: `app.module.ts` (registrazione `ScadenzeModule`), `test/e2e/helpers/test-app.ts` (`scadenze`/`scadenze_categorie` nel TRUNCATE).

## Tech debt

- **TD-RLS-scadenze candidate:** `scadenze` non è esercitata da `rls-isolation` e2e (suite
  superuser TD-BV); l'isolamento è verificato applicativamente (scenario #11) + la policy
  è la stessa forma già esercitata da aziende/preventivi. Bassa priorità, coerente con TD-BV.
- `scadenze_categorie` senza RLS: protezione interamente applicativa — ogni nuovo accesso
  alle categorie DEVE passare dallo scoping del service (mai query dirette non scopate).
- `visibilita='utente'` + `codiceImport` predisposti ma inerti finché un caso reale non li
  richiede (YAGNI).

## Test

e2e scadenze-crud 13 scenari (**61/61** totale suite: aziende 11 + referenti 11 +
rls-isolation 10 + preventivi 12 + dashboard 4 + scadenze 13). Copre CRUD, soft-delete +
404 post-delete, visibilità azienda (201 / 400 senza aziendaId), filtro `aziendaId`, RBAC
viewer (GET 200 / POST 403), isolamento cross-tenant (lista B vuota), categorie piattaforma
(`tenant_id NULL`) + create custom. Seed idempotente verificato (37 permessi, 7 categorie:
re-run 0 created / 7 re-affirmed).
