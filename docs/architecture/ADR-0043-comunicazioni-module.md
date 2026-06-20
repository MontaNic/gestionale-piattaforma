# ADR-0043 — Modulo Comunicazioni: thread 1:1 studio↔cliente

- **Status:** Accepted
- **Date:** 2026-06-19
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** ADR-0031 (prima slice dominio accountant), ADR-0039/0040 (scadenze — pattern CRUD+RLS replicato), ADR-0009 (RLS reali), ADR-0023 (partial-unique soft-delete), `PROJECT_BRIEF.md` §B (verticale commercialisti). Modello dati riusato da StudioDesk PHP (`docs/studiodesk/sql/01_studio_template.sql` righe ~170-260), **non** il codice.

## Context

Il verticale commercialisti ha bisogno di un canale di comunicazione tracciato tra gli operatori dello studio e le aziende clienti, che sostituisca email sparse e telefonate non documentate. Il vecchio portale PHP StudioDesk aveva un sistema `comunicazioni`/`com_messaggi`/`com_allegati` (più canali Telegram/WhatsApp e automazioni AI). Qui ne riusiamo il **modello dati**, non il codice, e ne tagliamo drasticamente lo scope a un MVP operatore-only.

Vincoli che discriminano il design:

- **Nessun portale cliente in F1.** Il cliente non ha un account/login (è livello 2). Quindi il thread non può essere ancorato a uno _user_ cliente.
- **Multi-tenant + RLS reali** (ADR-0009): ogni riga deve essere isolata per tenant, con `FORCE ROW LEVEL SECURITY`.
- **Allegati**: serve storage file, ma con un'astrazione che consenta lo swap futuro a Cloudflare R2 senza toccare i consumer (decisione storage 10/06).

## Decision

### 1. Modello dati — 3 tabelle + counter

- **`Comunicazione`** (testata thread): `codice` per-tenant, `aziendaId` (FK), `referenteId?` (FK), `apertaDa` (studio|cliente), `operatoreAssegnatoId?` (user interno, NULL = da prendere), `oggetto`, `urgente`, `chiusa`/`chiusaIl`, soft-delete, RLS+FORCE.
- **`ComMessaggio`**: `comunicazioneId` (FK), `autoreUserId?` (user interno), `lato` (studio|cliente|interno), `origine` (solo `portale`, estendibile), `testo`, `lettoStudio`/`lettoCliente`, RLS+FORCE.
- **`ComAllegato`**: `messaggioId` (FK), `nomeOrig`, `percorso` (chiave opaca StorageService), `mimeType`, `dimensione`, RLS+FORCE.
- **`com_counter`**: counter-row per-tenant per la generazione del `codice`.

### 2. DP-N1 — Ancoraggio ad azienda + referente, NON a user cliente

Il thread è ancorato a `aziendaId` + `referenteId?` (il referente lato cliente che l'ha aperta), **non** a uno user cliente (che non esiste pre-portale). Divergenza voluta dal PHP, che aveva `user_id NOT NULL` (chi l'ha aperta) verso `users`. Conseguenza: i `ComMessaggio` lato cliente hanno **`autoreUserId` NULL** finché non arriva il portale; `lato=cliente` li distingue.

### 3. DP-N2 — `tenantId` denormalizzato su tutte e 3 → RLS flat (no nesting)

`tenant_id` è **denormalizzato** su `comunicazioni`, `com_messaggi`, `com_allegati` (e `com_counter`). Policy **flat** USING-only + FORCE su ciascuna, forma reale del repo (ADR-0009):

```sql
ALTER TABLE "com_allegati" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "com_allegati" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "com_allegati_tenant_isolation" ON "com_allegati"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
```

**Perché denormalizzare e non "risalire al parent":** in tutto il repo non esiste una sola policy RLS con subquery di nesting — ogni figlio (es. `PreventivoVoce`) denormalizza `tenant_id`. È l'unico pattern testato; evita EXISTS/join per riga; consistente. `tenant_id` è `TEXT` (uuidv7): **nessun cast `::int`/`::uuid`**. Il service scrive `tenantId` esplicitamente su messaggi/allegati.

### 4. DP-codice — counter-row con `SELECT … FOR UPDATE` nella stessa tx

Il `codice` (`COM-0001`, `COM-0002`, …) è generato per-tenant da `com_counter`, dentro la **stessa** `withTenantContextAtomicTx` dell'insert della comunicazione:

```ts
await raw.$executeRawUnsafe('INSERT INTO "com_counter" ... ON CONFLICT DO NOTHING', tenantId);
const rows = await raw.$queryRawUnsafe(
  'SELECT "last_number" FROM "com_counter" WHERE "tenant_id" = $1 FOR UPDATE',
  tenantId,
);
const next = (rows[0]?.last_number ?? 0) + 1;
await raw.$executeRawUnsafe(
  'UPDATE "com_counter" SET "last_number" = $1 WHERE "tenant_id" = $2',
  next,
  tenantId,
);
```

