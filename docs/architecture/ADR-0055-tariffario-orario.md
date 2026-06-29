# ADR-0055 — Tariffario orario

**Data:** 2026-06-29
**Stato:** Accettato
**Provenienza:** Decisione Nicolò — Onda 4 Task 3b; scope locked in sessione (STOP 0). Sblocca il TD-tariffario di ADR-0053/0054.

---

## Contesto

Le prestazioni (ADR-0053) registrano ore sui mandati con `importo` **manuale e
nullable**: senza un listino di costo, `importoPrestazioni`/`margine` del report
(ADR-0054) restano spesso `null`. Questo task introduce un **tariffario orario**:
un costo orario per ruolo (default) o per utente (override) da cui derivare
automaticamente `Prestazione.importo` (`ore × tariffa`). ADR-0053 §future
prevedeva esplicitamente che ciò avvenga **senza modifiche** a `Prestazione` né
all'endpoint report.

---

## Decisioni

### 1. Tariffa = COSTO orario interno

La tariffa rappresenta il **costo** del tempo dell'operatore (non un prezzo di
vendita): coerente con `margine = importoConcordato − importoPrestazioni`
(ADR-0054), dove `importoPrestazioni` è trattato come costo.

### 2. Scope esclusivo ruolo XOR utente

Un solo modello `TariffaOraria` (`tariffe_orarie`) con `roleId?`/`userId?`:
esattamente uno valorizzato. Invariante via **CHECK** raw SQL
`(role_id IS NOT NULL) <> (user_id IS NOT NULL)` (Prisma 6 non esprime i CHECK).
"Un listino" = una superficie CRUD, un permesso.

### 3. Risoluzione: override-utente → ruolo (più alta) → null

Alla create/update della prestazione `resolveTariffaOraria(tenantId, userId)`:

1. tariffa **utente** attiva, se presente; altrimenti
2. tariffa **ruolo**: tra i ruoli dell'autore (`user_roles`, raggiungibile sotto
   RLS via EXISTS-join su `roles.tenant_id`), la **più alta** se più di una
   (tie-break confermato — costo più senior; warning loggato);
3. `null` → `importo` resta `null` (comportamento odierno invariato).

### 4. Derivazione di `importo`, niente modifiche a `Prestazione`

Precedenza: **`importo` esplicito > derivato (`ore × tariffa`) > null**. Applicata
in `PrestazioniService` su **create** e su **update quando `ore` cambia** e
`importo` non è fornito. Snapshot a livello di scrittura (coerente col pattern
PreventivoVoce). Nessuna colonna nuova su `Prestazione`, nessuna modifica
all'endpoint `GET /report/margine`.

### 5. Partial-unique soft-delete-aware

Al più una tariffa **attiva** (`deleted_at IS NULL`) per `(tenant_id, role_id)` e
per `(tenant_id, user_id)` — raw SQL (Pattern 42, ADR-0023). Soft-delete (mai
`.delete()`): dopo cancellazione si può ridefinire lo stesso scope.

### 6. Permesso dedicato `tariffario.*`, riservato al vertice

Nuova categoria `tariffario` (`visualizza`/`gestisci`), baseline 56 → **58**. I
dati di costo sono sensibili (≈ retribuzioni) → assegnati **solo** ai ruoli con
`ALL_PERMISSION_CODES` (Super Admin / Admin sede / Socio); **non** a
Collaboratore/Segreteria/Praticante. La derivazione dell'importo è server-side e
**non** richiede il permesso (l'operatore registra ore senza vedere il listino).

### 7. Endpoint lookup per i picker FE

`GET /tariffe/roles` e `GET /tariffe/users` (gated `tariffario.gestisci`) per i
dropdown del form: nell'accountant-api non esiste un'area di gestione RBAC, quindi
i lookup vivono nel `TariffeModule` (feature self-contained). Dichiarati **prima**
di `:id` per evitare la collisione di route.

### 8. Niente backfill storico

Le prestazioni esistenti con `importo = null` non sono ricalcolate: manca lo
snapshot del ruolo-all'epoca. La derivazione vale per le prestazioni nuove (e per
gli update che cambiano `ore`). Eventuale script one-shot separato.

---

## Schema

```prisma
model TariffaOraria {
  id            String    @id
  tenantId      String    @map("tenant_id")
  roleId        String?   @map("role_id") // scope=ruolo (default) ⟺ user_id NULL
  userId        String?   @map("user_id") // scope=utente (override) ⟺ role_id NULL
  tariffaOraria Decimal   @map("tariffa_oraria") @db.Decimal(10, 2)
  attivo        Boolean   @default(true)
  note          String?
  deletedAt     DateTime? @map("deleted_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  // tenant/role/user FK onDelete: Cascade
  @@map("tariffe_orarie")
}
```

Migration `20260629090933_add_tariffe_orarie`: CREATE TABLE + RLS FORCE (policy
`tariffe_orarie_tenant_isolation`) + CHECK XOR + 2 partial-unique (raw SQL).

---

## API & Permessi

| Metodo | Rotta                              | Permesso                |
| ------ | ---------------------------------- | ----------------------- |
| GET    | `/tariffe`                         | `tariffario.visualizza` |
| POST   | `/tariffe`                         | `tariffario.gestisci`   |
| GET    | `/tariffe/roles`, `/tariffe/users` | `tariffario.gestisci`   |
| GET    | `/tariffe/:id`                     | `tariffario.visualizza` |
| PATCH  | `/tariffe/:id`                     | `tariffario.gestisci`   |
| DELETE | `/tariffe/:id` (soft)              | `tariffario.gestisci`   |

Error code: `E_TARIFFA_SCOPE_INVALID`, `E_TARIFFA_ROLE_NOT_FOUND`,
`E_TARIFFA_USER_NOT_FOUND`, `E_TARIFFA_DUPLICATA` (409), `E_TARIFFA_NOT_FOUND`.

---

## Conseguenze

- Il report margine (ADR-0054) si popola automaticamente man mano che si
  definiscono le tariffe; gli **insight AI margine** (deferiti ADR-0054 §7)
  diventano sensati su dati completi.
- Lo scope della tariffa è **immutabile** in modifica (cambio ruolo/utente =
  soft-delete + nuova tariffa): si modificano solo importo/attivo/note.
- FE: pagina `/tariffario` (gated, voce sidebar filtrata per permesso) + hint
  "calcolato dal tariffario se vuoto" sul campo importo della prestazione.

---

## Alternative considerate

- **Tariffa sul catalogo servizi (`ServizioCatalogo.prezzoBase`)** → scartata:
  `prezzoBase` è prezzo di vendita per forfait/preventivo, non costo orario.
- **Solo per ruolo / solo per utente** → scartate a favore di ruolo+override
  (copre "tariffa standard di ruolo" e l'eccezione del singolo).
- **Tie-break "più bassa" / multi-ruolo come errore** → scartati: la più alta è
  prudenziale (costo più senior) e deterministica; il multi-ruolo è raro ma non
  deve far fallire la registrazione ore.
- **Ricalcolo live nel report** (non snapshot) → scartato: lo snapshot a
  write-time congela il costo storico (coerenza PreventivoVoce) e lascia
  l'endpoint report invariato.
- **Tariffe temporali (validità dal/al)** → rinviate: non servono per la prima
  versione.
