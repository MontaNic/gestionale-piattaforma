# Note Spese v1 — Spec consolidata (base + rev.2 applicata)

**Provenienza**: ricostruita da `MT_Accountant_S18` (2026-07-17) — spec base §1-§3 + delta rev.2 D1-D7 applicati. La spec viveva solo in chat: questo documento la persiste (Commit 0 di PR-1).

**Perimetro di questo documento: PR-1 (schema + migrazione + permessi).** Le sezioni §4 (regole di business complete), §5/§6 (API/service), §7 (lista test) **non sono state recuperate integralmente** — vanno recuperate dalla stessa conversazione **prima di PR-2**. Ciò che segue è sufficiente e fedele per PR-1.

---

## 1. Scope (recuperato)

**In scope v1**: attori = **solo `User.tipo = operatore`** del tenant. CRUD nota spese + allegati, workflow stati, pannello approvazione interno.

**Fuori scope esplicito** (deferral trigger-gated, non dimenticanze):

- **Client Portal / visibilità cliente-esterno** — trigger: primo cliente che richiede accesso diretto, o decisione preventiva dell'orchestratore. Costo quando triggerato: BASSO/incrementale (segue pattern `portale-*` esistente: `assertCliente` + namespace `portale.*` + scoping app-layer per `aziendaId`). Nessun redesign auth né RLS. Registrare in ADR.
- **OCR / pre-compilazione / RAG match cliente-incarico** — Pattern 43: nessun consumer, e `GroqService` è text-completion (serve provider vision). Trigger: decisione esplicita sul provider vision.
- Multi-valuta (EUR assunto, nessuna colonna currency).
- Workflow approvazione multi-livello / step configurabili.
- Export contabile.
- **`File` model condiviso** — confermato R1: pattern per-dominio. Non toccare `Documento`/`ComAllegato`.

---

## 2. Schema Prisma

### 2.1 Enum (6, tutti nuovi — collision check eseguito)

`StatoNotaSpesa` (bozza/inviata/approvata/respinta), `MetodoPagamentoNotaSpesa` (contanti/carta_aziendale/carta_personale/bonifico), `TipoSpesa` (vitto/alloggio/trasporto/carburante/pedaggio/parcheggio/rappresentanza/formazione/cancelleria/altro), `AliquotaIvaNotaSpesa` (iva_22/iva_10/iva_4/esente/non_applicabile), `DeducibilitaFiscale` (d_100/d_75/d_50/d_0), `TipoAllegatoNotaSpesa` (giustificativo/scontrino_pos).

**D3 (rev.2, chiusa)**: suffissi domain-specific **mantenuti**. `TipoSpesa` e `DeducibilitaFiscale` restano nudi (nessuna collisione).

### 2.2 Model `NotaSpesa` — con D1, D2, D5, D7 applicati

Campi: `id` (D1: nessun `@default` → `id: id()` app-side UUID v7), `tenantId`, `userId` (FK → User tipo=operatore, MAI Azienda), `data` (@db.Date), `aziendaId?` (NULL = commessa interna), `mandatoId?`, `tipoSpesa`, `metodoPagamento`, `totale` (Decimal 10,2), `aliquotaIva`, `deducibilitaFiscale`, `fatturataASocieta` (Boolean default false), `distanzaKm?` (Decimal 8,2), `scopoMissione` (String), `note?`, `stato` (default bozza), audit workflow (`inviataAt?`, `decisaAt?`, `decisaDaId?` FK → User approvatore, `motivoRifiuto?`), `createdAt`, `updatedAt`. Indici `@@index([tenantId, userId, data])` + `@@index([tenantId, stato])`. `@@map("note_spese")` (D2: plurale).

**D5 (rev.2)**: **nessun `deletedAt`** — hard-delete, divergenza **intenzionale**:

