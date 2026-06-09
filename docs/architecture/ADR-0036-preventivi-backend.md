# ADR-0036 — Backend `preventivi` MVP (testata + voci, tx atomica + totali)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Relates:** ADR-0031/0033 (aziende/referenti), ADR-0009 (RLS), ADR-0021 (soft-delete), ADR-0023 (partial-unique), ADR-0024 (catchUniqueViolation backstop), ADR-0019 (withTenantContextAtomicTx)

## Context

Prima entità con **business logic** del verticale commercialisti: `preventivi` (testata) +
`preventivi_voci` (righe), figli di `aziende`, con ricalcolo totali server-side. Da StudioDesk
`62_preventivi.sql`. STOP 0 ha verificato che la tabella `fatture` non esiste in StudioDesk
(esistono `preventivi` come dominio e `fic_billing` come integrazione FIC); scelta di prodotto:
fare `preventivi` ora, FIC/fatture dopo. Slice classificata **FULL** (gate a due corsie):
tocca schema/migration/RLS + transazione atomica + business logic con invariante + nuovi
permessi + pattern nuovo.

## Decisions

### Modello — `Preventivo` (testata) + `PreventivoVoce` (righe), figli di azienda

`Preventivo`: codice (VarChar 32, partial-unique), oggetto, coverLetter/noteInterne opt, enum
`StatoPreventivo`, validoFino opt, 3 totali Decimal(12,2), soft-delete, timestamps. FK azienda

- tenant CASCADE. `PreventivoVoce`: snapshot voce custom (nome/descrizione/unità/quantità/
  prezzo/sconto/iva/totaleRiga/ordine/note), FK preventivo + tenant CASCADE, `tenantId` proprio
  (policy RLS dedicata), **non soft-deletable** (vive/muore col replace transazionale). Enum
  `StatoPreventivo` (bozza/inviato/accettato/rifiutato) + `UnitaMisura` (7 valori).

### DP-prev-1 — catalogo fuori MVP (voci custom only)

Le voci sono custom (snapshot nella riga), nessuna FK a `servizi_catalogo`. Il catalogo
(`servizi_catalogo`/`servizi_categorie`) è rimandato a slice futura con driver proprio.

### DP-prev-2 — stato base, no versioning/workflow

Enum ridotto a 4 stati (no `scaduto`/`revisione_richiesta`). Niente versioning
(`versione`/`versione_padre_id`), niente accettazione self-service cliente (IP/UA/timestamp
workflow). Campi NON modellati (non "nullable-ready") — si aggiungono se/quando servono.

### DP-e1-1 — voci nel payload testata + transazione atomica (pattern NUOVO)

