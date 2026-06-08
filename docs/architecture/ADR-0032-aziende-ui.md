# ADR-0032 — UI anagrafica `aziende` in `accountant-web` + seed demo

- **Status:** Accepted
- **Date:** 2026-06-08
- **Supersedes / relates:** ADR-0031 (slice backend `aziende`), ADR-0030 (skeleton `accountant-web`), ADR-0020/0022 (pattern UI dominio `restaurant-web`)

## Context

STOP-c2 del verticale commercialisti: prima UI di dominio. La slice backend `aziende`
(ADR-0031: schema + RLS + CRUD `/api/v1/aziende` + e2e) è su main. Lo skeleton
`accountant-web` (ADR-0030) ha gli slot nav `clienti`/`fatture` come placeholder.
Questa decisione copre la trasformazione di `clienti` in anagrafica reale + il seed
dimostrativo per `studio-demo`. Nessun cambio a schema/migration/backend.

Lo STOP 0 ha letto l'anatomia FE reale di `restaurant-web` (pagina lista menu,
`ArticleForm` come form ricco di riferimento, `ConfirmDialog`, `menu-api`/`menu-types`,
superficie `@gestionale/api-client` e `@gestionale/auth-web`) e il contratto backend
reale (`aziende.controller`/`.service` + 2 DTO + `model Azienda`/`enum TipoCliente`).

## Decisions

### DP-nav — route/label/cartella `clienti` invariate

La pagina `clienti/page.tsx` passa da `PlaceholderPage` ad anagrafica reale che consuma
`/api/v1/aziende`. Label utente "Clienti" (già tradotta, semanticamente corretta per un
commercialista) **disaccoppiata** dall'entità tecnica `Azienda`/`aziende`. Niente rename
della union tipata in `Sidebar`, della cartella di route, né nuove chiavi i18n/placeholder.
Alternativa scartata: rinominare tutto a `aziende` (tocca 4 superfici — Sidebar union, cartella,
i18n nav, placeholder — per un guadagno semantico discutibile).

### DP-form — form 15 campi inline in Card

Create/edit via `AziendaForm` toggalato in una `Card` dalla page (pattern `MenuForm`),
non un segmento dinamico `clienti/[id]`. Evita l'introduzione di `[id]` e il relativo
active-state Sidebar (TD-BU di `restaurant-web`) e il dialog-management del form. Il
`ConfirmDialog` resta esclusivamente per il soft-delete. Alternative scartate: route
dedicata `[id]` (più route + active-state), Dialog modale (15 campi in un modale
scrollabile, scomodo).

### Lista = `<table>` tailwind

`@gestionale/ui` non espone un componente `Table`; per non introdurre una dipendenza si usa
`<table>` con classi tailwind (colonne: Nome, Codice, Tipo, Contatti, Stato, Azioni),
coerente col confine "nessuna nuova dipendenza" dei form (select/checkbox nativi). La colonna
**Stato** riflette il flag applicativo `attivo`; il soft-delete rimuove la riga dall'elenco
(il backend `list` filtra `deletedAt IS NULL` via `softDeleteExtension`), nessun cestino UI.

### Validazione email opzionale

I tre campi email (`email`, `emailOperativa`, `pec`) usano un validatore zod che ammette `''`
oppure un formato email valido ≤255 (`.refine(v => v === '' || EMAIL_RE.test(v))`), mantenendo
il tipo `string` in/out per un'inferenza `zodResolver` pulita (no `preprocess`). I campi
opzionali stringa viaggiano come `''` nel form e sono convertiti a `undefined` al submit.

### `messageForError(err)` aggiunto a `error-codes.ts`

Il pattern delle pagine dominio (`menu-api` consumer) risolve l'**errore catturato**, non il
codice. `accountant-web` aveva solo `messageForErrorCode(code: string)`; si aggiunge
`messageForError(err: unknown)` (se `ApiError` → `messageForErrorCode(err.errorCode)`,
altrimenti fallback). Consumer: `clienti/page.tsx` + `AziendaForm`.

### §confine — mapping `E_AZIENDA_*` lean

