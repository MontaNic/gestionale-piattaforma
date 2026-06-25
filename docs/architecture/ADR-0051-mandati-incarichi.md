# ADR-0051 — Mandati / Incarichi: lettera d'incarico da preventivo accettato

Status: Accepted
Date: 2026-06-25
Verticale: accountant (livello 1, operatore-studio) — Onda 3 Task 2

## Context

Un preventivo accettato non ha oggi alcuna prosecuzione formale: manca la
"lettera d'incarico" (mandato) che traccia l'esecuzione del rapporto con il
cliente. L'origine legacy è `docs/studiodesk/sql/65_rapporti_lavoro.sql`
("rapporto di lavoro = lettera d'incarico che nasce da un preventivo accettato").

Questo task introduce il **mandato** come entità derivata dal preventivo. Il
timesheet (prestazioni) e gli hook di fatturazione del legacy sono **DEFER**
(Task 3 timesheet, Task 4 FIC/billing).

## Decision

### 1. DP-modello — `Mandato` (RLS standard, dato puro-tenant)

Modello `Mandato` (mappa `mandati`): `codice`, `preventivoId`, `aziendaId`,
`stato` (enum `StatoMandato`: in_corso/sospeso/concluso/annullato), date
(`inizio`/`finePrevista`/`fineEffettiva`), `note`, `importoConcordato`, soft-delete.
Dato puro-tenant → **RLS FORCE standard** (pattern `Preventivo`, policy
`mandati_tenant_isolation`). NON il pattern platform/custom del catalogo.

**Divergenze dal legacy** (confermate): audit per-riga (`created_by`/`chiuso_by`)
**omesso** (il codebase usa `AuditLog` globale + `createdAt/updatedAt`); FK
preventivo **`Cascade`** (non `RESTRICT`) per coerenza col tenant-cascade ed
evitare conflitti d'ordine alla cancellazione tenant — i preventivi sono comunque
soft-delete (hard-delete reale solo a teardown tenant).

### 2. DP-1:1 — `convertito` + partial-unique soft-delete-aware

Il mandato nasce **solo** da un preventivo `accettato`. Alla creazione (tx
atomica): guard `stato === 'accettato'` (400 altrimenti) → crea mandato + porta
il preventivo a **`convertito`** (nuovo valore di `StatoPreventivo`). Questo dà
semantica all'"aggiorna stato" e rende il rapporto **1:1**: un secondo tentativo
trova `convertito` e fallisce il guard.

Belt-and-suspenders: **partial unique index** raw SQL `(preventivo_id) WHERE
deleted_at IS NULL` (Pattern 42). Non esprimibile come `@@unique` Prisma → la
relazione `Preventivo.mandati` è una lista a livello Prisma; il service legge il
mandato attivo con `findFirst({ preventivoId, deletedAt: null })`. Soft-delete +
ricreazione restano possibili (il partial-unique ignora le righe cancellate).

### 3. DP-codice — counter per-tenant per-anno `RDL-<anno>-<NNNN>`

`RdlCounter` (PK composta `tenantId+anno`): pattern `ComCounter` ma con
progressivo che **riparte ogni anno**. Generazione in tx: `INSERT … ON CONFLICT
DO NOTHING` + `SELECT … FOR UPDATE` (serializza i concorrenti) + `UPDATE`. RLS
FORCE come `com_counter`.

### 4. DP-importo snapshot

`importoConcordato` = snapshot di `preventivo.totale` al momento della creazione.
Immutabile (non editabile via PATCH): congela il valore concordato anche se il
preventivo cambiasse.

### 5. DP-creazione come azione

Endpoint `POST /preventivi/:id/mandato` (non un generico `POST /mandati`): la
creazione è un'**azione dal preventivo** accettato (UX + invariante di dominio:
non si crea un mandato scollegato da un preventivo). CRUD del mandato sotto
`/mandati` (`GET` lista/`:id`, `PATCH`, `DELETE` soft).

### 6. DP-permessi

`mandati.visualizza` / `mandati.gestisci` (catalogo 52 → 54). Admin-tier via
`ALL_PERMISSION_CODES`; **Collaboratore** riceve entrambi (gestisce già i
preventivi da cui i mandati derivano).

## Consequences

- I preventivi accettati hanno una prosecuzione formale tracciabile; la sidebar
  guadagna "Mandati", il preventivo accettato un pulsante "Crea mandato".
- `StatoPreventivo` ha un quinto valore `convertito` (escluso dal select di
  editing FE: lo imposta solo il backend).
- Timesheet + fatturazione restano deferiti; nessun campo inerte introdotto ora.

## Alternatives considered

- **`@@unique([preventivoId])` Prisma (full)** → scartato: bloccherebbe la
  ricreazione dopo soft-delete; il partial-unique soft-delete-aware è coerente
  col Pattern 42 già in uso (preventivi/scadenze/aziende).
- **FK preventivo `RESTRICT`** (legacy) → scartato: conflitti d'ordine col
  tenant-cascade; `Cascade` + soft-delete dei preventivi è più sicuro.
- **Flag `mandatoCreato` su preventivo invece di `convertito`** → scartato:
  `convertito` è semanticamente più chiaro e abilita il guard 1:1 naturale.
