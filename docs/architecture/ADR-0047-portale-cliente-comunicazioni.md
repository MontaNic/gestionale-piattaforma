# ADR-0047 — Portale cliente (livello 2): comunicazioni bidirezionali reply-only

Status: Accepted
Date: 2026-06-23
Verticale: accountant (livello 2, utente-cliente)

## Context

[ADR-0043](ADR-0043-comunicazioni-module.md) ha costruito il modulo comunicazioni
**operatore-only**, lasciando esplicitamente dormiente il lato cliente:
`ComLato.cliente` esiste nell'enum ma l'operatore non può scriverlo
(`addMessaggio` rifiuta `lato='cliente'` con `E_COM_MSG_LATO_CLIENTE_FORBIDDEN`,
"riservato al portale"), e `ComMessaggio.autoreUserId` è nullable proprio perché
pre-portale non esisteva un utente cliente da valorizzare (trade-off negativo
dichiarato in ADR-0043).

[ADR-0046](ADR-0046-portale-cliente-foundation.md) ha posato le **fondamenta**
(identità `User.tipo=cliente` + `aziendaId`, login unico, route-group `/portale`,
namespace permessi `portale.*`) e il primo consumer dati,
[Documenti read-only](ADR-0046-portale-cliente-foundation.md) (Task 2). Le
comunicazioni sono il **Task 3**: la prima superficie portale **bidirezionale**
(il cliente non solo legge, ma scrive). Questo cambio di natura — reply,
read-tracking duale, ACL sulle note interne — giustifica un ADR dedicato anziché
un'estensione di ADR-0046 (che copre solo lettura).

**Autorità di design.** Come ADR-0046: la sorgente legacy
`docs/studiodesk/STUDIO_DESK.md` + i deferral di ADR-0043, non il
`PROJECT_BRIEF.md` (ristorazione).

## Decision

### 1. DP-scope — reply-only, niente apertura thread lato cliente

