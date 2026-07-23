# ADR-0075 — Note Spese v1 PR-2 (CRUD + allegati/storage)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [spec consolidata](../spec/note-spese-v1.md), [ADR-0074](./ADR-0074-note-spese-pr1-schema.md) (schema PR-1), [ADR-0043](./ADR-0043-comunicazioni-module.md) (StorageService astratto), [ADR-0044](./ADR-0044-documenti-module.md) (load-then-authorize), [ADR-0009](./ADR-0009-rls-real.md) (RLS)

## Context

Secondo blocco Note Spese (verticale accountant), consumer delle fondamenta PR-1 ([ADR-0074](./ADR-0074-note-spese-pr1-schema.md)). PR-2 = **modulo NestJS CRUD + allegati/storage**; la state machine (invia/approva/respingi) è **PR-3**. Nessuno schema/migrazione: PR-2 non tocca `schema.prisma` (le fondamenta sono già in prod-schema). Branch `feat/note-spese-api`.

Le §4-§7 della spec — non recuperate a PR-1 — sono state ricostruite e **persistite** in [`docs/spec/note-spese-v1.md`](../spec/note-spese-v1.md) (Commit 0), e l'assegnazione permessi a ruoli non-admin (aperta a PR-1) è stata **decisa** (sotto).

## Decisions applicate

### Assegnazione ruoli (chiusa)

- `notespese.gestisci` → **Collaboratore + Direzione** (l'operatore gestisce le proprie note).
- `notespese.leggi_tutte` + `notespese.approva` → **solo Direzione**.
- **Cliente → nessuno** (Client Portal deferito, PR-1). Editati solo i template `SystemRoleTemplate` (Direzione, Collaboratore); admin-tier (Super Admin/Admin/Socio) eredita già via `ALL_PERMISSION_CODES` (PR-1). Gate seed ri-eseguito: `smoke:rls-core` e `rbac-permissions` **invariati** (nessun test aggiustato); PIN permessi confermato **63/59**.

### Scoping `leggi_tutte` NON bypassabile (§6)

`list`/`getById` calcolano `canReadAll = UsersService.hasPermission(userId, 'notespese.leggi_tutte')` — **stessa fonte del `PermissionsGuard`** (no seconda verità). Senza il permesso il service forza `userId = currentUser.id` **ignorando il query param `userId`**: il param non è un canale di escalation. Test T2 esercita il vettore (regressione = filtro applicativo, non policy DB).

### D6 — coerenza mandato/azienda (§4.7, hard-fail)

`assertMandatoAzienda` su **create E update**: `mandatoId` valorizzato ⟹ `aziendaId` obbligatorio e = `mandato.aziendaId` (mandato caricato **tenant-scoped**), altrimenti `E_NOTASPESA_MANDATO_AZIENDA_MISMATCH`; mandato inesistente per il tenant → `E_NOTASPESA_MANDATO_NOT_FOUND`. Su `update` la coerenza è valutata sui **valori effettivi post-patch** (`undefined` = invariato). Non FK-enforceable → validazione applicativa (analogo `documenti.assertAzienda`). Test T13/T14.

### Ownership + load-then-authorize

- `getById`/`update`/`remove` caricano la riga `findFirst({id, tenantId, +userId se !leggi_tutte})`: cross-tenant o cross-user (senza `leggi_tutte`) → **404 indistinguibile da inesistente** (no leak). Test T1 (own) / T3 (cross-tenant).
- `update`/`remove` **solo autore**; `update` solo in `{bozza, respinta}` (`E_NOTASPESA_NOT_EDITABLE`), `remove` solo in `bozza` (`E_NOTASPESA_NOT_DELETABLE`, D5). Tutte le note nascono e restano `bozza` in PR-2 (transizioni PR-3), ma i vincoli di stato sono già applicati.

### Allegati / storage (§5)

- **StorageService astratto** (ADR-0043): mai `fs` diretto. Riuso `STORAGE_MAX_UPLOAD_BYTES` (20 MB) e `LocalFilesystemStorageService` esistenti (non toccati).
- **Allow-list MIME locale al modulo** (`application/pdf`, `image/jpeg`, `image/png`, `image/webp`): validata al `fileFilter` del controller (rifiuto in parse) **E** nel service (`assertMimeAllowed`, defense-in-depth). `mimeType` persistito = quello **verificato** dell'upload, non il dichiarato. Test T9 (service-level).
- **Download load-then-authorize** (ADR-0044): l'endpoint accetta l'**id** dell'allegato, mai lo `storageKey`; autorizza prima la **nota** (`getById` = own|`leggi_tutte`), poi carica l'allegato. Cross-tenant → 404 prima dello storage.
- **`@@unique([notaSpesaId, tipo])`**: secondo allegato con lo stesso tipo → `E_NOTASPESA_ALLEGATO_TIPO_EXISTS` (via `catchUniqueViolation`), con **orphan cleanup** del file appena messo se il `create` fallisce. Test T11.
- **Delete transazionale**: delete allegato = `row + StorageService.delete` nella **stessa tx applicativa** (`withTenantContextAtomicTx`); se lo storage throwa → rollback della delete DB. Delete nota (bozza) = cascade righe DB **+ cleanup esplicito dei file** storage nella stessa tx (il cascade non tocca lo storage). Test T12.

### Fuori scope PR-2 (registrato)

- **§4.5** nessuna regola fiscale nel service (derivazioni FE); **§4.6/D4** `distanzaKm` nessuna validazione BE (soft-warning FE).
- **State machine** (invia/approva/respingi, auto-approvazione, giustificativo/scontrino gating) → **PR-3**, con i 5 test residui (§7: 4,5,6,7,8).

## Test (§7, fase PR-2)

`note-spese-security.e2e-spec.ts`: 9 test **service-level** dal DI container sotto contesto RLS (come `documenti-download-isolation`) — esercitano il **filtro applicativo** (il vettore che il gate DB-level non copre): 1 (ownership), 2 (`userId` non bypassabile), 3 (cross-tenant 404), 9 (MIME), 10 (>20MB → `E_ALLEGATO_TOO_LARGE`), 11 (unique tipo), 12 (delete rimuove il file), 13/14 (D6). **9/9 verdi.** Gate RLS PR-1 (`note-spese-rls-isolation`) ri-eseguito **invariato (5/5)**. Local-only (TD-CB), come tutta la suite e2e accountant.

## Impatto altro verticale

**Verificato — nessuno.** PR-2 non tocca `schema.prisma` né migrazioni. Unica modifica in `packages/db` = re-export additivo dei 6 enum + 2 tipi Note Spese in `src/index.ts` (nessun cambiamento di comportamento restaurant). Tutto il resto è accountant-only (`apps/accountant-api`). `StorageModule` già in uso (documenti/comunicazioni).

## Consequences

- **Positive**: superficie CRUD + allegati Note Spese completa e testata sul vettore applicativo; scoping `leggi_tutte` e load-then-authorize allineati ai pattern esistenti (documenti/comunicazioni); storage sempre coerente col DB (delete atomici + orphan cleanup).
- **Costi/rischi**: hard-delete richiede disciplina applicativa (delete solo in `bozza`) — enforced nel service. La state machine resta il pezzo con più regole (giustificativo/scontrino/auto-approvazione) → PR-3. Nessun endpoint di transizione esposto in PR-2.
