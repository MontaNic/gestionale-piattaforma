# ADR-0044 — Modulo Documenti: scambio documenti studio↔cliente

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** ADR-0043 (Comunicazioni — pattern replicato; `TD-storage-platform` qui chiuso), ADR-0039 (scadenze — pattern tipi platform/custom), ADR-0023 (partial-unique soft-delete), ADR-0009 (RLS reali). Modello dati riusato da StudioDesk PHP (`docs/studiodesk/sql/05_documenti.sql`), **non** il codice.

## Context

Il verticale commercialisti ha bisogno di un archivio documenti tracciato per lo scambio studio↔cliente (F24, CU, bilanci, fatture, documenti d'identità, ecc.), distinto dagli allegati di chat (`com_allegati`, legati al thread di comunicazione).

**⚠️ Provenienza dello scope (dichiarata):** le decisioni di scope MVP di questo ADR derivano da una **product-interview del 10/06** (memoria di sessione), **NON dal `PROJECT_BRIEF.md`**. Verifica eseguita a STOP 1: l'unica sezione `### Documenti` del BRIEF riguarda i **documenti fiscali della ristorazione** (preconto, scontrino, fattura elettronica) — nulla sul modulo documenti accountant. Il BRIEF è quindi **muto** sul tema: le esclusioni MVP qui sotto non lo contraddicono, ma non hanno copertura nel BRIEF versionato. Questo ADR è la fonte autoritativa dello scope finché il BRIEF non lo recepisce.

## Decision

### 1. Modello dati — 2 tabelle (MVP)

- **`DocumentoTipo`**: catalogo tipi. `tenantId` nullable (NULL = platform immutabile, valorizzato = custom per-tenant), `nome`, `direzione` (studio_cliente|cliente_studio|bidirezionale), `visibilitaDefault`, `ordine`, `attivo`. **NIENTE RLS** (le righe platform hanno tenant_id NULL → una policy per-tenant ne romperebbe la lettura): scoping **applicativo** `tenantId IS NULL OR tenantId = current` + partial-unique sulle custom (pattern `ScadenzaCategoria`, ADR-0039). Seed: **16 tipi base** del PHP (platform, find-then-create idempotente per `nome`).
- **`Documento`**: file reali. `tipoId`/`aziendaId` (FK), `nomeOriginale`, **`storageKey`** (chiave opaca dello StorageService, MAI path nudo), `mimeType`, `dimensione`, `visibilita`, `note?`, `createdBy` (user interno), soft-delete. **RLS+FORCE flat** (tenant_id diretto, forma reale repo — TEXT, no cast).

### 2. Enum

- **`VisibilitaDocumento` = `tutti` | `azienda` soltanto.** Il valore `utente` (targeting per-utente cliente) del PHP è **escluso** dall'MVP: richiede il portale cliente (livello 2) e una colonna `user_id` target. Forma copiata da `VisibilitaScadenza` ma **identità separata** (YAGNI sull'unificazione). Vedi TD utente-enum sotto.
- **`DirezioneDocumento`** = studio_cliente | cliente_studio | bidirezionale.

### 3. Storage — StorageService graduato (chiude TD-storage-platform)

Documenti è il **2° consumer** di storage → la `TD-storage-platform` di ADR-0043 è chiusa: `StorageService` (astratto) + `LocalFilesystemStorageService` + `StorageModule` + spec di traversal sono stati **graduati da `apps/accountant-api` a `packages/platform`** (commit 1 del branch, refactor isolato e reversibile). Move puro, sanitizzazione anti-traversal invariata, GATE anti-regressione su Comunicazioni verde. Upload/download di Documenti consumano il token astratto da `@gestionale/platform`; `storageKey` opaca, file fuori dal docroot, cap 20MB.

### 4. Permessi e UI

- **+2 permessi** `documenti.gestisci` / `documenti.visualizza` (catalogo 39 → 41), forma imperativa. Mapping: Socio (tutti), Collaboratore + Segreteria (gestione), Praticante (sola visualizza).
- **UI solo operatore** (accountant-web): archivio filtrabile (azienda/tipo/visibilità), upload (tipo + azienda + visibilità + file + note), download (blob, Bearer), soft-delete. **Nessuna UI cliente** (livello 2).

### 5. Download — load-then-authorize + `visibilita` NON è una ACL in F1

