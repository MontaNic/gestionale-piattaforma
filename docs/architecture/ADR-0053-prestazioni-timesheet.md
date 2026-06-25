# ADR-0053 — Prestazioni / Timesheet

**Data:** 2026-06-26
**Stato:** Accettato
**Provenienza:** Decisione Nicolò — Onda 3 Task 3; scope locked in sessione prima di STOP 2. Differito da ADR-0051 §8.

---

## Contesto

Il mandato (ADR-0051) traccia l'esecuzione di un incarico ma non le ore svolte.
Nel legacy betadesk (`65_rapporti_lavoro.sql`) il timesheet è `rapporti_prestazioni`
(la seconda tabella, deferita in ADR-0051 §8). Questa slice implementa la
registrazione ore; il **tariffario** (calcolo importo da ruolo/utente) è Task 3b
e la **fatturazione** è Task 4 — entrambi fuori scope.

---

## Decisioni

### 1. Pattern RLS

`Prestazione` è puro-tenant: **RLS FORCE standard** (policy `prestazioni_tenant_isolation`,
identica a `Mandato`/`Preventivo`). Nessuna riga platform.

### 2. Guard al CREATE: solo mandati `in_corso`

Una prestazione si aggiunge **solo** a mandati in stato `in_corso` (guard atomico
nel service → **400 `E_MANDATO_NOT_IN_CORSO`**). Su sospeso/concluso/annullato non
ha senso operativo registrare ore. Il mandato dev'essere in-scope (**404
`E_MANDATO_NOT_FOUND`**).

### 3. Update senza guard di stato

L'**update** NON ha il guard `in_corso`: le correzioni a posteriori (ore sbagliate,
descrizione) restano possibili anche su un mandato concluso. Il guard di stato è
una regola di _registrazione_, non di _integrità storica_.

### 4. `importo` manuale, nullable

`importo` Decimal(10,2) **nullable**: l'operatore lo inserisce a mano o lo lascia
vuoto. **Nessun calcolo automatico** in questa slice (niente tariffario). `ore`
Decimal(5,2) **obbligatorio**.

### 5. `userId` = autore, server-side

`userId` (FK→users SET NULL) = utente autenticato che registra, assegnato
**server-side** al create (non nel DTO). In questa slice non si sceglie "chi ha
svolto" diverso da chi inserisce.

### 6. `voceId` opzionale, validato

`voceId` (FK→preventivi_voci SET NULL) collega opzionalmente la prestazione a una
voce del preventivo. Se valorizzato, il service valida che la voce appartenga al
**preventivo del mandato** → **400 `E_PRESTAZIONE_VOCE_INVALID`** (impedisce di
agganciare voci di altri preventivi).

### 7. FK Cascade su mandato

`mandatoId` (FK→mandati **CASCADE**): eliminare/cancellare il mandato elimina le
sue prestazioni. `voceId`/`userId` **SET NULL** (la prestazione sopravvive se la
voce/utente spariscono). Soft-delete sulla prestazione (`deletedAt`).

### 8. Fatturazione deferita

`fatturato_at` / `fattura_id` del legacy **omessi** (non inerti, proprio assenti).
Arrivano con Task 4 (FIC/billing).

---

## Schema

```prisma
model Prestazione {
  id          String    @id
  tenantId    String    @map("tenant_id")
  mandatoId   String    @map("mandato_id")
  voceId      String?   @map("voce_id")
  userId      String?   @map("user_id")
  data        DateTime  @db.Date
  ore         Decimal   @db.Decimal(5, 2)
  descrizione String    @db.VarChar(500)
  fatturabile Boolean   @default(true)
  importo     Decimal?  @db.Decimal(10, 2)
  note        String?
  deletedAt   DateTime? @map("deleted_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")
  @@index([tenantId])
  @@index([mandatoId, data])
  @@map("prestazioni")
}
```

---

## API & Permessi

`GET/POST/PATCH/DELETE /mandati/:mandatoId/prestazioni[/:id]` — il timesheet è
**nested** sul mandato. Permessi **distinti** dai mandati: un praticante registra
ore senza poter gestire i mandati.

| Codice                   | Ruoli                                                     |
| ------------------------ | --------------------------------------------------------- |
| `prestazioni.visualizza` | Super Admin, Admin sede, Socio, Collaboratore, Praticante |
| `prestazioni.gestisci`   | Super Admin, Admin sede, Socio, Collaboratore, Praticante |

Totale permessi dopo questa slice: **56**.

---

## Conseguenze

- Il mandato in corso accumula ore; FE mostra lista + totali (ore + importo) nella
  pagina `/mandati/:id`.
- Il tariffario (Task 3b) potrà popolare `importo` automaticamente senza modifiche
  allo schema.
- La fatturazione (Task 4) aggiungerà i campi `fatturato_at`/`fattura_id`.

---

## Sub-DP

- **`voceId` nel form FE: omesso in questa slice** (BE-supported). Il select-voce
  richiederebbe il fetch del preventivo+voci del mandato → si aggiunge quando
  serve operativamente. L'endpoint accetta comunque `voceId`.

---

## Alternative considerate

- **Tariffario automatico (ore × tariffa-ruolo)** → rinviato a Task 3b/4: richiede
  un listino tariffe per ruolo/utente che non esiste ancora.
- **Guard `in_corso` anche su update** → scartato: bloccherebbe le correzioni
  legittime su mandati conclusi.
- **`prestazioni` come permesso unico riusando `mandati.gestisci`** → scartato:
  separare i permessi permette al praticante di registrare ore senza toccare i
  mandati.