In `ERROR_CODE_MESSAGES` si mappano solo i due codici che emergono a runtime:
`E_AZIENDA_NOT_FOUND` e `E_AZIENDA_CODICE_EXISTS`. I backstop di validazione
(`E_AZIENDA_*_INVALID`/`_TOO_LONG`/`_REQUIRED`) sono prevenuti dalla zod client-side, che
replica i constraint del DTO; in caso (teorico) di validazione server-side cadono sul
fallback generico. Confine accettato: estendere la mappa a tutti i codici di validazione è
i18n-completo ma ridondante finché la zod copre i constraint lato client.

### `placeholder.clienti` rimosso

La chiave i18n `placeholder.clienti` (it + en) diventa dead-code (la pagina non usa più
`PlaceholderPage`) → rimossa, coerente con la convention "i18n keys solo quando usate"
(ADR-0018 §TD-BF). `placeholder.fatture` + `placeholder.comingSoon` restano.

### Seed demo `studio-demo`

`seedDevAziende(tenantId)` (mirror di `seedDevMenu`: idempotente find-then-create sulla
chiave naturale `tenantId+codice`, esecuzione nel system context di `main()`) crea 5 aziende
demo (3 `azienda` di cui una `attivo=false`, 2 `persona_fisica`), così la lista non è vuota e
il badge "Non attivo" è dimostrabile. Dati fittizi PII-free (domini `@example.com`).

## Doc note (ADR-0030 — incongruenza annotata, non corretta)

ADR-0030 indicava `dialog.tsx`/`textarea.tsx` come file locali di `restaurant-web` e citava
la rimozione di un `messageForError`. Allo stato attuale: `Dialog`/`Textarea` sono nel barrel
`@gestionale/ui` (consolidamento intercorso, esportati da `packages/ui/src`) e il consumer FE
del catalogo è `messageForErrorCode`. L'incongruenza è qui annotata per fedeltà storica, non
"corretta" retroattivamente nell'ADR-0030 (anchor stability).

## Files

| File                                                                    | Type                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/accountant-web/src/lib/aziende-types.ts`                          | new                                                              |
| `apps/accountant-web/src/lib/aziende-api.ts`                            | new                                                              |
| `apps/accountant-web/src/components/aziende/ConfirmDialog.tsx`          | new (copia generica)                                             |
| `apps/accountant-web/src/components/aziende/AziendaForm.tsx`            | new                                                              |
| `apps/accountant-web/src/lib/error-codes.ts`                            | mod (`ApiError`, 2 codici `E_AZIENDA_*`, `messageForError`)      |
| `apps/accountant-web/src/app/t/[slug]/(authenticated)/clienti/page.tsx` | mod (placeholder → lista + form)                                 |
| `apps/accountant-web/src/i18n/messages/{it,en}.json`                    | mod (− `placeholder.clienti`, + namespace `aziende`)             |
| `packages/db/prisma/seed.ts`                                            | mod (+ `TipoCliente`, `seedDevAziende`, call-site `studio-demo`) |
| `docs/architecture/ADR-0032-aziende-ui.md`                              | new                                                              |
| `PROGRESS.md`                                                           | mod                                                              |

## Gate

- `typecheck` 16/16 · `lint` + `next lint` (accountant-web) + `format:check` clean
- `next build` accountant-web OK (`/t/[slug]/clienti` pagina reale)
- `db:seed` idempotente (2° run 0 created)
- Smoke browser (Nicolò): login `studio-demo` → 5 righe (una sola `AZ001`, `AZ003` "Non attivo") → create/edit/delete + dup `codice` → "Esiste già un cliente con questo codice." → light/dark

## Tech debt

Nessuno nuovo. `health`/`me` restano app-level (invariato). Form edit non scrolla in vista
(identico al pattern menu di `restaurant-web`) — non tracciato, raffinamento UX minore.

## Reversibility

Slice FE additiva: ripristinare `clienti/page.tsx` a `PlaceholderPage`, rimuovere i 4 file
nuovi + il namespace `aziende` + i 2 mapping + `messageForError`, e rimuovere
`seedDevAziende` + la cattura `const studio` riportano allo stato ADR-0030. Schema/migration/
backend intatti.