- `DELETE` consentito **solo** in stato `bozza`; una bozza non ha valore probatorio/fiscale.
- Note `inviata`/`approvata`/`respinta` non eliminabili per state machine → nessun record fiscale distrutto.
- L'allegato **deve** essere hard-deleted (un `deletedAt` lascerebbe l'oggetto orfano in storage o richiederebbe un reaper).
- `soft-delete.ts` auto-rileva via DMMF i model con `deletedAt`: l'assenza è safe, nessun intercept. **Verificato in review.**
- Aggiungere `deletedAt` in futuro è additivo (tier BASSO).

### 2.3 Model `NotaSpesaAllegato` — child table (decisione lockata)

Campi: `id` (D1), `tenantId`, `notaSpesaId`, `tipo`, `storageKey` (chiave opaca StorageService), `nomeOriginale`, `mimeType`, `dimensione` (Int), `createdAt`. Relazione `notaSpesa NotaSpesa @relation(onDelete: Cascade)`. `@@unique([notaSpesaId, tipo])` (max 1 giustificativo + 1 scontrino POS per nota). `@@map("note_spese_allegati")` (D2: plurale).

**Pattern 42**: `@@unique([notaSpesaId, tipo])` è additivo su tabella nuova, nessun dato preesistente → **nessun duplicate-check operativo necessario**. Confermato esplicitamente in STOP 2.

### 2.4 RLS

- `FORCE` su **entrambi** i model, **USING-only**, `tenant_id` TEXT nel branch super-admin.
- `tenantId` denormalizzato anche su `NotaSpesaAllegato`: **necessario**, l'RLS è per-tabella e non segue la FK.
- `$allOperations` in `rls.ts` copre già gli aggregati → **nessuna modifica a `rls.ts`**.

### 2.5 D7 — Back-relations (additive su model esistenti)

`User.noteSpese NotaSpesa[] @relation("NotaSpesaAutore")`, `User.noteSpeseDecise NotaSpesa[] @relation("NotaSpesaApprovatore")`, `Azienda.noteSpese NotaSpesa[]`, `Mandato.noteSpese NotaSpesa[]`.

**`User` è shared cross-verticale** — additivo puro (relazione inversa, nessuna colonna nuova, nessuna ALTER).

---

## 3. Permessi — 60 → 63

| code                    | descrizione                                       |
| ----------------------- | ------------------------------------------------- |
| `notespese.gestisci`    | crea/modifica/elimina/invia **le proprie** note   |
| `notespese.leggi_tutte` | visualizza le note di tutti gli utenti del tenant |
| `notespese.approva`     | approva/respinge note altrui                      |

Categoria: `notespese`. Nessuno è `isPortale` → rientrano in `ALL_PERMISSION_CODES` → Super Admin li riceve automaticamente.

**Assegnazione a ruoli template**: non recuperata in questo estratto → **STOP e chiedi** prima di toccare il seed oltre l'array `PERMISSIONS`.

---

## 4. Regole di business — recuperate solo parzialmente (per PR-2)

**D4 (rev.2, chiusa)** — `distanzaKm` fuori da trasporto/carburante: **soft-warning FE, nessuna validazione BE**.

**D6 (rev.2, chiusa)** — Coerenza `aziendaId` ↔ `mandatoId`: **hard-fail BE** (integrità referenziale, non euristica):

- Se `mandatoId` valorizzato → `aziendaId` **obbligatorio** e uguale a `mandato.aziendaId`.
- Violazione → fail-fast `E_NOTASPESA_MANDATO_AZIENDA_MISMATCH`.
- Se `mandatoId` NULL → `aziendaId` libero (valorizzato o NULL = commessa interna).
- Non enforceabile via FK → validazione nel **service**, su `create` **e** `update`.

Altre regole (giustificativo obbligatorio se totale>0; scontrino se metodo ∈ carta\_\*; §4.1-§4.6) **non recuperate** → PR-2.

---

## 5. Da recuperare prima di PR-2

Dalla stessa conversazione `MT_Accountant_S18`: §4 completo, §5/§6 (API/service/DTO), §7 (i 14 test), §8-§9 se presenti. **Non implementare PR-2 senza.**
