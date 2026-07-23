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

## 4. Regole di business

**§4.1-§4.4 — ricostruiti dai test §7 (non verbatim):**

1. **Giustificativo obbligatorio** se `totale > 0`. Blocca la transizione `bozza → inviata` (test §7.5). Il documento deve riportare data, importo, ragione sociale/P.IVA esercente. Accettati: scontrino fiscale, ricevuta fiscale, fattura. Non accettati: conferma d'ordine, preventivo, screenshot app senza dettaglio esercente. _(Il vincolo tecnico è il blocco di transizione; la guida su cosa sia valido è testo FE.)_
2. **Scontrino POS obbligatorio** solo se `metodoPagamento ∈ {carta_aziendale, carta_personale}`. Blocca `bozza → inviata` (test §7.6). Non richiesto per contanti/bonifico.
3. **State machine**: `bozza → inviata → approvata | respinta`; `respinta → bozza`. Transizioni non consentite falliscono (`approvata → *`, `bozza → approvata`) (test §7.7).
4. **Immutabilità**: nota `inviata`/`approvata` non modificabile — né campi né allegati (test §7.8). Modifica solo in `bozza`/`respinta`.
5. **Auto-approvazione vietata**: `decisaDaId === userId` → errore (test §7.4).

**§4.5 — verbatim:** il BE accetta qualunque valore valido dell'enum. **Nessuna regola fiscale nel service** (`deducibilitaFiscale` resta scelta dell'operatore; nessun default hardcodato BE).

**§4.6 — verbatim + D4:** `distanzaKm` accettato solo con `tipoSpesa ∈ {trasporto, carburante}` → **soft**: se valorizzato altrove, warning FE, **nessun blocco BE**. Il BE resta validatore puro di tipo/enum.

**§4.7 — D6 rev.2 (hard-fail BE):** coerenza `aziendaId` ↔ `mandatoId` (integrità referenziale):

- `mandatoId` valorizzato → `aziendaId` **obbligatorio** e uguale a `mandato.aziendaId`.
- Violazione → fail-fast `E_NOTASPESA_MANDATO_AZIENDA_MISMATCH`.
- `mandatoId` NULL → `aziendaId` libero (valorizzato o NULL = commessa interna).
- Non FK-enforceable → validazione nel **service**, su `create` **e** `update`.

---

## 5. Storage (verbatim)

- `StorageService` (token DI astratto, ADR-0043). **Non** toccare `LocalFilesystemStorageService`.
- Cap: riusare `STORAGE_MAX_UPLOAD_BYTES` (20MB). **Nessuna costante nuova.**
- **Allow-list MIME locale al modulo** (R2): `application/pdf`, `image/jpeg`, `image/png`, `image/webp`. Validata nel controller (`FileInterceptor` fileFilter) **e** nel service. Nessun helper condiviso (Pattern 43).
- `mimeType` persistito = quello **verificato**, non quello dichiarato dal client.
- Delete allegato → `StorageService.delete(storageKey)` + row delete, **stessa transazione applicativa**. Su nota `bozza` eliminata: cascade DB + **cleanup storage esplicito nel service** (il cascade Prisma non pulisce il filesystem).
- Compressione immagini **client-side** (FE, nessun impatto BE).

---

## 6. API surface (verbatim) — `accountant-api`, prefix `api/v1`

```
POST   /note-spese                      notespese.gestisci
GET    /note-spese                      notespese.gestisci (proprie) | +leggi_tutte (tutte)
GET    /note-spese/:id                  come sopra + ownership check
PATCH  /note-spese/:id                  notespese.gestisci + autore + stato ∈ {bozza, respinta}
DELETE /note-spese/:id                  notespese.gestisci + autore + stato = bozza
POST   /note-spese/:id/invia            notespese.gestisci + autore
POST   /note-spese/:id/approva          notespese.approva
POST   /note-spese/:id/respingi         notespese.approva (motivo obbligatorio)

POST   /note-spese/:id/allegati         notespese.gestisci + autore + stato ∈ {bozza, respinta}
GET    /note-spese/:id/allegati/:aid    stream, ownership o leggi_tutte
DELETE /note-spese/:id/allegati/:aid    notespese.gestisci + autore + stato ∈ {bozza, respinta}
```

Query param lista: `?mese=YYYY-MM`, `?stato=`, `?userId=` (solo con `leggi_tutte`), `?aziendaId=`.

**Filtro `userId` app-layer non bypassabile**: senza `leggi_tutte`, il service **forza** `userId = currentUser.id` ignorando il query param. **Test dedicato — non basta GATE verde.**

---

## 7. Test richiesti (verbatim) — security-sensitive, test dedicati

1. Utente A **non** legge/modifica/elimina la nota di utente B (senza `leggi_tutte`).
2. Query param `?userId=<B>` **ignorato** se manca `leggi_tutte`.
3. Cross-tenant: nota di tenant X invisibile a tenant Y (RLS).
4. Auto-approvazione respinta (`decisaDaId === userId` → errore).
5. `bozza → inviata` fallisce senza giustificativo con `totale > 0`.
6. `bozza → inviata` fallisce senza scontrino POS se `metodoPagamento` = carta.
7. Transizioni non consentite falliscono (`approvata → *`, `bozza → approvata`).
8. Nota `inviata`/`approvata` non modificabile (campi + allegati).
9. Upload MIME non in allow-list → rifiutato.
10. Upload > 20MB → rifiutato.
11. `@@unique([notaSpesaId, tipo])` → secondo giustificativo rifiutato.
12. Delete allegato rimuove **anche** l'oggetto dallo storage.
13. `mandatoId` di un'azienda ≠ `aziendaId` dichiarato → rifiutato.
14. `mandatoId` valorizzato con `aziendaId = NULL` → rifiutato.

**Totale 14.** Test §7.3 cross-tenant DB-level già coperto dallo spec RLS raw-query di PR-1; a livello HTTP si aggiunge la variante 404 cross-tenant (load-then-authorize).

**Fasatura backend**: PR-2 = test 1,2,3(HTTP),9,10,11,12,13,14 (CRUD + storage). PR-3 = test 4,5,6,7,8 (state machine).

---

## 8. Frontend (verbatim) — `accountant-web` (PR-4/5)

- Toggle **calendario mensile** ↔ **elenco raggruppato per data**. Layout responsive due colonne ~860px.
- Form nota: upload separati giustificativo/scontrino POS, **hint di validità inline**. Badge **non bloccante** su nota con `totale > 0` e giustificativo mancante.
- Pannello approvazione: vista separata, gated su `notespese.approva`. Compressione immagini client-side.

---

## 9. Split commit / PR (verbatim)

1. `feat(db): schema + enum + RLS` — **FATTO PR-1 (#176)**.
2. `feat(db): permessi + role template` — array PR-1; **role template PR-2**.
3. `feat(accountant-api): modulo note-spese` — **PR-2** (CRUD+allegati) / **PR-3** (state machine).
4. `test(accountant-api): security + state machine` — split PR-2/PR-3.
5. `feat(accountant-web): UI + pannello approvazione` — PR-4/5.

---

## 10. Decisioni (chiuse da rev.2)

- **D3**: suffissi enum mantenuti. **D4**: `distanzaKm` soft-warning FE.
- **Assegnazione ruoli** (decisa PR-2): `notespese.gestisci` → Collaboratore + Direzione; `notespese.leggi_tutte` → Direzione; `notespese.approva` → Direzione; Cliente → nessuno (Client Portal deferito).