Il preventivo si salva intero (`{...testata, voci: [...]}`). Il service ricalcola i totali e
fa **replace integrale delle voci** (`deleteMany` + `createMany`) dentro
`withTenantContextAtomicTx`, garantendo l'invariante totali ≡ Σ voci in un'unica transazione.
È la **prima business logic + prima tx atomica** del verticale accountant (diverge dal pattern
lean di aziende/referenti, giustificato dall'invariante). Il **pattern replace-collezione-in-tx**
(deleteMany+createMany figli + ricalcolo aggregati nel padre, tutto in tx) è nuovo nel codebase
e **riusabile per fatture** (anch'esse testata+righe).

### DP-e1-2 — codice manuale + partial-unique

`codice` fornito dall'utente, partial-unique soft-delete-aware (Pattern 42, come `aziende`):
pre-check `findFirst` + `catchUniqueViolation` backstop sulla race. No auto-numbering
(`PRV-2026-NNNN` sequenziale per-tenant = feature futura, richiede counter/advisory-lock).

### DP-e1-3 — stato libero via PATCH

Nessuna state-machine: lo stato si aggiorna come gli altri campi. Transizioni vincolate =
workflow, deferito.

### DP-e1-4 — +2 permessi `preventivi.{visualizza,gestisci}`

Area funzionale distinta dall'anagrafica → permessi propri (non riuso `anagrafica.cliente.*`).
list/getById → `preventivi.visualizza`; create/update/softDelete → `preventivi.gestisci`.
Catalogo 33→35, categoria `preventivi`. Auto-inclusi da Super Admin via `ALL_PERMISSION_CODES`

- aggiunti al template del verticale che ha menu/comande.

### Calcolo totali

`totaleRiga = qta × prezzoUnitario × (1 − scontoPct/100)`, arrotondato a 2 dp; iva per-riga =
totaleRiga × (ivaAliquota/100); totali testata = Σ. Number arrotondato a 2dp (importi MVP
piccoli), Prisma.Decimal in/out. Gli e2e asseriscono i numeri (`toBeCloseTo(_, 2)` su
`Number(...)`, i Decimal tornano stringa in JSON).

## Scelte implementative (verbale STOP 2)

- update-DTO con `message` errorCode espliciti (coerenza col create) — Accept.
- e2e: riuso `seedAziendePermissions` con codici combinati (4 anagrafica + 2 preventivi); nel
  fixture e2e i permessi preventivi finiscono con `category:'anagrafica'` (cosmetico, la RBAC
  valuta il `code`). Nel **seed reale** la category è correttamente `preventivi`. — Accept.
- Nota di precisione: il self-check report indicava i permessi "aggiunti a Direzione", il diff
  li aggiunge al template del verticale ristorazione (menu+comande) + Super Admin via
  `ALL_PERMISSION_CODES`. Funzionalmente equivalente (l'admin e2e li ottiene), nessun impatto.

## Files

| File                                                                                                  | Type                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                                                    | mod (enum `StatoPreventivo`/`UnitaMisura` + model `Preventivo`/`PreventivoVoce` + relazioni inverse) |
| `packages/db/src/index.ts`                                                                            | mod (re-export)                                                                                      |
| `packages/db/prisma/migrations/<ts>_add_preventivi/migration.sql`                                     | new (2 enum + 2 tabelle + 2 RLS policy + partial-unique)                                             |
| `apps/accountant-api/src/preventivi/{preventivi.controller,preventivi.service,preventivi.module}.ts`  | new                                                                                                  |
| `apps/accountant-api/src/preventivi/dto/{create-preventivo,update-preventivo,preventivo-voce}.dto.ts` | new                                                                                                  |
| `apps/accountant-api/src/app.module.ts`                                                               | mod (registra `PreventiviModule`)                                                                    |
| `packages/db/prisma/seed.ts`                                                                          | mod (+2 permessi, count 33→35)                                                                       |
| `apps/accountant-api/test/e2e/preventivi-crud.e2e-spec.ts` + `helpers/preventivi-test-fixtures.ts`    | new (12 scenari)                                                                                     |
| `docs/architecture/ADR-0036-preventivi-backend.md` + `PROGRESS.md`                                    | new/mod                                                                                              |

## Gate

- typecheck 16/16 · lint · format clean
- migration + verifica DB: 2 policy (`preventivi_tenant_isolation` + `preventivi_voci_tenant_isolation`), FORCE su entrambe, partial-unique `preventivi_tenant_codice_active_uq`, FK cascade
- e2e **39/39**: preventivi-crud 12 NEW (totali server-calc verificati sui numeri + replace-in-tx + RBAC + isolamento + parent/self 404) + aziende 11 + referenti 11 + rls-isolation 5 regression. Solo locale (TD-CB).

## Tech debt

- **TD candidate — RLS preventivi non esercitata DB-level**: le policy `preventivi_*` sono
  installate ma gli e2e CRUD girano come superuser (TD-BV). Coerente col TD-RLS aperto su
  anagrafica → estendere `rls-isolation.e2e-spec.ts` ai preventivi (sub-slice o STOP dedicato),
  oppure accorpare nel TD-RLS esistente. Non fatto in questa slice (scope creep).
- **TD-BV** (conversione intera suite) e **TD-BS Sub-2** (ValidationPipe e2e) invariati.

## Reversibility

Slice backend additiva: rimuovere il modulo `preventivi/` + registrazione, revertire schema
(2 enum + 2 model + relazioni inverse) + barrel + seed (−2 permessi), migration inversa
(DROP TABLE preventivi_voci, preventivi + DROP TYPE) → stato ADR-0035. Aziende/referenti intatti.
