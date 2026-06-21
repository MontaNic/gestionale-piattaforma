# ADR-0045 — Modulo Circolari MVP: broadcast unidirezionale studio→clienti

Status: Accepted
Date: 2026-06-21
Verticale: accountant (livello 1, operatore-studio)

## Context

Lo studio ha bisogno di inviare **comunicazioni broadcast** ai propri clienti
(aggiornamenti normativi, scadenze collettive, avvisi). A differenza di
[ADR-0043](ADR-0043-comunicazioni-module.md) (thread 1:1 bidirezionale) e di
[ADR-0044](ADR-0044-documenti-module.md) (scambio file), una circolare è
**unidirezionale 1→N**: una testata HTML inviata a molti destinatari.

La sorgente legacy (betadesk `CircolariService` + 6 migration `07/13/15/16/17/18`)
implementa un sistema molto ampio: AI (genera/migliora/quiz/summary/tags),
Telegram, web push, A/B test email, versioning, solleciti automatici con cron,
PDF+hash+retention, audit immutabile, GDPR tombstone, destinatario per reparto.
Portare tutto in un singolo task violerebbe il principio "un verticale alla
volta, niente feature senza consumer reale". Si parte quindi dal **DDL base 07**.

## Decision

### 1. Modello dati — 2 tabelle (DDL 07 base, no v2)

- `circolari` (testata): `titolo`, `oggettoEmail`, `bodyHtml`, `stato`,
  `priorita`, `pubblicataIl?`, `scadeIl?`, soft-delete `deletedAt`, timestamps.
- `circolari_destinatari` (routing): `tipo` (`tutti`/`azienda`/`utente`),
  `aziendaId?` (FK `aziende`, CASCADE).

`studio_id` del DDL legacy → `tenantId` (multi-tenancy nativa). Niente `codice`/
counter (a differenza di comunicazioni): le circolari non hanno numerazione
naturale → nessun partial-unique.

### 2. DP-N2 — `tenantId` denormalizzato → RLS flat

Coerente con [ADR-0043](ADR-0043-comunicazioni-module.md): `circolari_destinatari`
porta `tenant_id` diretto (denormalizzato) invece di risalire al parent. Le
policy RLS sono **flat** (`USING (is_super_admin OR tenant_id = current_setting)`,
FORCE, TEXT no-cast), identiche a comunicazioni/documenti — nessuna subquery di
nesting. Il DDL legacy non aveva `tenant_id` sulle figlie: divergenza consapevole.

### 3. DP-stato — macchina di stato bozza→pubblicata→archiviata

```
bozza ──publish──▶ pubblicata ──archive──▶ archiviata
```

- `publish`: `bozza → pubblicata`, setta `pubblicataIl=now()`. **Email DEFER**
  (vedi §6) → la pubblicazione MVP è solo "rende visibile" (lato cliente al
  livello 2). Idempotenza: ripubblicare una pubblicata → 422.
- `archive`: `pubblicata → archiviata`.
- Modifica (`PATCH`) ed eliminazione (`DELETE` soft) ammesse **solo su `bozza`**
  (una pubblicata si archivia, non si elimina) → 422 altrimenti.

### 4. DP-permessi — 4 codici (41 → 45)

`circolari.{create,publish,archive,read_report}`. `create` è il permesso
"operativo" (list/get/patch/delete bozza); `publish`/`archive` sono transizioni
separate. `read_report` è **forward** (report destinatari = livello 2): seedato
ma senza endpoint MVP, come l'enum `utente` (§5). Socio/Super Admin ricevono
tutti e 4 (via `ALL_PERMISSION_CODES`); Collaboratore riceve solo `create`.

### 5. DP-destinatari — solo `tutti`/`azienda`; `utente` forward

L'MVP gestisce broadcast a tutti i clienti o ad aziende specifiche. L'enum
`DestinatarioTipo` include `utente` ma **nessun service lo processa**: viene
rifiutato in validazione (`E_CIRCOLARE_DESTINATARIO_UTENTE_UNSUPPORTED`).
Inserirlo ora nell'enum evita un `ALTER TYPE ADD VALUE` al livello 2
(**TD-circolari-utente-forward**, simmetria con TD-utente-enum-forward di Documenti).
Il destinatario per **reparto** è fuori scope: `reparti_azienda` non esiste nel repo.

### 6. DP-defer — letture, conferma, email

- `circolari_letture` e `richiede_conferma`: **DEFER al livello 2** (portale
  cliente). Senza un lettore cliente sarebbero campi/tabelle morte. Il consumer
  reale dell'MVP è l'operatore studio (autoring + futuro tracking), come per il
  lato-cliente già differito in comunicazioni ("riservato al portale, livello 2").
- **Email alla pubblicazione: DEFER.** `MailService` nel repo è security-only
  (`packages/platform`); il framework `notifiche_config` + template + SMTP
  multi-tenant che betadesk usa per le circolari è assente. MVP solo in-app.

### 7. DP-no-rich-editor

`bodyHtml` è una `textarea` grezza (no TipTap/Quill). Il dettaglio renderizza il
body come testo (no `dangerouslySetInnerHTML` finché non c'è sanitizzazione
server-side → **TD-circolari-render**). Un editor ricco è task separato (YAGNI).

## Consequences

### Positive

- Verticale coerente con comunicazioni/documenti: stesso pattern RLS, soft-delete,
  DTO errorCode, struttura modulo, test e2e (CRUD + RBAC + isolamento).
- Schema forward-compatible (enum `utente`, permesso `read_report`) → il livello 2
  non richiede migration distruttive sull'esistente.

### Negative / Trade-off

- 4 permessi vs i 2 (`visualizza`/`gestisci`) degli altri verticali accountant:
  scelta consapevole per esporre publish/archive come transizioni distinte.
- `read_report` e `utente` seedati senza consumer → debito "forward" esplicito.

### Neutral

- Nessun allegato/PDF nell'MVP (broadcast testo-only); il modulo non importa
  `StorageModule`.

## Out of scope — backlog (NON implementati)

Versioning (`13_v2`) · solleciti automatici + cron · AI (genera/migliora/quiz/
summary/tags) · Telegram/Web Push · A/B test email · PDF+hash+retention · audit
immutabile · GDPR tombstone · fonti URL · `azienda_mittente_id` · destinatario
reparto · lato cliente (read/markLetta/conferma) · email alla pubblicazione.

## Tech debt

- **TD-circolari-utente-forward**: enum `utente` pronto, logica al livello 2.
- **TD-circolari-render**: body reso come testo; serve sanitizzazione server-side
  prima di renderizzare HTML.
- **TD-circolari-letture**: tabella letture/conferma + report al livello 2.
- **TD-circolari-email**: notifica email alla pubblicazione quando arriverà il
  framework `notifiche_config`.

## Notes

Migration `20260621094104_add_circolari` (DDL Prisma + RLS flat appeso a mano,
come `add_comunicazioni`/`add_documenti`). Permessi: seed 41 → 45.