Il `FOR UPDATE` locka la riga counter per-tenant: due aperture simultanee nello stesso tenant si serializzano (la 2ª aspetta il commit della 1ª e legge `last_number` aggiornato) → nessuna collisione sul codice. Cross-tenant nessun blocco (righe counter diverse). **Backstop**: partial-unique soft-delete-aware (Pattern 42, ADR-0023):

```sql
CREATE UNIQUE INDEX "comunicazioni_tenant_codice_active_uq"
  ON "comunicazioni" ("tenant_id", "codice") WHERE "deleted_at" IS NULL;
```

### 5. DP-storage — `StorageService` astratto + impl filesystem locale

Comunicazioni è il **primo consumer** di storage file. Introdotto `StorageService` (classe astratta DI: `put`/`get`/`delete`, chiave opaca) + `LocalFilesystemStorageService` (filesystem locale Hetzner su volume **persistente**, root `STORAGE_LOCAL_ROOT`, cap **20MB**). I consumer iniettano solo il token astratto → lo swap a **Cloudflare R2** è un cambio di `useClass`, zero modifiche ai consumer.

**Path-safety** (solo questo, niente MIME magic-bytes/antivirus/rate-limit — vedi backlog): il nome file originale non entra mai nel path (solo metadato `nomeOrig`); la chiave è generata internamente `<tenantId-uuid>/<id-uuid>(.ext)?`; `absFromKey` ha due barriere — (1) guard di shape a monte (rifiuta null byte e qualunque key fuori forma → `../`, path assoluti, separatori extra), (2) containment `resolve` + `startsWith(root + sep)`. Coperto da `local-filesystem-storage.service.spec.ts` (4 reject di traversal + round-trip).

### 6. Permessi e UI

- **+2 permessi** `comunicazioni.gestisci` / `comunicazioni.visualizza` (catalogo 37 → 39), convenzione imperativa del repo (`gestisci`/`visualizza`). Mapping: Socio (tutti), Collaboratore + Segreteria (gestione attiva), Praticante (sola visualizza).
- **UI solo operatore** (accountant-web): inbox filtrabile, dettaglio thread, composer messaggi, allegati, **note interne** (`lato=interno`, mai in ottica cliente), assegnazione/presa-in-carico, read tracking. **Nessuna UI cliente** (livello 2).

## Consequences

### Positive

- Canale tracciato studio↔cliente, isolato per tenant (RLS+FORCE su tutte e 3 le tabelle).
- Codice leggibile, monotòno e race-safe per-tenant.
- Storage astratto: R2 swap-ready senza toccare il dominio.

### Negative / Trade-off

- `autoreUserId` nullable lato cliente è un compromesso pre-portale: quando arriva il portale (livello 2) andrà valorizzato.
- Denormalizzazione `tenantId` su messaggi/allegati: ridondanza accettata in cambio di policy flat e performance (no nesting).

### Neutral

- `origine` nasce con un solo valore (`portale`): l'enum è estendibile senza migration breaking quando arriveranno i canali.

## Out of scope — backlog (NON implementati)

Tagliati dal MVP, da valutare in iterazioni successive:

- **Multi-canale**: Telegram / WhatsApp / email / SA (`origine` già predisposto, enum estendibile).
- **`whatsapp_inbound_log`** (dedup messaggi inbound Meta).
- **Reazioni** emoji ai messaggi.
- **Snooze** (campi `snoozed_until`/`snoozed_by` del PHP omessi).
- **Auto-chiusura cron** (campo `auto_chiusa_motivo` del PHP omesso).
- **AI**: smart-reply / summary / polish.
- **Firma automatica** in coda ai messaggi.

## Tech debt

- **TD-storage-platform** — `StorageService` vive oggi locale a `apps/accountant-api` (primo consumer). Va **estratto in `packages/platform`** al **2° consumer** (es. modulo Documenti), per riuso cross-vertical senza duplicazione.
- **Nota RLS test (TD-BV noto)** — l'isolation test (tenant A insert → tenant B legge 0 su tutte e 3 le tabelle, `com_allegati` incluso) è **PASS valido**, ma gira con un client che imposta il context via gli helper RLS (super-admin per il setup). **Non esercita il path reale sotto il ruolo `gestionale_app`** in una request HTTP end-to-end: quella copertura resta delegata agli e2e (TD-BV, come per gli altri moduli).

## Notes

- Migration: `packages/db/prisma/migrations/20260619143135_add_comunicazioni/` (tabelle + FK + RLS+FORCE hand-edited + partial-unique).
- Backend: `apps/accountant-api/src/comunicazioni/` + `apps/accountant-api/src/storage/`.
- Frontend: `apps/accountant-web/src/app/t/[slug]/(authenticated)/comunicazioni/` + `components/comunicazioni/` + `lib/comunicazioni-{types,api}.ts`.