Il cliente **risponde** a thread esistenti aperti dallo studio; **non può aprire**
nuovi thread dal portale. L'apertura cliente-side è una funzione admin-azienda
(`clienteRuolo='admin'`) differita a un task futuro. Conseguenza: nessun endpoint
`POST /portale/comunicazioni` e nessuna generazione di `codice` lato cliente (il
counter per-tenant di ADR-0043 resta toccato solo dall'operatore). Il lato cliente
del Task 3 è quindi: **lista** dei thread della propria azienda + **dettaglio** +
**reply** (`lato=cliente`) + **read-tracking**.

### 2. DP-permessi — due permessi `portale.comunicazioni.*`

Coerente col namespace `portale.*` di ADR-0046 §6, due permessi distinti
read/write (più granulari del singolo `portale.documenti.visualizza`, perché qui
c'è una scrittura):

- `portale.comunicazioni.visualizza` — lista/dettaglio dei thread della propria
  azienda.
- `portale.comunicazioni.rispondi` — invio di un messaggio `lato=cliente`.

Entrambi `isPortale: true` → **esclusi** dai template studio ("tutti i permessi") e
aggiunti al role template **"Cliente"**. Un operatore non li ha → la
`PermissionsGuard` lo blocca a monte sugli endpoint `/portale/comunicazioni`.

### 3. DP-ACL — scoping per-azienda + esclusione note interne

Tre invarianti, applicati **app-level** nel service (l'RLS resta tenant-flat,
ADR-0046 §3), con `aziendaId` portato dal principal cliente:

- **Per-azienda**: ogni query cliente filtra `tenantId + aziendaId`. Un thread di
  un'altra azienda è indistinguibile da uno inesistente (404), niente leak per id
  indovinato (stesso pattern ACL-in-query dei documenti).
- **Note interne mai visibili**: il dettaglio cliente **esclude** i messaggi
  `lato=interno` (note tra operatori, ADR-0043). Filtro nella query dei messaggi,
  non lato presentazione → la nota interna non transita mai sul wire del portale.
- **Reply forza `lato=cliente`**: l'endpoint reply non accetta `lato` dal client
  (DTO con solo `testo`); il service scrive sempre `cliente`. Specularmente al
  divieto operatore (`lato=cliente` vietato lato studio), qui `studio`/`interno`
  sono impossibili da iniettare.

### 4. DP-autore — `autoreUserId` valorizzato (chiude il trade-off ADR-0043)

Ora che esiste l'identità cliente (ADR-0046), la reply lato cliente valorizza
`ComMessaggio.autoreUserId` con lo `User.id` del cliente autenticato. Questo
**risolve** il trade-off negativo di ADR-0043 (`autoreUserId` NULL pre-portale):
da qui in avanti i messaggi cliente nati dal portale sono attribuiti. I messaggi
cliente storici (pre-portale, se mai creati con `apertaDa=cliente` dall'operatore)
restano NULL — `lato=cliente` resta il discriminatore robusto, non `autoreUserId`.

### 5. DP-read-tracking — duale di `markLettoStudio`

ADR-0043 ha `markLettoStudio` (lo studio marca letti i messaggi `lato=cliente`).
Il Task 3 aggiunge il **duale** `markLettoCliente`: il cliente marca
`lettoCliente=true` i messaggi `lato=studio` non ancora letti. I `lato=interno`
non entrano (`lettoCliente` nasce già `true` per le note, ADR-0043 `readFlagsFor`).
Endpoint dedicato `PATCH .../letto-cliente` (idempotente, `updateMany`), gemello
del `POST :id/letto` operatore.

### 6. DP-controller — controller portale separato, stesso service

Stesso pattern di ADR-0046 (Documenti): un secondo controller
`PortaleComunicazioniController` (`/portale/comunicazioni`) accanto a quello
operatore, **entrambi sul medesimo `ComunicazioniService`**. I metodi cliente
(`listForCliente`/`getForCliente`/`replyCliente`/`markLettoCliente`) sono nuovi e
distinti da quelli operatore: nessun ramo `if (cliente)` dentro i metodi
esistenti. Il controller restringe il principal a un cliente con azienda
(`assertCliente`, type-safe `aziendaId: string`), ridondante con RBAC + CHECK DB
ma fail-closed (stesso `assertCliente` di `PortaleDocumentiController`).

### 7. DP-view — viste cliente denormalizzate (no leak interni)

Come `ClienteDocumentoView`, il service restituisce viste cliente-specifiche, non
le entity Prisma:

- **`ClienteComunicazioneListView`**: `id`, `codice`, `oggetto`, `chiusa`,
  `updatedAt`, `nonLetti` (conteggio messaggi `lato=studio` con
  `lettoCliente=false`). Niente `operatoreAssegnatoId`/`urgente`/`referenteId`
  (campi di triage interno).
- **`ClienteComunicazioneDetailView`**: testata + `messaggi[]` (solo
  `studio`/`cliente`) con `{ id, lato, testo, createdAt, allegati[] }`. **No
  `autoreUserId`/`tenantId`** sul wire.

## Consequences

### Positive

- Prima superficie portale bidirezionale: il cliente partecipa al thread tracciato.
- Chiude il trade-off `autoreUserId` NULL di ADR-0043 per i messaggi nati dal portale.
- ACL note-interne in-query: una nota `lato=interno` non lascia mai il backend.
- Zero migration: lo schema ADR-0043 + l'identità ADR-0046 bastano.

### Negative / Trade-off

- Reply text-only: il cliente non può ancora allegare file (vedi backlog). Vede i
  nomi degli allegati dello studio ma non li scarica dal portale (no endpoint
  download portale in questo task).
- Apertura thread lato cliente assente: per un nuovo argomento il cliente deve
  oggi farsi aprire il thread dallo studio (accettato, è funzione admin-azienda).

### Neutral

- Read-tracking simmetrico (`lettoStudio`/`lettoCliente`) ora ha entrambi i lati
  attivi; nessuno schema nuovo, solo il secondo `updateMany`.

## Out of scope — backlog (NON implementati)

Apertura thread lato cliente (admin-azienda) · upload allegati lato cliente ·
download allegati via portale · notifiche (email/push) di nuovo messaggio ·
indicatore "sta scrivendo"/realtime · reazioni.

## Tech debt

- **TD-portale-com-allegati**: upload + download allegati lato cliente (oggi il
  cliente vede i nomi ma non scarica dal portale; l'upload è operatore-only).
- **TD-portale-com-apertura**: apertura nuovo thread lato cliente, gated su
  `clienteRuolo='admin'`.
- **TD-portale-com-notifiche**: notifica al cliente all'arrivo di un messaggio
  studio (dipende dal framework email/notifiche multi-tenant, vedi ADR-0045 §6).

## Notes

Nessuna migration (schema invariato). Seed: due permessi
`portale.comunicazioni.visualizza` / `portale.comunicazioni.rispondi` +
aggiunta al role template "Cliente" (che già ha `portale.documenti.visualizza`).
Verifica runtime col cliente demo `cliente@studio-demo.local` di ADR-0046.
