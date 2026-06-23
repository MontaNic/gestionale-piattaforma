# ADR-0048 — Portale cliente (livello 2): lettore circolari + presa-visione

Status: Accepted
Date: 2026-06-23
Verticale: accountant (livello 2, utente-cliente)

## Context

[ADR-0045](ADR-0045-circolari-mvp.md) ha costruito il modulo circolari
**operatore-only** (broadcast unidirezionale studio→clienti: autoring +
macchina di stato bozza→pubblicata→archiviata), lasciando esplicitamente
dormiente il lato cliente. Tre cose erano **DEFER al livello 2** (ADR-0045 §6 +
Tech debt): il campo `richiede_conferma` sulla testata, la tabella
`circolari_letture` (tracking lettura/conferma per-utente), e l'intera superficie
cliente (read / markLetta / conferma). Senza un lettore cliente sarebbero stati
campi/tabelle morti — coerente col principio "niente feature senza consumer reale".

[ADR-0046](ADR-0046-portale-cliente-foundation.md) ha posato le fondamenta
(identità `User.tipo=cliente` + `aziendaId`, login unico, route-group `/portale`,
namespace permessi `portale.*`) e il primo consumer dati (Documenti read-only);
[ADR-0047](ADR-0047-portale-cliente-comunicazioni.md) ha aggiunto la prima
superficie bidirezionale (comunicazioni reply-only). Le circolari sono il consumer
successivo: una superficie **read + presa-visione**. La lettura è simile ai
documenti (read-only per-azienda), ma la **conferma** introduce una scrittura
cliente tracciata (nuova tabella) → un ADR dedicato anziché un'estensione di
ADR-0045 (che copre solo l'autoring operatore).

**Autorità di design.** Come ADR-0046/0047: la sorgente legacy
(`docs/studiodesk/sql/07_circolari.sql`, tabella `circolari_letture`) + i deferral
di ADR-0045, non il `PROJECT_BRIEF.md` (ristorazione).

## Decision

### 1. DP-scope — read + markLetta + conferma; niente report studio

Il cliente **legge** le circolari pubblicate indirizzate alla propria azienda e,
quando richiesto, **conferma** la presa-visione. Fuori scope in questo task: il
**report letture lato studio** (`circolari.read_report`, permesso già seedato da
ADR-0045 senza endpoint) resta forward — è un consumer diverso (operatore studio)
e richiede la risoluzione del set destinatari (`tutti`→tutti i clienti del tenant,
`azienda`→utenti dell'azienda), task a sé. La superficie cliente è quindi:
**lista** + **dettaglio** (con markLetta on-open) + **conferma**.

### 2. DP-schema — `richiedeConferma` + `circolari_letture` (RLS flat)

Si attivano i due deferral di ADR-0045 §6:

- `Circolare.richiedeConferma` (`Boolean @default(false)`, ALTER su `circolari`):
  authoring lato studio (create/update DTO+service **e checkbox nella
  `CircolareForm`**), consumato dal lettore portale.
- `CircolareLettura` (nuova tabella `circolari_letture`): una riga per
  `(circolare, utente-cliente)` con `lettaAt` (markLetta on-open) e `confermataAt?`
  (presa-visione). `@@unique([circolareId, userId])` — gemello dello `UNIQUE
uq_letturacirc` legacy. `tenantId` **denormalizzato** → policy RLS **flat**
  (USING-only + FORCE, TEXT no-cast), identica a `circolari`/`circolari_destinatari`
  (ADR-0045 DP-N2). Migration `add_circolari_letture` (DDL Prisma + RLS appeso a
  mano, come gli altri moduli accountant).

### 3. DP-ACL — visibilità via destinatari, sempre in-query

A differenza di documenti/comunicazioni (dove `aziendaId` è diretto sulla riga),
la visibilità di una circolare passa dai **destinatari figli**. Il predicato
cliente (single source of truth, `clienteWhere`) è:

```
stato = 'pubblicata'
AND destinatari has some ( tipo='tutti' OR (tipo='azienda' AND aziendaId = <azienda del cliente>) )
```

più `deletedAt IS NULL` applicato dalla soft-delete extension. Conseguenze:

- **Solo `pubblicata`**: bozze e **archiviate** sono invisibili al cliente
  (l'archiviazione ritira la circolare dalla vista cliente).
- **Per-azienda in-query**: una circolare non indirizzata all'azienda del cliente
  è indistinguibile da una inesistente (404), niente leak per id indovinato
  (stesso pattern ACL-in-query di documenti/comunicazioni).
- `clienteRuolo` non incide: una circolare è un broadcast, non ha visibilità
  per-ruolo (a differenza dei documenti, dove `admin` vede anche i non-`tutti`).

### 4. DP-permessi — un solo `portale.circolari.visualizza`

Un unico permesso `portale.circolari.visualizza` (`isPortale: true`) copre
lista + dettaglio + markLetta + **conferma**. A differenza di
`portale.comunicazioni.*` (due permessi read/write, ADR-0047 §2), qui la conferma
non ha un permesso dedicato: è comunque **gated dal flag `richiedeConferma`** della
testata (una circolare che non la richiede → 422), quindi un secondo permesso
sarebbe ridondante. `isPortale` lo esclude dai template studio e lo aggiunge al
template **"Cliente"**; un operatore non lo ha → `PermissionsGuard` lo blocca a
monte su `/portale/circolari`.

### 5. DP-markLetta — on-open, upsert idempotente

L'apertura del dettaglio (`GET /portale/circolari/:id`) segna la circolare come
letta lato server (upsert su `circolari_letture`, `update: {}` → riaperture non
spostano `lettaAt` né azzerano una conferma). Nessuna chiamata FE dedicata
(differenza dal `PATCH letto-cliente` di comunicazioni): la lettura di una
circolare **è** l'apertura, non un'azione separata. La `lettaAt` nasce quindi
contestuale al primo GET dettaglio.

### 6. DP-conferma — scrittura idempotente gated dal flag

`POST /portale/circolari/:id/conferma`: 422 `E_CIRCOLARE_NO_CONFERMA` se la
circolare non richiede conferma; altrimenti valorizza `confermataAt`. **Idempotente**:
una conferma già registrata non viene sovrascritta (si restituisce il timestamp
originale) → ribadire la conferma non "sposta" la presa-visione.

### 7. DP-controller/view — controller portale separato, viste cliente-safe

Stesso pattern di ADR-0046/0047: un secondo controller
`PortaleCircolariController` (`/portale/circolari`) accanto a quello operatore,
**entrambi sul medesimo `CircolariService`**; metodi cliente nuovi
(`listForCliente`/`getForCliente`/`confermaCliente`), nessun ramo `if (cliente)`
nei metodi operatore. `assertCliente` restringe il principal (type-safe
`aziendaId: string`, fail-closed). Le viste sono denormalizzate e cliente-safe
(`ClienteCircolareListView`/`...DetailView`): niente `tenantId`/`stato`/`deletedAt`/
`destinatari`; in più lo stato `letta`/`confermata` del cliente corrente. Il body
è restituito grezzo e **reso come testo** lato FE (no `dangerouslySetInnerHTML`
finché manca la sanitizzazione server-side → **TD-circolari-render** di ADR-0045).

## Consequences

### Positive

- Chiude i deferral di ADR-0045 §6 (`richiede_conferma` + `circolari_letture`)
  con un consumer reale: il broadcast operatore diventa tracciabile (letture).
- Schema forward-compatible già pronto (ADR-0045): nessuna migration distruttiva,
  solo ALTER additivo + nuova tabella.
- ACL coerente con documenti/comunicazioni (in-query, 404 no-leak), pur risolvendo
  la visibilità via relazione `destinatari` invece che per colonna diretta.

### Negative / Trade-off

- Conferma con permesso unico (no `portale.circolari.conferma` dedicato): scelta di
  semplicità MVP, la conferma resta gated dal flag di testata.

### Neutral

- `read_report` (consumer studio) e destinatario `utente` restano forward, come da
  ADR-0045 — questo task non li tocca.

## Out of scope — backlog (NON implementati)

Report letture lato studio (`circolari.read_report`) · destinatario `utente`
(broadcast a singolo utente) · circolari archiviate consultabili dal cliente
(storico) · notifiche (email/push) alla pubblicazione · rendering HTML sanitizzato
del body · download allegati (l'MVP circolari è testo-only, ADR-0045).

## Tech debt

- **TD-circolari-read-report**: endpoint studio `GET /circolari/:id/report` +
  risoluzione del set destinatari atteso × stato lettura/conferma (consumer del
  permesso `circolari.read_report` già seedato).
- **TD-circolari-render** (ereditata da ADR-0045): body reso come testo; serve
  sanitizzazione server-side prima di renderizzare HTML.

## Notes

Migration `add_circolari_letture` (ALTER `circolari` ADD `richiede_conferma` +
CREATE `circolari_letture` + RLS flat appesa a mano). Seed: permesso
`portale.circolari.visualizza` + aggiunta al role template "Cliente" (che già ha
`portale.documenti.visualizza` / `portale.comunicazioni.*`) → 49 permessi.
Verifica runtime col cliente demo `cliente@studio-demo.local` di ADR-0046.