Il download è il punto sensibile del modulo (l'analogo dell'anti-traversal per lo storage). Pattern **load-then-authorize**: l'endpoint `GET /documenti/:id/download` accetta **solo l'id del documento**, MAI lo `storageKey`; il service esegue `findFirst({ id, tenantId })` sotto contesto RLS e, se la riga non appartiene al tenant del chiamante, ritorna **404 PRIMA di toccare lo StorageService** → nessun IDOR cross-tenant. Doppia barriera: filtro applicativo esplicito `where:{tenantId}` + RLS+FORCE. Coperto da `documenti-download-isolation.e2e-spec.ts` (sentinella service-level: `getForDownload(tenantB, docA)` → throws `E_DOCUMENTO_NOT_FOUND`).

**⚠️ Assunzione dichiarata (per non scambiarla per un bug tra sei mesi):** il download **non filtra per `visibilita`**, ed è intenzionale. Nell'MVP **solo-operatore**, `visibilita` (tutti|azienda) **non è una ACL tra operatori dello stesso studio** — è **metadato di routing per il futuro portale cliente**. Qualunque operatore del tenant (con `documenti.visualizza`) scarica qualunque documento del **proprio** tenant; l'isolamento esercitato è quello **cross-tenant**, che è pieno. **L'enforcement per-cliente di `visibilita` nasce col portale** (livello 2), insieme al valore `utente` dell'enum e alla colonna `user_id` target (vedi TD-utente-enum-forward). Provenienza dell'assunzione: product-interview 10/06, come lo scope.

### 6. DP risolti

- **DP-tipi-RLS:** confermato pattern `ScadenzaCategoria` — `documenti_tipi` senza RLS, scoping applicativo, partial-unique `(tenant_id, nome) WHERE tenant_id IS NOT NULL`.
- **DP-codice:** la tabella `documenti` del PHP **non ha** codice univoco (solo id + uuid storage key) → **nessun counter** (a differenza di Comunicazioni). Il `codice` del PHP è sul _tipo_, non sul documento.
- **DP-permessi:** +2 → 41, mapping come sopra.
- **RLS isolation** verificata: tenant A inserisce un documento, tenant B legge 0, A rivede 1.

## Consequences

### Positive

- Archivio documenti isolato per tenant (RLS+FORCE su `documenti`).
- Storage finalmente condiviso (`packages/platform`) — riuso cross-vertical senza duplicazione.
- Tipi platform + custom estendibili dallo studio.

### Negative / Trade-off

- `visibilita` è metadato di routing per il futuro portale: in F1 l'operatore vede tutto, l'ACL per-cliente arriverà col livello 2.
- Scope non BRIEF-backed (vedi Context): rischio di drift se il BRIEF in futuro dice altro → questo ADR va riconciliato.

## Out of scope — backlog (NON implementati)

- **`documenti_letture`** (ricevute lettura con ip/ua) → richiede portale cliente.
- **`documenti_user_state`** (archivia/elimina lato cliente) → richiede portale cliente.
- **`documenti_tipi_campi`** (modelli con schema campi JSON, gen da template) → fase 6C PHP, slice futura.
- **`password_hash`** per-documento → fuori MVP (l'ACL di visibilità basta).
- **`scade_il` + avvisi** documenti in scadenza (cron-alert) → collegamento cross-modulo Scadenze, slice futura.
- **cron-gc-documenti** (garbage collection file orfani su storage dopo soft-delete) → ops futura.

## Tech debt

- **TD-documenti-tipo-codice** — `DocumentoTipo` ha solo `nome` (no chiave macchina stabile, a differenza del `codice` del PHP). Accettabile in MVP perché nessun consumer referenzia un codice macchina. Quando arriverà la **fase 6C** (modelli con schema campi / questionari che referenziano i tipi per codice stabile), va aggiunto un `codice` macchina a `DocumentoTipo`.
- **TD-utente-enum-forward** — `VisibilitaDocumento` non ha `utente`. Quando nascerà il **portale cliente** (livello 2), aggiungere il valore `utente` all'enum + una colonna `user_id` target su `Documento` per il routing per-utente.
- **TD-storage-gc** — il soft-delete di un `Documento` NON rimuove il file su storage. Serve una garbage collection (cron) per gli orfani (vedi backlog).

## Notes

- Migration: `packages/db/prisma/migrations/20260620120105_add_documenti/` (tabelle + FK + RLS+FORCE su `documenti` + partial-unique su `documenti_tipi`).
- Backend: `apps/accountant-api/src/documenti/`. Storage: `packages/platform/src/storage/`.
- Frontend: `apps/accountant-web/src/app/t/[slug]/(authenticated)/documenti/` + `components/documenti/` + `lib/documenti-{types,api}.ts`.
